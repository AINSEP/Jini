# `@jini-ai/plugin-netlify`

Portable Agent Plugins payload for Netlify: publish static exports to Netlify sites with the person's own token. Installing this package downloads
only this plugin; it has no runtime or plugin dependencies and no MCP server.

Resolve `@jini-ai/plugin-netlify/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0** and
changes only when the plugin content changes. The publisher id stays `tovu/netlify`. The
`./netlify/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/netlify`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts netlify`) generates only `netlify/` here. The plugin-local
`node:test` suites (`__tests__`) are not shipped.

## What the payload holds

- `skills/netlify/SKILL.md` — the token, site naming, which files upload, and each failure in plain words.
- `targets/netlify.mjs` — the deploy-target module declared in `tovu-deploy-targets.json`.
- `tovu-consent.json` — the `x-country` region resolver.
- `plugin.json` — the Netlify credential card.

The modules receive the host's deploy kit (`fetch`, timeouts, URL checks, `DeployError`) in its
positional form and import nothing outside this folder.

## Frozen names

Hosts and live sites already store these, so they never change: the `tovu-*.json` contribution file names, the `netlify` target id and credential-card target, and the `jini-<project>` site-name prefix.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
