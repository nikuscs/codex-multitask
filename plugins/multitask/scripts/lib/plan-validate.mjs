const EFFORTS = new Set(["low", "medium", "high", null]);
const SANDBOXES = new Set(["read-only", "workspace-write", "danger-full-access", null]);

export function normalizePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("splitter output must be an object");
  const workers = Array.isArray(plan.workers) ? plan.workers : [];
  return {
    summary: String(plan.summary ?? ""),
    workers: workers.map((worker, index) => {
      const ownedFiles = uniqueStrings(worker.owned_files);
      return {
        id: String(worker.id ?? `w${index + 1}`),
        title: String(worker.title ?? worker.id ?? `Worker ${index + 1}`),
        prompt: String(worker.prompt ?? ""),
        owned_files: ownedFiles,
        read_only_files: uniqueStrings(worker.read_only_files).filter(
          (file) => !ownedFiles.includes(file),
        ),
        depends_on: uniqueStrings(worker.depends_on),
        model: worker.model ?? null,
        effort: worker.effort ?? null,
        sandbox: worker.sandbox ?? null,
      };
    }),
  };
}

function uniqueStrings(value) {
  return Array.isArray(value) ? [...new Set(value.map(String))] : [];
}

export function validatePlan(plan, { maxWorkers = 12, availableModels = [] } = {}) {
  const normalized = normalizePlan(plan);
  const errors = [];
  if (normalized.workers.length < 1) errors.push("plan must contain at least one worker");
  if (normalized.workers.length > maxWorkers)
    errors.push(`plan has ${normalized.workers.length} workers; maximum is ${maxWorkers}`);

  const ids = new Set();
  const owners = new Map();
  for (const worker of normalized.workers) {
    if (ids.has(worker.id)) errors.push(`duplicate worker id: ${worker.id}`);
    ids.add(worker.id);
    if (!worker.prompt.trim()) errors.push(`${worker.id} has an empty prompt`);
    if (!EFFORTS.has(worker.effort))
      errors.push(`${worker.id} has invalid effort: ${worker.effort}`);
    if (!SANDBOXES.has(worker.sandbox))
      errors.push(`${worker.id} has invalid sandbox: ${worker.sandbox}`);
    if (worker.model && availableModels.length && !availableModels.includes(worker.model))
      errors.push(`${worker.id} model is unavailable: ${worker.model}`);
    for (const file of worker.owned_files) {
      if (owners.has(file))
        errors.push(`${file} is owned by both ${owners.get(file)} and ${worker.id}`);
      owners.set(file, worker.id);
    }
  }

  for (const worker of normalized.workers) {
    for (const dep of worker.depends_on) {
      if (!ids.has(dep)) errors.push(`${worker.id} depends on unknown worker ${dep}`);
    }
  }
  errors.push(...detectCycles(normalized.workers));
  if (errors.length) throw new Error(errors.join("; "));
  return normalized;
}

function detectCycles(workers) {
  const byId = new Map(workers.map((worker) => [worker.id, worker]));
  const visiting = new Set();
  const visited = new Set();
  const errors = [];
  function visit(id, trail = []) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    visiting.add(id);
    for (const dep of byId.get(id)?.depends_on ?? []) visit(dep, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const worker of workers) visit(worker.id);
  return errors;
}

export function planWaves(workers) {
  const pending = new Map(workers.map((worker) => [worker.id, worker]));
  const done = new Set();
  const waves = [];
  while (pending.size) {
    const wave = [...pending.values()].filter((worker) =>
      worker.depends_on.every((id) => done.has(id)),
    );
    if (!wave.length) throw new Error("cannot schedule plan with unresolved dependencies");
    waves.push(wave);
    for (const worker of wave) {
      pending.delete(worker.id);
      done.add(worker.id);
    }
  }
  return waves;
}
