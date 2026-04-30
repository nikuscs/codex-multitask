---
name: multitask-plan
description: Produce a Codex multitask worker plan without executing workers.
---

# Multitask Plan

Run the companion command directly. Do not inspect plugin source, scripts, or docs before running unless the user explicitly asks to debug the plugin.

Keep narration minimal: return the planned workers only. `--workers` means "up to this many workers", not exactly this many workers.

Run the splitter only and print the worker plan without spawning workers.

Examples:

```bash
node plugins/multitask/scripts/multitask-companion.mjs plan --workers 4 "Split the auth refactor into independent workers."
node plugins/multitask/scripts/multitask-companion.mjs plan --plan-file plan.md --workers 5 "Execute this plan."
```
