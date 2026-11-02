# `@jini-ai/plugin-vercel`

Portable Agent Plugins payload for Vercel: publish static exports to Vercel projects with the person's own token, and store export share links in Vercel Blob. Installing this package downloads
only this plugin; it has no runtime or plugin dependencies and no MCP server.

Resolve `@jini-ai/plugin-vercel/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0** and
changes only when the plugin content changes. The publisher id stays `tovu/vercel`. The
`./vercel/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/vercel`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts vercel`) generates only `vercel/` here. The plugin-local
`node:test` suites (`__tests__`) are not shipped.

## What the payload holds

- `skills/vercel/SKILL.md` — the token, the optional team, Deployment Protection, and each failure in plain words.
- `targets/vercel.mjs` — the deploy-target module declared in `tovu-deploy-targets.json`.
- `object-stores/vercel-blob.mjs` — the share-link artifact store declared in `tovu-object-stores.json`.
- `tovu-consent.json` — the `x-vercel-ip-country` region resolver.
- `plugin.json` — the Vercel credential card.

The modules receive the host's deploy kit (`fetch`, timeouts, URL checks, `DeployError`) in its
positional form and import nothing outside this folder.

## Frozen names

Hosts and live sites already store these, so they never change: the `tovu-*.json` contribution file names, the `vercel` target and object-store provider ids, the credential-card target, and the `_share/<token>/<name>.tovu.zip` share keys.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
