# Privacy Policy

This project is an open-source Codex plugin that runs Codex CLI commands on the user's machine.

## What This Plugin Does

- runs local Codex CLI commands requested by the user
- stores local runtime state under the user's Codex cache directory
- reads local repository state when the user runs plan, run, status, result, or cancel flows

## What The Project Author Collects

The project author does not operate a hosted backend for this plugin and does not directly collect usage analytics, account data, or repository contents through the plugin itself.

## Third-Party Services

When you use this plugin, your usage may involve third-party tools and services that are outside this repository, including:

- Codex
- OpenAI services used by Codex CLI
- GitHub, if you install or update the plugin from GitHub

Those services are governed by their own policies.

## Local Data

The plugin stores local runtime data on the user's machine, including job state, logs, worker JSONL streams, final messages, patches, and session metadata, to support status, result retrieval, cancellation, and session-aware behavior.

## Contact

For repository issues or questions, use the GitHub repository:

- https://github.com/nikuscs/codex-multitask
