# `@jini-ai/plugin-github`

Portable Agent Plugins payload with one skill, `github`, and the GitHub modules it owns: the
source-control provider (`source-control/`), the GitHub deployments adapter (`deployments/`) and the
`github-actions` deploy-ops platform (`deploy-ops/`). All are plain JavaScript with no npm imports.
Installing this package downloads only this plugin; it has no runtime or plugin dependencies, no MCP
server and adds no tool: it drives the host's native credential, source-control, backup and
deployment tools.

Resolve `@jini-ai/plugin-github/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **1.1.0**
and changes only when the plugin content changes. The publisher id stays `tovu/github`. The
`./github/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/github`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts github`) generates only `github/` here. The plugin-local
`node:test` suites under `packages/agent-plugins/github/**/__tests__` are not shipped.

## What the plugin holds

- `SKILL.md` and `references/` — the rules generic GitHub knowledge gets wrong: a repository secret
  is the human's step, a 204 dispatch means queued, a workflow fires only on its trigger's branch, a
  403 on an org-wide listing is a token boundary, and editing a file means diffing MODIFIED files.
  References cover Actions, tokens, repository files, site backup and source control.
- `source-control/` — committing the site's rendered export, atomic file writes and the site backup
  push through the kit the host passes in.
- `deployments/github.mjs` — GitHub deployments for a git-revision release.
- `deploy-ops/github-actions.mjs` — resolves a ref to a full SHA, dispatches the host's deploy
  workflow pinned to it and follows the run.
- `tovu-source-control.json`, `tovu-deploy-ops.json` — the host contribution files naming those
  modules.

Frozen identifiers are unchanged: the contribution file names and the `.tovu/managed-files.json`
ownership manifest written into users' repositories.

## Host guidance

The shipped text is host-neutral. The deploy workflow's own inputs (for example a pinned-SHA input),
how the host is started with its Site key, and whether a restore tool exists come from the host's
plugin-guidance wiring, not from this payload.
