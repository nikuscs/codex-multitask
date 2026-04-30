---
name: multitask-status
description: Show the latest or selected Codex multitask job status.
---

# Multitask Status

Run the companion command directly. Do not inspect plugin source, scripts, or docs unless the user explicitly asks to debug the plugin.

Keep narration minimal. Report the job status and worker statuses only.

```bash
node plugins/multitask/scripts/multitask-companion.mjs status
node plugins/multitask/scripts/multitask-companion.mjs status <jobId>
node plugins/multitask/scripts/multitask-companion.mjs status <jobId> --watch
node plugins/multitask/scripts/multitask-companion.mjs status --json
```
