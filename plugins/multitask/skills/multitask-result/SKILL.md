---
name: multitask-result
description: Show the final report for a Codex multitask job.
---

# Multitask Result

Run the companion command directly. Do not inspect plugin source, scripts, or docs unless the user explicitly asks to debug the plugin.

Keep narration minimal. Return the final report; do not add an extra process summary unless the user asks for evaluation.

```bash
node plugins/multitask/scripts/multitask-companion.mjs result
node plugins/multitask/scripts/multitask-companion.mjs result <jobId>
node plugins/multitask/scripts/multitask-companion.mjs result <jobId> --json
```
