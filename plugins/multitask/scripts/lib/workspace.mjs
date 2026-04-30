import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

function slugifySegment(input) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

export function getWorkspaceRoot(cwd = process.cwd()) {
  return path.resolve(cwd);
}

export function getWorkspaceDescriptor(cwd = process.cwd()) {
  const root = getWorkspaceRoot(cwd);
  const base = path.basename(root);
  const hash = crypto.createHash("sha1").update(root).digest("hex").slice(0, 10);
  const slug = `${slugifySegment(base)}-${hash}`;
  const cacheBase =
    process.env.CODEX_MULTITASK_HANDOFF_ROOT ||
    path.join(os.homedir(), ".codex", "cache", "multitask-handoff");
  const stateRoot = path.join(cacheBase, slug);
  return {
    root,
    slug,
    stateRoot,
    jobsDir: path.join(stateRoot, "jobs"),
    logsDir: path.join(stateRoot, "logs"),
    sessionsDir: path.join(stateRoot, "sessions"),
    runtimeFile: path.join(stateRoot, "runtime.json"),
    workspaceFile: path.join(stateRoot, "workspace.json"),
  };
}
