export function renderPlan(plan) {
  return [
    `Plan: ${plan.summary || "multitask"}`,
    ...plan.workers.map(
      (worker) => `${worker.id} ${worker.title} (${worker.owned_files.join(", ")})`,
    ),
  ].join("\n");
}

export function renderStatus(job) {
  if (!job) return "No job found.";
  const rows = [`${job.id} ${job.status}`];
  for (const summary of job.summaries ?? [])
    rows.push(
      [summary.workerId, summary.status, formatDuration(summary.durationMs)]
        .filter(Boolean)
        .join(" "),
    );
  for (const pid of job.pids ?? []) rows.push(`${pid.workerId} running pid=${pid.pid}`);
  return rows.join("\n");
}

export function renderResult(job) {
  const rows = [renderStatus(job)];
  if (job?.audit?.unauthorized?.length)
    rows.push(`Unauthorized paths: ${job.audit.unauthorized.join(", ")}`);
  for (const summary of job?.summaries ?? []) {
    if (!summary.finalMessage) continue;
    rows.push(`\n[${summary.workerId}] ${summary.status}\n${summary.finalMessage}`);
  }
  return rows.join("\n");
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}
