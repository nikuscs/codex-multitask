import path from "node:path";

import { runCommand } from "./process.mjs";

export const MODEL_CATALOG = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
];

export function getCodexCommand() {
  return process.env.CODEX_BIN ?? "codex";
}

export function getCodexPrefixArgs() {
  try {
    return JSON.parse(process.env.CODEX_BIN_ARGS_JSON ?? "[]");
  } catch {
    return [];
  }
}

export function buildExecArgs(spec) {
  const args = [
    ...getCodexPrefixArgs(),
    "exec",
    "--json",
    spec.fullAuto === false ? null : "--full-auto",
    "-C",
    spec.cwd,
    "--skip-git-repo-check",
  ].filter(Boolean);

  if (spec.ephemeral) args.push("--ephemeral");
  if (spec.outputSchema) args.push("--output-schema", spec.outputSchema);
  if (spec.lastMessageFile) args.push("-o", spec.lastMessageFile);
  if (spec.effort) args.push("-c", `model_reasoning_effort="${spec.effort}"`);
  if (spec.sandbox) args.push("--sandbox", spec.sandbox);
  if (spec.model) args.push("-m", spec.model);
  if (spec.profile) args.push("-p", spec.profile);
  args.push(spec.prompt);
  return args;
}

export async function detectCodex(cwd = process.cwd()) {
  const command = getCodexCommand();
  const version = await runCommand(command, [...getCodexPrefixArgs(), "--version"], { cwd });
  const help = await runCommand(command, [...getCodexPrefixArgs(), "exec", "--help"], { cwd });
  return {
    ok: version.code === 0 && help.code === 0,
    command,
    version: version.stdout.trim() || version.stderr.trim(),
    execHelpOk: help.code === 0 && /--model|-m/.test(help.stdout + help.stderr),
  };
}

export function resolveSchemaPath(name) {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "schemas", name);
}
