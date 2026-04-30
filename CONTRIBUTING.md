# Contributing

Thanks for contributing.

## Development

Requirements:

- Node.js 20+
- Bun
- Codex CLI installed for runtime smoke tests

Install dependencies:

```sh
bun install
```

Run the full check suite:

```sh
bun run check
```

That runs:

- `oxlint`
- `oxfmt --check`
- `node --test tests/runtime.test.mjs`

## Plugin Development

The Codex plugin bundle lives in `plugins/multitask`.

For local testing from this repo:

```sh
codex plugin marketplace add .
```

For direct runtime testing from this repo:

```sh
node plugins/multitask/scripts/multitask-companion.mjs setup
```

## Pull Requests

- Keep changes focused.
- Update docs when install, behavior, or UX changes.
- Add or update tests when behavior changes.
- Do not commit secrets, auth tokens, or local machine state.

## Reporting Issues

When filing a bug, include:

- Codex version
- OS
- exact command or skill invoked
- actual output
- expected output
