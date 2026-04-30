---
name: multitask-cancel
description: Cancel a running Codex multitask job.
---

# Multitask Cancel

Run the companion command directly. Do not inspect plugin source, scripts, or docs before running unless the user explicitly asks to debug the plugin.

Keep narration minimal: report which job ids were cancelled.

Cancel a running multitask job. Cancellation sends `SIGTERM`, waits briefly, then escalates to `SIGKILL` for any remaining worker process trees.

```bash
node plugins/multitask/scripts/multitask-companion.mjs cancel <jobId>
node plugins/multitask/scripts/multitask-companion.mjs cancel --all
node plugins/multitask/scripts/multitask-companion.mjs cancel <jobId> --json
```
