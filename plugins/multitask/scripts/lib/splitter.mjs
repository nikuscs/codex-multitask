import fs from "node:fs/promises";
import path from "node:path";

import { buildExecArgs, getCodexCommand, MODEL_CATALOG, resolveSchemaPath } from "./codex.mjs";
import { spawnStreaming } from "./process.mjs";
import { readPrompt } from "./assets.mjs";
import { validatePlan } from "./plan-validate.mjs";

export async function buildSplitterPrompt(options) {
  const template = await readPrompt("splitter.md");
  const goal = options.planFile
    ? await withPlanFile(options.prompt, options.planFile, options.cd)
    : options.prompt;
  return `${template}\n\nUSER_GOAL:\n${goal}\n\nTARGET_WORKER_COUNT: ${options.workers}\nDEFAULT_MODEL: ${options.workerModel}\nDEFAULT_EFFORT: ${options.workerEffort}\nDEFAULT_SANDBOX: ${options.sandbox}\nAVAILABLE_MODELS: ${MODEL_CATALOG.join(", ")}\n`;
}

async function withPlanFile(prompt, planFile, cwd) {
  const resolved = path.resolve(cwd, planFile);
  const text = await fs.readFile(resolved, "utf8");
  return `--- PLAN FILE: ${planFile} ---\n${text}\n--- END PLAN FILE ---\n\n${prompt}`;
}

export async function runSplitter(options, jobDir) {
  const lastMessageFile = path.join(jobDir, "splitter.last.txt");
  const stdoutFile = path.join(jobDir, "splitter.jsonl");
  const prompt = await buildSplitterPrompt(options);
  const args = buildExecArgs({
    cwd: options.cd,
    effort: options.splitterEffort,
    fullAuto: false,
    lastMessageFile,
    model: options.useCodexDefaultModel ? null : options.splitterModel,
    outputSchema: resolveSchemaPath("split-plan.schema.json"),
    profile: options.profile,
    prompt,
    sandbox: "read-only",
  });

  const child = spawnStreaming(getCodexCommand(), args, { cwd: options.cd });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise((resolve) =>
    child.on("close", (exitCode) => resolve(exitCode ?? 0)),
  );
  await fs.writeFile(stdoutFile, stdout, "utf8");
  if (code !== 0) throw new Error(stderr.trim() || `splitter exited ${code}`);
  const text = (await fs.readFile(lastMessageFile, "utf8").catch(() => stdout)).trim();
  const plan = validatePlan(JSON.parse(text), {
    maxWorkers: options.workers,
    availableModels: MODEL_CATALOG,
  });
  await fs.writeFile(path.join(jobDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return plan;
}
