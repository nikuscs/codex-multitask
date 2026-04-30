import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

export async function readAsset(...segments) {
  return fs.readFile(path.join(ROOT, ...segments), "utf8");
}

export async function readPrompt(name) {
  return readAsset("prompts", name);
}
