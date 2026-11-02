# `@jini-ai/plugin-s3-compatible`

Portable Agent Plugins payload for S3-compatible: publish static exports to S3-compatible buckets (AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Wasabi, MinIO) and store media objects through the host's SigV4 signer. Installing this package downloads
only this plugin; it has no runtime or plugin dependencies and no MCP server.

Resolve `@jini-ai/plugin-s3-compatible/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0** and
changes only when the plugin content changes. The publisher id stays `tovu/s3-compatible`. The
`./s3-compatible/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/s3-compatible`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts s3-compatible`) generates only `s3-compatible/` here. The plugin-local
`node:test` suites (`__tests__`) are not shipped.

## What the payload holds

- `skills/s3-compatible/SKILL.md` — bucket setup, which credential fields go where, and each failure in plain words.
- `targets/s3-compatible.mjs` — the deploy-target module declared in `tovu-deploy-targets.json`.
- `object-stores/s3-compatible.mjs` — the `s3_compatible` object-store provider declared in `tovu-object-stores.json`.
- `plugin.json` — the S3-compatible credential card.

The modules receive the host's deploy kit (`fetch`, timeouts, URL checks, `DeployError`) in its
positional form and import nothing outside this folder.

## Frozen names

Hosts and live sites already store these, so they never change: the `tovu-*.json` contribution file names, the `s3-compatible` target and `s3_compatible` provider ids, the `.tovu/managed-keys.json` bucket manifest, the `TOVU_S3_*` environment names, the `tovu-media/` example prefix and the manifest error texts.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
