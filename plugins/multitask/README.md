# Multitask Plugin

This plugin runs one Codex splitter and then fans out parallel Codex workers with explicit file ownership.

## Requirements

- Codex CLI installed and on `PATH`
- Codex CLI authenticated
- Node.js `20+`
- Git repository for shared-workspace diff auditing

## Install

You do not need a published marketplace release for local development.

People are mainly distributing Codex plugins in three ways:

1. Codex CLI marketplace install: `codex plugin marketplace add owner/repo`
2. Repo-local: clone the repo and let Codex read `.agents/plugins/marketplace.json`
3. Standalone CLI: install the compiled `codex-multitask` binary and call it from Codex CLI with `!multitask ...`

### Option 1. Published Install

```sh
codex plugin marketplace add nikuscs/codex-multitask
```

This is the intended install path once this repository is published.

### Option 2. Repo-Local Install

From the repository root:

```sh
codex plugin marketplace add .
```

Then restart Codex. The marketplace appears as `Codex Multitask Local` so it can coexist with other local plugin marketplaces such as the Claude plugin's `Local Repo Plugins`.

### Option 3. Standalone CLI

Install the standalone CLI command after release binaries are published:

```sh
curl -fsSL https://raw.githubusercontent.com/nikuscs/codex-multitask/main/scripts/install.sh | bash
```

Then use it in Codex CLI as a shell command:

```text
!multitask setup
!multitask run --workers 4 "Implement this change"
```

### Verify

After install, Codex should expose the Multitask skills in the skill picker and plugin directory. Codex may render installed plugin actions with UI labels, but the stable skill names are lowercase.

Look for:

- `multitask-setup`
- `multitask-plan`
- `multitask-run`
- `multitask-status`
- `multitask-result`
- `multitask-cancel`

Then run:

```text
Use the skill multitask-setup
```

If Codex runs the skill instead of searching for `SKILL.md`, the plugin is installed correctly.

In Codex CLI, use the standalone binary instead:

```text
!multitask setup
```

## Runtime

The shared runtime lives at `plugins/multitask/scripts/multitask-companion.mjs`.

Implemented subcommands:

1. `setup`
2. `plan`
3. `run`
4. `status`
5. `result`
6. `cancel`

## State

Runtime state is stored under:

`~/.codex/cache/multitask-handoff/<workspace-slug>-<hash>/`

Each workspace gets:

1. `workspace.json`
2. `jobs/<job-id>.json`
3. `logs/`
4. `sessions/<codex-session-id>.json`
5. `runtime.json`

Each multitask job also stores per-worker JSONL streams, final messages, and summaries under its job directory.

## Hooks

Repo-local hook config is wired through:

1. `.codex/config.toml`
2. `.codex/hooks.json`

The plugin also ships reference hook config in `plugins/multitask/hooks/hooks.json`.

## Current Status

The core runtime is implemented and locally installable. See the root `README.md` for remaining gaps against `final_plan.md`.
