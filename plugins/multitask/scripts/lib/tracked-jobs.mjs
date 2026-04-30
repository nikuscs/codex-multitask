import fs from "node:fs/promises";
import path from "node:path";

import { ensureWorkspaceState, readJson, writeJson } from "./state.mjs";

export function createJobId(kind = "multitask") {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `${kind}-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveJob(job, cwd = process.cwd()) {
  const workspace = await ensureWorkspaceState(cwd);
  await writeJson(path.join(workspace.jobsDir, `${job.id}.json`), job);
  return job;
}

export async function loadJob(jobId, cwd = process.cwd()) {
  const workspace = await ensureWorkspaceState(cwd);
  return readJson(path.join(workspace.jobsDir, `${jobId}.json`), null);
}

export async function listJobs(cwd = process.cwd(), filters = {}) {
  const workspace = await ensureWorkspaceState(cwd);
  const names = await fs.readdir(workspace.jobsDir);
  const jobs = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson(path.join(workspace.jobsDir, name), null)),
  );
  return jobs
    .filter(Boolean)
    .filter((job) => !filters.codexSessionId || job.codexSessionId === filters.codexSessionId)
    .sort((left, right) =>
      (left.updatedAt ?? left.createdAt ?? "") < (right.updatedAt ?? right.createdAt ?? "")
        ? 1
        : -1,
    );
}

export async function updateJob(jobId, patch, cwd = process.cwd()) {
  const current = await loadJob(jobId, cwd);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await saveJob(next, cwd);
  return next;
}
