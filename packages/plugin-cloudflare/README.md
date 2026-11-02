# `@jini-ai/plugin-cloudflare`

Portable Agent Plugins payload for Cloudflare: publish static exports to Workers or Pages, attach
reviewed apex plus www domains, and store form submissions in a D1 database in the person's own
Cloudflare account. Installing this package downloads only this plugin; it has no runtime or plugin
dependencies and no MCP server.

Resolve `@jini-ai/plugin-cloudflare/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.3.1** and
changes only when the plugin content changes. The publisher id stays `tovu/cloudflare`. The
`./cloudflare/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/cloudflare`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts cloudflare`) generates only `cloudflare/` here. The
plugin-local `node:test` suites (`__tests__` folders) are not shipped.

## What the payload holds

- `skills/cloudflare/` — the skill and its references (permissions, Workers, Pages, domains,
  troubleshooting).
- `targets/cloudflare-workers.mjs`, `targets/cloudflare-pages.mjs` — deploy-target modules declared in
  `tovu-deploy-targets.json`. They receive the host's deploy kit (`fetch`, timeouts, URL checks,
  `DeployError`) and import nothing outside this folder.
- `form-destinations/cloudflare-d1.mjs` — the form destination declared in
  `tovu-form-destinations.json`; it pulls what the Worker stored.
- `worker/forms-receiver.mjs` — the receiver uploaded beside the site's assets. It runs in the
  Workers runtime with no imports.
- `tovu-consent.json` — the `cf-ipcountry` region resolver.
- `plugin.json` — credential cards for both targets and the diagnostic DNS-over-HTTPS resolver URL.

## Frozen names

Hosts and live sites already store these, so they never change: the `tovu-*.json` contribution file
names, target and destination ids, the `TOVU_FORMS` / `TOVU_FORMS_SECRET` Worker bindings, the
`tovu-forms-<script name>` D1 database name, the `/_tovu/forms/*` receiver routes and the
`/.well-known/tovu-deployment-*.txt` content proof.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
