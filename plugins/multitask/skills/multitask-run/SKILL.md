---
name: multitask-run
description: Split a task into parallel Codex workers and execute it.
---

# Multitask Run

Run the companion command directly. Do not inspect plugin source, scripts, or docs before running unless the user explicitly asks to debug the plugin.

Keep narration minimal: print the job id when started, then report the final result. Do not explain normal planner choices such as using fewer than the maximum requested workers.

`--workers` means "up to this many workers", not exactly this many workers.

Examples:

```bash
node plugins/multitask/scripts/multitask-companion.mjs run --workers 4 "Implement the requested change."
node plugins/multitask/scripts/multitask-companion.mjs run --workers 4 --background "Map this repo."
node plugins/multitask/scripts/multitask-companion.mjs run --workers 4 --isolated-workspaces "Make this risky change safely."
```
