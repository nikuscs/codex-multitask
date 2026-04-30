import fs from "node:fs/promises";
import path from "node:path";

import { cancelJob } from "./orchestrator.mjs";
import { getCurrentCodexSessionId, ensureWorkspaceState } from "./state.mjs";
import { createJobId, listJobs, loadJob, saveJob, updateJob } from "./tracked-jobs.mjs";

export function isActiveStatus(status) {
  return status === "queued" || status === "running";
}

export async function createMultitaskJob(extra = {}, cwd = process.cwd()) {
  const workspace = await ensureWorkspaceState(cwd);
  const id = createJobId("multitask");
  const jobDir = path.join(workspace.jobsDir, id);
  await fs.mkdir(jobDir, { recursive: true });
  const job = {
    id,
    kind: "multitask",
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    codexSessionId: getCurrentCodexSessionId(),
    jobDir,
    ...extra,
  };
  await saveJob(job, cwd);
  return job;
}

export async function resolveJob(jobId, cwd = process.cwd()) {
  if (jobId) {
    const job = await loadJob(jobId, cwd);
    if (!job) throw new Error("job not found");
    return job;
  }
  const jobs = await listJobs(cwd, { codexSessionId: getCurrentCodexSessionId() });
  const job = jobs[0];
  if (!job) throw new Error("no multitask jobs found");
  return job;
}

export async function cancelJobs({ all = false, jobId = null, cwd = process.cwd() } = {}) {
  const jobs = all
    ? (await listJobs(cwd)).filter((job) => isActiveStatus(job.status))
    : [await resolveJob(jobId, cwd)];
  const cancelled = [];
  for (const job of jobs) {
    const killedWorkers = await cancelJob(job);
    await updateJob(job.id, { status: "cancelled", killedWorkers }, cwd);
    cancelled.push(job.id);
  }
  return cancelled;
}

export async function cleanupSessionJobs(
  sessionId = getCurrentCodexSessionId(),
  cwd = process.cwd(),
) {
  if (!sessionId) return { cleanedJobIds: [], killedJobIds: [] };
  const jobs = (await listJobs(cwd, { codexSessionId: sessionId })).filter((job) =>
    isActiveStatus(job.status),
  );
  const killedJobIds = [];
  for (const job of jobs) {
    await cancelJob(job);
    await updateJob(job.id, { status: "cancelled", cancelledAt: new Date().toISOString() }, cwd);
    killedJobIds.push(job.id);
  }
  return { cleanedJobIds: jobs.map((job) => job.id), killedJobIds };
}
