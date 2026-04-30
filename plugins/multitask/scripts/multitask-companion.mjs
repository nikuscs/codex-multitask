#!/usr/bin/env node

import fs from "node:fs/promises";

import { parseArgs } from "./lib/args.mjs";
import { detectCodex } from "./lib/codex.mjs";
import { cancelJobs, createMultitaskJob, resolveJob } from "./lib/job-control.mjs";
import {
  refreshBackgroundJob,
  runOrchestrator,
  spawnBackgroundWorkers,
} from "./lib/orchestrator.mjs";
import { validatePlan } from "./lib/plan-validate.mjs";
import { renderPlan, renderResult, renderStatus } from "./lib/render.mjs";
import { runSplitter } from "./lib/splitter.mjs";
import { ensureWorkspaceState, writeRuntimeState } from "./lib/state.mjs";
import { updateJob } from "./lib/tracked-jobs.mjs";
import { sleep, spawnStreaming } from "./lib/process.mjs";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printText(value) {
  process.stdout.write(`${value}\n`);
}

function printResult(options, jsonValue, textValue) {
  if (options.json) {
    printJson(jsonValue);
  } else {
    printText(textValue);
  }
}

async function handleSetup(options) {
  const codex = await detectCodex(options.cd);
  await writeRuntimeState({ lastSetupAt: new Date().toISOString(), codex }, options.cd);
  const result = { ok: codex.ok, checks: { codex } };
  printResult(options, result, codex.ok ? `Codex ready: ${codex.version}` : "Codex CLI not ready");
}

async function createPlannedJob(options) {
  if (!options.prompt && !options.planFile) throw new Error("run requires a prompt or --plan-file");
  const workspace = await ensureWorkspaceState(options.cd);
  let job = await createMultitaskJob(
    { prompt: options.prompt, mode: options.background ? "background" : "foreground", options },
    options.cd,
  );
  let plan;
  try {
    plan = await runSplitter(options, job.jobDir);
  } catch (error) {
    await updateJob(job.id, { status: "failed", error: error.message }, options.cd);
    throw error;
  }
  job = await updateJob(job.id, { plan, workspaceRoot: workspace.root }, options.cd);
  return job;
}

async function handlePlan(options) {
  const job = await createPlannedJob(options);
  printResult(options, { ok: true, jobId: job.id, plan: job.plan }, renderPlan(job.plan));
}

async function handleRun(options) {
  const job = await createPlannedJob(options);
  const validPlan = validatePlan(job.plan, { maxWorkers: options.workers });
  await fs.writeFile(`${job.jobDir}/plan.json`, `${JSON.stringify(validPlan, null, 2)}\n`, "utf8");
  await updateJob(
    job.id,
    { status: "running", plan: validPlan, startedAt: new Date().toISOString() },
    options.cd,
  );
  if (options.background) {
    const running = await spawnBackgroundWorkers({ ...job, plan: validPlan }, options, options.cd);
    spawnBackgroundMonitor(running.id, options);
    printResult(options, { ok: true, job: running }, `Started ${running.id}`);
    return;
  }
  let result;
  try {
    result = await runOrchestrator({ ...job, plan: validPlan }, options, options.cd);
  } catch (error) {
    await updateJob(
      job.id,
      { status: "failed", completedAt: new Date().toISOString(), error: error.message },
      options.cd,
    );
    throw error;
  }
  printResult(options, { ok: result.status === "completed", job: result }, renderResult(result));
}

function spawnBackgroundMonitor(jobId, options) {
  const script = process.argv[1];
  const child = spawnStreaming(
    process.execPath,
    [script, "monitor", jobId, "--cd", options.cd, "--run-timeout", String(options.runTimeoutMs)],
    { cwd: options.cd, detached: true, stdio: "ignore" },
  );
  child.unref();
}

async function resolveFreshJob(options) {
  const job = await resolveJob(options.jobId, options.cd);
  return refreshBackgroundJob(job, options.cd);
}

async function handleStatus(options) {
  if (!options.watch || options.json) {
    const job = await resolveFreshJob(options);
    printResult(options, { ok: true, job }, renderStatus(job));
    return;
  }

  while (true) {
    const job = await resolveFreshJob(options);
    process.stdout.write(`\u001Bc${renderStatus(job)}\n`);
    if (!["queued", "running"].includes(job.status)) return;
    await sleep(250);
  }
}

async function handleResult(options) {
  const job = await resolveFreshJob(options);
  printResult(options, { ok: job.status === "completed", job }, renderResult(job));
}

async function handleMonitor(options) {
  const deadline = Date.now() + options.runTimeoutMs;
  while (Date.now() < deadline) {
    const job = await resolveFreshJob(options);
    if (!["queued", "running"].includes(job.status)) return;
    await sleep(1000);
  }
  const job = await resolveJob(options.jobId, options.cd);
  if (["queued", "running"].includes(job.status)) {
    await updateJob(
      job.id,
      {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: "monitor timeout exceeded",
      },
      options.cd,
    );
  }
}

async function handleCancel(options) {
  const cancelled = await cancelJobs({ all: options.all, jobId: options.jobId, cwd: options.cd });
  printResult(options, { ok: true, cancelled }, `Cancelled ${cancelled.join(", ")}`);
}

export async function runMain(argv = process.argv.slice(2)) {
  const { subcommand, options } = parseArgs(argv);
  if (subcommand === "setup") return handleSetup(options);
  if (subcommand === "plan") return handlePlan(options);
  if (subcommand === "run") return handleRun(options);
  if (subcommand === "status") return handleStatus(options);
  if (subcommand === "result") return handleResult(options);
  if (subcommand === "cancel") return handleCancel(options);
  if (subcommand === "monitor") return handleMonitor(options);
  throw new Error(`unknown subcommand: ${subcommand}`);
}

if (process.argv[1]?.endsWith("multitask-companion.mjs")) {
  runMain().catch((error) => {
    if (process.argv.includes("--json")) printJson({ ok: false, error: error.message });
    else process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
