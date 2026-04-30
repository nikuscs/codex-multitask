---
name: multitask-setup
description: Run Codex multitask setup checks for the current repository and report Codex CLI availability and runtime configuration.
---

# Multitask Setup

Run the companion command directly. Do not inspect plugin source, scripts, or docs before running unless the user explicitly asks to debug the plugin.

Keep narration minimal: report whether setup passed and any actionable failure.

Run the Multitask companion setup flow for the current repository.

Use:

```bash
node plugins/multitask/scripts/multitask-companion.mjs setup
```

Add `--json` for machine-readable output.
