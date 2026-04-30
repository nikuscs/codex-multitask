#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    process.stdout.write("codex-cli 0.125.0\n");
    return;
  }
  if (args[0] === "exec" && args.includes("--help")) {
    process.stdout.write("Usage: codex exec --json -m --model --output-schema\n");
    return;
  }
  if (args[0] !== "exec") throw new Error(`unexpected fake-codex args: ${args.join(" ")}`);

  const cwd = argValue(args, "-C") ?? process.cwd();
  const lastFile = argValue(args, "-o");
  const prompt = args.at(-1) ?? "";
  const isSplitter = args.includes("--output-schema");

  process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "fake-thread" })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "turn.started" })}\n`);

  if (isSplitter) {
    const plan = JSON.parse(process.env.FAKE_CODEX_PLAN_JSON ?? defaultPlan());
    await fs.writeFile(lastFile, `${JSON.stringify(plan)}\n`, "utf8");
  } else {
    if (
      process.env.FAKE_CODEX_MODEL_UNAVAILABLE &&
      !args.includes("gpt-5.4-mini") &&
      !args.includes("gpt-5.4")
    ) {
      process.stderr.write("model unavailable\n");
      process.exitCode = 1;
      return;
    }
    if (process.env.FAKE_CODEX_FAIL_ONCE) {
      const marker = path.join(
        os.tmpdir(),
        `fake-codex-failed-once-${process.env.CODEX_THREAD_ID ?? "default"}`,
      );
      try {
        await fs.access(marker);
      } catch {
        await fs.writeFile(marker, "failed\n", "utf8");
        process.stderr.write("transient failure\n");
        process.exitCode = 1;
        return;
      }
    }
    const owned = [...prompt.matchAll(/^- (.+)$/gm)]
      .map((match) => match[1])
      .filter((file) => file !== "none");
    const target = owned[0] ?? "worker.txt";
    await fs.mkdir(path.dirname(path.join(cwd, target)), { recursive: true });
    await fs.writeFile(path.join(cwd, target), `written by fake codex for ${target}\n`, "utf8");
    if (process.env.FAKE_CODEX_UNAUTHORIZED_PATH) {
      await fs.writeFile(
        path.join(cwd, process.env.FAKE_CODEX_UNAUTHORIZED_PATH),
        "unauthorized\n",
        "utf8",
      );
    }
    await fs.writeFile(lastFile, `STATUS: ok\nTouched ${target}.\n`, "utf8");
  }

  process.stdout.write(
    `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } })}\n`,
  );
}

function defaultPlan() {
  return JSON.stringify({
    summary: "fake plan",
    workers: [
      {
        id: "w1",
        title: "one",
        prompt: "Create a.txt",
        owned_files: ["a.txt"],
        read_only_files: [],
        depends_on: [],
        model: null,
        effort: null,
        sandbox: null,
      },
      {
        id: "w2",
        title: "two",
        prompt: "Create b.txt",
        owned_files: ["b.txt"],
        read_only_files: [],
        depends_on: [],
        model: null,
        effort: null,
        sandbox: null,
      },
    ],
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
