#!/usr/bin/env node

import { runMain } from "../plugins/multitask/scripts/multitask-companion.mjs";

const HELP_TEXT = `codex-multitask (alias: multitask)

Run one planner Codex process, then fan out parallel Codex workers.

Usage:
  codex-multitask setup [--json]
  codex-multitask plan [--workers 4] [--plan-file <path>] [--json] <prompt>
  codex-multitask run [--workers 4] [--max-parallel N] [--background] [--isolated-workspaces] <prompt>
  codex-multitask status [<jobId>] [--json]
  codex-multitask result [<jobId>] [--json]
  codex-multitask cancel [<jobId>|--all] [--json]
`;

async function cli(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return;
  }

  await runMain(argv);
}

cli().catch((error) => {
  const payload = { ok: false, error: error.message };
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`error: ${error.message}\n`);
  }
  process.exitCode = 1;
});
