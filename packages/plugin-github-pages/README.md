# `@jini-ai/plugin-github-pages`

Portable Agent Plugins payload for GitHub Pages: publish static exports to a GitHub Pages branch with the person's own token. Installing this package downloads
only this plugin; it has no runtime or plugin dependencies and no MCP server.

Resolve `@jini-ai/plugin-github-pages/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0** and
changes only when the plugin content changes. The publisher id stays `tovu/github-pages`. The
`./github-pages/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/github-pages`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts github-pages`) generates only `github-pages/` here. The plugin-local
`node:test` suites (`__tests__`) are not shipped.

## What the payload holds

- `skills/github-pages/SKILL.md` — token permissions, the owner and repository, the address and base path, and each failure in plain words.
- `targets/github-pages.mjs` — the deploy-target module declared in `tovu-deploy-targets.json` (adds `.nojekyll`, the `/<repo>` base path and owner/repo/branch validation).
- `plugin.json` — the GitHub Pages credential card.

The modules receive the host's deploy kit (`fetch`, timeouts, URL checks, `DeployError`) in its
positional form and import nothing outside this folder.

## Frozen names

Hosts and live sites already store these, so they never change: the `tovu-*.json` contribution file names, the `github-pages` target id and credential-card target, and the `gh-pages` default branch.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
