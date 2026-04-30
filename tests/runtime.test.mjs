import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseArgs } from "../plugins/multitask/scripts/lib/args.mjs";
import { buildExecArgs } from "../plugins/multitask/scripts/lib/codex.mjs";
import { validatePlan } from "../plugins/multitask/scripts/lib/plan-validate.mjs";
import { getWorkspaceDescriptor } from "../plugins/multitask/scripts/lib/workspace.mjs";
import { readJson } from "../plugins/multitask/scripts/lib/state.mjs";

const execFileAsync = promisify(execFile);
const runtimeScript = path.resolve("plugins/multitask/scripts/multitask-companion.mjs");
const fakeCodexScript = path.resolve("tests/fixtures/fake-codex.mjs");

async function createHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-multitask-"));
  const workspace = path.join(root, "workspace");
  const stateRoot = path.join(root, "state");
  await fs.mkdir(workspace, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: workspace });
  await execFileAsync("git", ["config", "user.name", "Codex Test"], { cwd: workspace });
  await execFileAsync("git", ["config", "user.email", "codex@example.com"], { cwd: workspace });
  await fs.writeFile(path.join(workspace, "README.md"), "test\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: workspace });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspace });
  const env = {
    ...process.env,
    CODEX_BIN: process.execPath,
    CODEX_BIN_ARGS_JSON: JSON.stringify([fakeCodexScript]),
    CODEX_MULTITASK_HANDOFF_ROOT: stateRoot,
    CODEX_THREAD_ID: "thread-a",
  };
  return { root, workspace, stateRoot, env };
}

async function runCli(harness, args, extraEnv = {}) {
  const { stdout } = await execFileAsync(process.execPath, [runtimeScript, ...args], {
    cwd: harness.workspace,
    env: { ...harness.env, ...extraEnv },
  });
  return args.includes("--json") ? JSON.parse(stdout) : stdout;
}

test("parseArgs extracts multitask options", () => {
  const parsed = parseArgs([
    "run",
    "--workers",
    "5",
    "--retry-failed",
    "2",
    "--run-timeout",
    "1s",
    "--watch",
    "--isolated-workspaces",
    "fix",
    "bug",
  ]);
  assert.equal(parsed.subcommand, "run");
  assert.equal(parsed.options.workers, 5);
  assert.equal(parsed.options.retryFailed, 2);
  assert.equal(parsed.options.runTimeoutMs, 1000);
  assert.equal(parsed.options.watch, true);
  assert.equal(parsed.options.isolatedWorkspaces, true);
  assert.equal(parsed.options.prompt, "fix bug");
});

test("parseArgs uses fast splitter defaults for easy read-only tasks", () => {
  const parsed = parseArgs(["run", "Map this repo and explain what it does"]);

  assert.equal(parsed.options.splitterModel, "gpt-5.4-mini");
  assert.equal(parsed.options.splitterEffort, "low");
});

test("parseArgs keeps smart splitter defaults for implementation tasks", () => {
  const parsed = parseArgs(["run", "Implement the auth refactor"]);

  assert.equal(parsed.options.splitterModel, "gpt-5.5");
  assert.equal(parsed.options.splitterEffort, "medium");
});

test("workspace descriptor uses multitask handoff root", () => {
  const descriptor = getWorkspaceDescriptor("/tmp/example-project");
  assert.match(descriptor.stateRoot, /multitask-handoff/);
});

test("plugin metadata asset references exist", async () => {
  const pluginRoot = path.resolve("plugins/multitask");
  const manifest = await readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  const assetPaths = [
    manifest.interface.composerIcon,
    manifest.interface.logo,
    ...manifest.interface.screenshots,
  ];

  for (const assetPath of assetPaths) {
    await fs.access(path.join(pluginRoot, assetPath));
  }

  await fs.access(path.resolve("assets/codex-plugin-screenshot.svg"));
});

test("buildExecArgs uses codex exec json primitive", () => {
  const args = buildExecArgs({
    cwd: "/tmp/repo",
    lastMessageFile: "/tmp/last",
    model: "gpt-5.4-mini",
    effort: "low",
    sandbox: "workspace-write",
    prompt: "do it",
  });
  assert.deepEqual(args.slice(0, 3), ["exec", "--json", "--full-auto"]);
  assert(args.includes("--skip-git-repo-check"));
  assert(args.includes("gpt-5.4-mini"));
});

test("validatePlan rejects overlapping owned files and cycles", () => {
  assert.throws(
    () =>
      validatePlan({
        summary: "bad",
        workers: [
          {
            id: "w1",
            title: "",
            prompt: "x",
            owned_files: ["a.txt"],
            read_only_files: [],
            depends_on: ["w2"],
          },
          {
            id: "w2",
            title: "",
            prompt: "x",
            owned_files: ["a.txt"],
            read_only_files: [],
            depends_on: ["w1"],
          },
        ],
      }),
    /owned by both|dependency cycle/,
  );
});

test("validatePlan repairs same-worker owned and read-only overlap", () => {
  const plan = validatePlan({
    summary: "repair",
    workers: [
      {
        id: "w1",
        title: "one",
        prompt: "x",
        owned_files: ["a.txt", "a.txt"],
        read_only_files: ["a.txt", "b.txt", "b.txt"],
        depends_on: [],
      },
    ],
  });

  assert.deepEqual(plan.workers[0].owned_files, ["a.txt"]);
  assert.deepEqual(plan.workers[0].read_only_files, ["b.txt"]);
});

test("validatePlan allows no-write research workers", () => {
  const plan = validatePlan({
    summary: "research",
    workers: [
      {
        id: "repo-structure",
        title: "Repository structure",
        prompt: "Map the repository structure without editing files.",
        owned_files: [],
        read_only_files: ["README.md"],
        depends_on: [],
        sandbox: "read-only",
      },
      {
        id: "domain-map",
        title: "Domain map",
        prompt: "Map domain concepts without editing files.",
        owned_files: [],
        read_only_files: ["README.md"],
        depends_on: [],
        sandbox: "read-only",
      },
    ],
  });

  assert.equal(plan.workers[0].owned_files.length, 0);
  assert.equal(plan.workers[1].owned_files.length, 0);
});

test("plan command runs splitter and returns validated plan", async () => {
  const harness = await createHarness();
  const result = await runCli(harness, ["plan", "--json", "Make", "files"]);
  assert.equal(result.ok, true);
  assert.equal(result.plan.workers.length, 2);
});

test("shared run creates new files and audits owned paths", async () => {
  const harness = await createHarness();
  const result = await runCli(harness, ["run", "--json", "Make", "files"]);
  assert.equal(result.ok, true);
  assert.equal(result.job.status, "completed");
  assert.equal(
    await fs.readFile(path.join(harness.workspace, "a.txt"), "utf8"),
    "written by fake codex for a.txt\n",
  );
  assert.deepEqual(result.job.audit.unauthorized, []);
  assert.equal(
    typeof (await fs.readFile(path.join(result.job.jobDir, "baseline.diff"), "utf8")),
    "string",
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(result.job.jobDir, "baseline-untracked.json"), "utf8")),
    [],
  );
});

test("shared run reports unauthorized new files without reverting", async () => {
  const harness = await createHarness();
  const result = await runCli(harness, ["run", "--json", "Make", "files"], {
    FAKE_CODEX_UNAUTHORIZED_PATH: "evil.txt",
  });
  assert.equal(result.ok, false);
  assert.equal(result.job.status, "needs-review");
  assert(result.job.audit.unauthorized.includes("evil.txt"));
  assert.equal(
    await fs.readFile(path.join(harness.workspace, "evil.txt"), "utf8"),
    "unauthorized\n",
  );
});

test("isolated run copies new owned files back", async () => {
  const harness = await createHarness();
  const result = await runCli(harness, ["run", "--isolated-workspaces", "--json", "Make", "files"]);
  assert.equal(result.ok, true);
  assert.equal(
    await fs.readFile(path.join(harness.workspace, "a.txt"), "utf8"),
    "written by fake codex for a.txt\n",
  );
  assert.equal(
    await fs.readFile(path.join(harness.workspace, "b.txt"), "utf8"),
    "written by fake codex for b.txt\n",
  );
  assert.match(
    await fs.readFile(path.join(result.job.jobDir, "patches", "w1.patch"), "utf8"),
    /a\.txt/,
  );
});

test("retry-failed re-runs failed workers", async () => {
  const harness = await createHarness();
  const result = await runCli(harness, ["run", "--retry-failed", "1", "--json", "Make", "files"], {
    FAKE_CODEX_FAIL_ONCE: "1",
  });
  assert.equal(result.ok, true);
});

test("background run records pids and status can read job", async () => {
  const harness = await createHarness();
  const started = await runCli(harness, ["run", "--background", "--json", "Make", "files"]);
  assert.equal(started.ok, true);
  assert.equal(started.job.status, "running");
  assert.equal(started.job.pids.length, 2);
  const status = await runCli(harness, ["status", started.job.id, "--json"]);
  assert.equal(status.job.id, started.job.id);
});

test("background monitor finalizes without status polling", async () => {
  const harness = await createHarness();
  const started = await runCli(harness, ["run", "--background", "--json", "Make", "files"]);

  let job;
  const jobFile = path.join(path.dirname(started.job.jobDir), `${started.job.id}.json`);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    job = JSON.parse(await fs.readFile(jobFile, "utf8"));
    if (job.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.equal(job.status, "completed");
  assert.equal(job.summaries.length, 2);
  assert.deepEqual(job.pids, []);
});

test("status harvests completed background workers", async () => {
  const harness = await createHarness();
  const started = await runCli(harness, ["run", "--background", "--json", "Make", "files"]);

  let status;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    status = await runCli(harness, ["status", started.job.id, "--json"]);
    if (status.job.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(status.job.status, "completed");
  assert.equal(status.job.summaries.length, 2);
  assert(Number.isFinite(status.job.summaries[0].durationMs));
  assert(status.job.summaries[0].startedAt);
  assert(status.job.summaries[0].completedAt);
  assert.deepEqual(status.job.audit.unauthorized, []);
  assert.deepEqual(status.job.pids, []);
});

test("status harvests terminal workers even with stale live pids", async () => {
  const harness = await createHarness();
  const started = await runCli(harness, ["run", "--background", "--json", "Make", "files"]);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const messages = await Promise.all(
      started.job.plan.workers.map((worker) =>
        fs
          .readFile(path.join(started.job.jobDir, "workers", `${worker.id}.last.txt`), "utf8")
          .catch(() => ""),
      ),
    );
    if (messages.every((message) => /^STATUS: ok\b/m.test(message))) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const jobFile = path.join(path.dirname(started.job.jobDir), `${started.job.id}.json`);
  const job = JSON.parse(await fs.readFile(jobFile, "utf8"));
  await fs.writeFile(
    jobFile,
    `${JSON.stringify({ ...job, status: "running", pids: [{ workerId: "stale", pid: process.pid }] }, null, 2)}\n`,
    "utf8",
  );

  const status = await runCli(harness, ["status", started.job.id, "--json"]);
  assert.equal(status.job.status, "completed");
  assert.equal(status.job.summaries.length, 2);
  assert.deepEqual(status.job.pids, []);
});

test("plain result includes worker final messages and real durations", async () => {
  const harness = await createHarness();
  const started = await runCli(harness, ["run", "--background", "--json", "Make", "files"]);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await runCli(harness, ["status", started.job.id, "--json"]);
    if (status.job.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const result = await runCli(harness, ["result", started.job.id]);
  assert.match(result, /\[w1\] ok\nSTATUS: ok/);
  assert.match(result, /Touched a\.txt/);
  assert.doesNotMatch(result, / ok 0ms/);
});
