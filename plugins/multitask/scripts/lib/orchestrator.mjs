import fs from "node:fs/promises";
import path from "node:path";

import { buildExecArgs, getCodexCommand } from "./codex.mjs";
import {
  spawnStreaming,
  isProcessRunning,
  runCommand,
  sleep,
  terminateProcessTree,
} from "./process.mjs";
import { planWaves } from "./plan-validate.mjs";
import { readPrompt } from "./assets.mjs";
import { readJson, writeJson } from "./state.mjs";
import { updateJob } from "./tracked-jobs.mjs";

let applyQueue = Promise.resolve();

export async function runOrchestrator(job, options, cwd = process.cwd()) {
  const jobDir = job.jobDir;
  await fs.mkdir(path.join(jobDir, "workers"), { recursive: true });
  await fs.mkdir(path.join(jobDir, "patches"), { recursive: true });
  const baseline = await captureBaseline(options.cd);
  await writeJson(path.join(jobDir, "baseline.json"), baseline);
  await fs.writeFile(path.join(jobDir, "baseline.diff"), baseline.diff, "utf8");
  await writeJson(path.join(jobDir, "baseline-untracked.json"), baseline.untracked);
  const summaries = [];
  const started = Date.now();
  const runOptions = { ...options, runDeadline: started + options.runTimeoutMs };

  for (const wave of planWaves(job.plan.workers)) {
    if (Date.now() > runOptions.runDeadline) {
      summaries.push({ workerId: "run", status: "failed", error: "run timeout exceeded" });
      break;
    }
    const results = await runPool(wave, options.maxParallel, (worker) =>
      options.isolatedWorkspaces
        ? runIsolatedWorker(worker, job, runOptions, baseline)
        : runSharedWorker(worker, job, runOptions),
    );
    summaries.push(...results);
    const failed = results
      .filter((summary) => summary.status !== "ok")
      .map((summary) => summary.workerId);
    if (failed.length) break;
  }

  const audit = options.isolatedWorkspaces
    ? { unauthorized: [] }
    : await auditSharedWorkspace(options.cd, job.plan, baseline);
  const status =
    summaries.every((summary) => summary.status === "ok") && audit.unauthorized.length === 0
      ? "completed"
      : "needs-review";
  const finalJob = await updateJob(
    job.id,
    { status, completedAt: new Date().toISOString(), summaries, audit },
    cwd,
  );
  return finalJob;
}

async function runPool(items, limit, run) {
  const results = [];
  const queue = [...items];
  async function workerLoop() {
    while (queue.length) {
      const item = queue.shift();
      results.push(await run(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, workerLoop));
  return results;
}

export async function spawnBackgroundWorkers(job, options, cwd = process.cwd()) {
  await fs.mkdir(path.join(job.jobDir, "workers"), { recursive: true });
  const baseline = await captureBaseline(options.cd);
  await writeJson(path.join(job.jobDir, "baseline.json"), baseline);
  await fs.writeFile(path.join(job.jobDir, "baseline.diff"), baseline.diff, "utf8");
  await writeJson(path.join(job.jobDir, "baseline-untracked.json"), baseline.untracked);
  const pids = [];
  for (const worker of job.plan.workers) {
    const files = workerFiles(job.jobDir, worker.id);
    const prompt = await composeWorkerPrompt(worker);
    const args = buildWorkerArgs(worker, options, options.cd, files.last, prompt);
    const stdout = await fs.open(files.jsonl, "a");
    const stderr = await fs.open(files.stderr, "a");
    const child = spawnStreaming(getCodexCommand(), args, {
      cwd: options.cd,
      detached: true,
      stdio: ["ignore", stdout.fd, stderr.fd],
    });
    await Promise.all([stdout.close(), stderr.close()]);
    pids.push({ workerId: worker.id, pid: child.pid ?? null, startedAt: new Date().toISOString() });
  }
  await writeJson(path.join(job.jobDir, "pids.json"), pids);
  return updateJob(job.id, { status: "running", pids }, cwd);
}

export async function refreshBackgroundJob(job, cwd = process.cwd()) {
  if (job?.status !== "running" || !job.plan?.workers?.length) return job;
  const pidByWorkerId = new Map((job.pids ?? []).map((pid) => [pid.workerId, pid]));

  const workerStates = await Promise.all(
    job.plan.workers.map(async (worker) =>
      readBackgroundWorkerState(job.jobDir, worker.id, pidByWorkerId.get(worker.id)),
    ),
  );
  const allTerminal = workerStates.every((state) => state.terminal);
  const running = (job.pids ?? []).filter((pid) => isProcessRunning(pid.pid));
  if (!allTerminal && running.length) return job;

  const summaries = await Promise.all(
    workerStates.map(async (state) => writeWorkerSummary(state.files.summary, state.summary)),
  );
  const baseline = await readJson(path.join(job.jobDir, "baseline.json"), null);
  const audit = baseline
    ? await auditSharedWorkspace(cwd, job.plan, baseline)
    : { unauthorized: [] };
  const status =
    summaries.every((summary) => summary.status === "ok") && audit.unauthorized.length === 0
      ? "completed"
      : "needs-review";
  return updateJob(
    job.id,
    { status, completedAt: new Date().toISOString(), summaries, audit, pids: [] },
    cwd,
  );
}

async function readBackgroundWorkerState(jobDir, workerId, pidInfo = null) {
  const files = workerFiles(jobDir, workerId);
  const [finalMessage, stderr, jsonl] = await Promise.all([
    fs.readFile(files.last, "utf8").catch(() => ""),
    fs.readFile(files.stderr, "utf8").catch(() => ""),
    fs.readFile(files.jsonl, "utf8").catch(() => ""),
  ]);
  const usage = readLastUsage(jsonl);
  const terminal = /^STATUS: (ok|blocked|partial)\b/m.test(finalMessage);
  const status = /^STATUS: ok\b/m.test(finalMessage)
    ? "ok"
    : /^STATUS: blocked\b/m.test(finalMessage)
      ? "blocked"
      : /^STATUS: partial\b/m.test(finalMessage)
        ? "partial"
        : "failed";
  const startedAt = pidInfo?.startedAt ?? null;
  const completedAt = terminal ? await fileMtimeIso(files.last) : null;
  const summary = {
    workerId,
    status,
    startedAt,
    completedAt,
    durationMs: startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : null,
    usage,
    stderr: cleanWorkerStderr(stderr),
    finalMessage: finalMessage.trim(),
  };
  return { files, summary, terminal };
}

async function fileMtimeIso(file) {
  try {
    return (await fs.stat(file)).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function readLastUsage(jsonl) {
  let usage = null;
  for (const line of jsonl.split("\n").filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event.type === "turn.completed" && event.usage) usage = event.usage;
    } catch {
      // Keep harvesting resilient to partial JSONL writes.
    }
  }
  return usage;
}

async function runSharedWorker(worker, job, options) {
  const files = workerFiles(job.jobDir, worker.id);
  const prompt = await composeWorkerPrompt(worker);
  return runWorkerWithRetries(worker, files, options, options.cd, prompt);
}

async function runIsolatedWorker(worker, job, options, baseline) {
  const workspace = path.join(job.jobDir, "workspaces", worker.id);
  const baseDir = path.join(job.jobDir, "baselines", worker.id);
  await hydrateWorkspace(options.cd, workspace, baseline.baseHead);
  await copyOwnedSnapshot(workspace, baseDir, worker);
  const files = workerFiles(job.jobDir, worker.id);
  const prompt = await composeWorkerPrompt(worker);
  const summary = await runWorkerWithRetries(worker, files, options, workspace, prompt);
  if (summary.status !== "ok") return summary;
  const changed = await changedPathsNoIndex(baseDir, workspace, [
    ...worker.owned_files,
    ...worker.read_only_files,
  ]);
  const unauthorized = changed.filter((file) => !worker.owned_files.includes(file));
  if (unauthorized.length)
    return writeWorkerSummary(files.summary, {
      ...summary,
      status: "blocked",
      unauthorizedTouches: unauthorized,
    });
  const apply = await applyOwnedPatch(
    baseDir,
    workspace,
    options.cd,
    worker.owned_files,
    path.join(job.jobDir, "patches", `${worker.id}.patch`),
  );
  if (!apply.ok)
    return writeWorkerSummary(files.summary, { ...summary, status: "blocked", error: apply.error });
  return summary;
}

async function runWorkerWithRetries(worker, files, options, cwd, prompt) {
  let attempt = 0;
  let lastSummary = null;
  const maxAttempts = options.retryFailed + 1;
  while (attempt < maxAttempts) {
    const args = buildWorkerArgs(worker, options, cwd, files.last, prompt, { fallback: false });
    const timeoutMs = remainingWorkerTimeout(options);
    if (timeoutMs <= 0)
      return writeWorkerSummary(files.summary, {
        workerId: worker.id,
        status: "failed",
        error: "run timeout exceeded",
        attempt,
      });
    lastSummary = await runWorkerProcess(worker, files, cwd, args, timeoutMs, attempt);
    if (lastSummary.status === "ok") return lastSummary;
    if (!options.noFallback && isUnavailableModelSummary(lastSummary)) {
      const fallbackArgs = buildWorkerArgs(worker, options, cwd, files.last, prompt, {
        fallback: true,
      });
      const fallbackSummary = await runWorkerProcess(
        worker,
        files,
        cwd,
        fallbackArgs,
        remainingWorkerTimeout(options),
        `${attempt}-fallback`,
      );
      if (fallbackSummary.status === "ok") return { ...fallbackSummary, fallbackModelUsed: true };
      lastSummary = fallbackSummary;
    }
    attempt += 1;
  }
  return lastSummary;
}

function remainingWorkerTimeout(options) {
  const runRemaining = options.runDeadline
    ? options.runDeadline - Date.now()
    : options.workerTimeoutMs;
  return Math.max(0, Math.min(options.workerTimeoutMs, runRemaining));
}

function buildWorkerArgs(worker, options, cwd, lastMessageFile, prompt, { fallback = false } = {}) {
  const requestedModel = options.useCodexDefaultModel
    ? worker.model
    : (worker.model ?? options.workerModel);
  const model = fallback ? fallbackModelFor(requestedModel) : requestedModel;
  return buildExecArgs({
    cwd,
    effort: worker.effort ?? options.workerEffort,
    lastMessageFile,
    model,
    profile: options.profile,
    prompt,
    sandbox: worker.sandbox ?? options.sandbox,
  });
}

function fallbackModelFor(model) {
  return model && model !== "gpt-5.4-mini" ? "gpt-5.4" : "gpt-5.4-mini";
}

function isUnavailableModelSummary(summary) {
  return /model.*(unavailable|not available|not found|unsupported)|unsupported.*model/i.test(
    `${summary.stderr ?? ""}\n${summary.finalMessage ?? ""}\n${summary.error ?? ""}`,
  );
}

async function runWorkerProcess(worker, files, cwd, args, timeoutMs, attempt = 0) {
  const started = Date.now();
  const child = spawnStreaming(getCodexCommand(), args, { cwd });
  let stdout = "";
  let stderr = "";
  let usage = null;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(child.pid);
  }, timeoutMs);
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    stdout += text;
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (event.type === "turn.completed" && event.usage) usage = event.usage;
      } catch {
        // Codex JSONL should be parseable; keep raw output either way.
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise((resolve) =>
    child.on("close", (exitCode) => resolve(exitCode ?? 0)),
  );
  clearTimeout(timeout);
  await fs.writeFile(files.jsonl, stdout, "utf8");
  await fs.writeFile(files.stderr, stderr, "utf8");
  const finalMessage = await fs.readFile(files.last, "utf8").catch(() => "");
  const status = timedOut
    ? "failed"
    : code === 0 && /^STATUS: ok\b/m.test(finalMessage)
      ? "ok"
      : code === 0
        ? "partial"
        : "failed";
  return writeWorkerSummary(files.summary, {
    workerId: worker.id,
    status,
    attempt,
    exitCode: code,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    usage,
    stderr: cleanWorkerStderr(stderr),
    finalMessage: finalMessage.trim(),
  });
}

function cleanWorkerStderr(stderr) {
  return stderr
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return false;
      if (/Reading additional input from stdin/.test(line)) return false;
      if (/WARN codex_core_plugins::manifest/.test(line)) return false;
      if (/codex_core_plugins::manifest: ignoring interface\.defaultPrompt/.test(line))
        return false;
      if (/WARN codex_core::session::turn: after_agent hook failed/.test(line)) return false;
      if (/after_agent hook failed; continuing/.test(line)) return false;
      if (/ERROR codex_core::session: failed to record rollout items/.test(line)) return false;
      if (/failed to record rollout items: thread .* not found/.test(line)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

async function writeWorkerSummary(file, summary) {
  await writeJson(file, summary);
  return summary;
}

export async function composeWorkerPrompt(worker) {
  const template = await readPrompt("worker.md");
  return template
    .replace(
      "{{OWNED_FILES}}",
      worker.owned_files.map((file) => `- ${file}`).join("\n") || "- none",
    )
    .replace(
      "{{READ_ONLY_FILES}}",
      worker.read_only_files.map((file) => `- ${file}`).join("\n") || "- none",
    )
    .replace("{{WORKER_PROMPT}}", worker.prompt);
}

function workerFiles(jobDir, workerId) {
  const base = path.join(jobDir, "workers", workerId);
  return {
    jsonl: `${base}.jsonl`,
    last: `${base}.last.txt`,
    stderr: `${base}.stderr`,
    summary: `${base}.summary.json`,
  };
}

async function captureBaseline(cwd) {
  const baseHead = (await runCommand("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
  const diff = (await runCommand("git", ["diff", "--binary", "HEAD"], { cwd })).stdout;
  const tracked = (await runCommand("git", ["diff", "--name-only", "HEAD"], { cwd })).stdout
    .split("\n")
    .filter(Boolean);
  const untracked = (
    await runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd })
  ).stdout
    .split("\n")
    .filter(Boolean);
  return { baseHead, diff, tracked, untracked };
}

async function auditSharedWorkspace(cwd, plan, baseline) {
  const owned = new Set(plan.workers.flatMap((worker) => worker.owned_files));
  const allowedBaseline = new Set([...baseline.tracked, ...baseline.untracked]);
  const tracked = (
    await runCommand("git", ["diff", "--name-only", baseline.baseHead], { cwd })
  ).stdout
    .split("\n")
    .filter(Boolean);
  const untracked = (
    await runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd })
  ).stdout
    .split("\n")
    .filter(Boolean);
  const changed = [...new Set([...tracked, ...untracked])];
  return {
    changed,
    unauthorized: changed.filter((file) => !owned.has(file) && !allowedBaseline.has(file)),
  };
}

async function hydrateWorkspace(source, target, baseHead) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const worktree = await runCommand("git", ["worktree", "add", "--detach", target, baseHead], {
    cwd: source,
  });
  if (worktree.code !== 0) throw new Error(worktree.stderr || "failed to create worker worktree");
}

async function copyOwnedSnapshot(workspace, baseDir, worker) {
  await fs.mkdir(baseDir, { recursive: true });
  for (const file of [...worker.owned_files, ...worker.read_only_files]) {
    const source = path.join(workspace, file);
    const target = path.join(baseDir, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target).catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function changedPathsNoIndex(baseDir, workspace, paths) {
  const changed = [];
  for (const file of paths) {
    const result = await runCommand("git", [
      "diff",
      "--no-index",
      "--quiet",
      path.join(baseDir, file),
      path.join(workspace, file),
    ]);
    if (result.code === 1) changed.push(file);
    if (result.code > 1 && !/No such file/.test(result.stderr)) changed.push(file);
  }
  return changed;
}

async function applyOwnedPatch(baseDir, sourceWorkspace, targetWorkspace, files, patchFile) {
  const previousApply = applyQueue;
  let releaseApply;
  applyQueue = new Promise((resolve) => {
    releaseApply = resolve;
  });
  await previousApply;
  try {
    return await applyOwnedPatchLocked(baseDir, sourceWorkspace, targetWorkspace, files, patchFile);
  } finally {
    releaseApply();
  }
}

async function applyOwnedPatchLocked(baseDir, sourceWorkspace, targetWorkspace, files, patchFile) {
  const oldRoot = path.join(path.dirname(patchFile), `${path.basename(patchFile, ".patch")}-old`);
  const newRoot = path.join(path.dirname(patchFile), `${path.basename(patchFile, ".patch")}-new`);
  await fs.rm(oldRoot, { force: true, recursive: true });
  await fs.rm(newRoot, { force: true, recursive: true });
  for (const file of files) {
    await copyIfExists(path.join(baseDir, file), path.join(oldRoot, file));
    await copyIfExists(path.join(sourceWorkspace, file), path.join(newRoot, file));
  }
  const diff = await runCommand("git", ["diff", "--no-index", "--binary", oldRoot, newRoot]);
  if (diff.code !== 0 && diff.code !== 1) return { ok: false, error: diff.stderr };
  const patch = normalizeNoIndexPatch(diff.stdout, oldRoot, newRoot);
  await fs.writeFile(patchFile, patch, "utf8");
  if (!patch.trim()) return { ok: true };
  const apply = await runCommand("git", ["apply", "--3way", patchFile], { cwd: targetWorkspace });
  if (apply.code !== 0) return { ok: false, error: apply.stderr || apply.stdout };
  return { ok: true };
}

async function copyIfExists(source, target) {
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function normalizeNoIndexPatch(patch, oldRoot, newRoot) {
  const oldPrefix = oldRoot.replaceAll("\\", "/");
  const newPrefix = newRoot.replaceAll("\\", "/");
  return patch
    .replaceAll(oldPrefix, "a")
    .replaceAll(newPrefix, "b")
    .replaceAll(`--- a`, "--- a")
    .replaceAll(`+++ b`, "+++ b");
}

export async function spawnWorker(worker, job, options) {
  return options.isolatedWorkspaces
    ? runIsolatedWorker(worker, job, options, {})
    : runSharedWorker(worker, job, options);
}

export async function reapAll() {
  return [];
}

export async function harvestExitCode(summary) {
  return summary?.exitCode ?? null;
}

export async function cancelJob(job, { graceMs = 5000 } = {}) {
  const killed = [];
  for (const pid of job.pids ?? []) {
    if (terminateProcessTree(pid.pid)) killed.push(pid.workerId);
  }
  await sleep(graceMs);
  for (const pid of job.pids ?? []) {
    terminateProcessTree(pid.pid, "SIGKILL");
  }
  return killed;
}
