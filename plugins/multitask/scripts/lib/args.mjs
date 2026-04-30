const BOOLEAN_FLAGS = new Set([
  "all",
  "background",
  "dry-run",
  "isolated-workspaces",
  "json",
  "no-fallback",
  "no-watch",
  "read-only",
  "use-codex-default-model",
  "watch",
]);

const JOB_ID_COMMANDS = new Set(["cancel", "monitor", "result", "status"]);

function normalizeFlagName(flag) {
  return flag.replace(/^--/, "");
}

export function splitRawArgumentString(raw) {
  const parts = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;
  for (const match of raw.matchAll(pattern)) {
    parts.push((match[1] ?? match[2] ?? match[0]).replace(/\\(["'])/g, "$1"));
  }
  return parts;
}

function numberFlag(flags, name, fallback) {
  const value = Number(flags[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function parseArgs(argv) {
  const normalizedArgv =
    argv.length === 1 && typeof argv[0] === "string" && argv[0].includes(" ")
      ? splitRawArgumentString(argv[0])
      : [...argv];
  const [subcommand = "status", ...rest] = normalizedArgv;
  const flags = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }

    const key = normalizeFlagName(item);
    const next = rest[index + 1];
    if (BOOLEAN_FLAGS.has(key) || !next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }

  const jobId =
    typeof flags["job-id"] === "string"
      ? flags["job-id"]
      : JOB_ID_COMMANDS.has(subcommand) && positionals.length
        ? positionals[0]
        : null;
  const promptPositionals = jobId && positionals[0] === jobId ? positionals.slice(1) : positionals;
  const prompt = promptPositionals.join(" ").trim();
  const workers = Math.max(1, Math.min(12, numberFlag(flags, "workers", 4)));
  const easyReadOnlyTask = isEasyReadOnlyTask(prompt);

  return {
    subcommand: flags["dry-run"] ? "plan" : subcommand,
    flags,
    positionals: promptPositionals,
    options: {
      all: Boolean(flags.all),
      background: Boolean(flags.background),
      cd: typeof flags.cd === "string" ? flags.cd : process.cwd(),
      effort: typeof flags.effort === "string" ? flags.effort : "medium",
      jobId,
      json: Boolean(flags.json),
      maxParallel: Math.max(1, Math.min(12, numberFlag(flags, "max-parallel", workers))),
      noFallback: Boolean(flags["no-fallback"]),
      noWatch: Boolean(flags["no-watch"]),
      planFile: typeof flags["plan-file"] === "string" ? flags["plan-file"] : null,
      profile: typeof flags.profile === "string" ? flags.profile : null,
      prompt,
      sandbox: flags["read-only"] ? "read-only" : (flags.sandbox ?? "workspace-write"),
      splitterEffort:
        flags["splitter-effort"] ?? flags.effort ?? (easyReadOnlyTask ? "low" : "medium"),
      splitterModel:
        flags["splitter-model"] ?? flags.model ?? (easyReadOnlyTask ? "gpt-5.4-mini" : "gpt-5.5"),
      useCodexDefaultModel: Boolean(flags["use-codex-default-model"]),
      workerEffort: flags["worker-effort"] ?? flags.effort ?? "low",
      workerModel: flags["worker-model"] ?? flags.model ?? "gpt-5.4-mini",
      workerTimeoutMs: parseDuration(flags["worker-timeout"] ?? "4m"),
      retryFailed: Math.max(0, Math.min(3, numberFlag(flags, "retry-failed", 0))),
      runTimeoutMs: parseDuration(flags["run-timeout"] ?? "20m"),
      watch: Boolean(flags.watch),
      workers,
      isolatedWorkspaces: Boolean(flags["isolated-workspaces"]),
    },
  };
}

function isEasyReadOnlyTask(prompt) {
  if (!prompt) return false;
  if (/(implement|fix|refactor|migrate|change|update|add|delete|create|write code)/i.test(prompt)) {
    return false;
  }
  return /(read[- ]?only|orient|orientation|recon|reconnaissance|map|explain|what.*repo|what.*codebase|review|audit|inspect|summari[sz]e)/i.test(
    prompt,
  );
}

export function parseDuration(value) {
  if (typeof value === "number") return value;
  const match = String(value).match(/^(\d+)(ms|s|m)?$/);
  if (!match) return 240_000;
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  return unit === "m" ? amount * 60_000 : unit === "s" ? amount * 1000 : amount;
}
