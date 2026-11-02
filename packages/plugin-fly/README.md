# `@jini-ai/plugin-fly`

Portable Agent Plugins payload for Fly. Installing this package downloads only this plugin; it
has no runtime or plugin dependencies and no MCP server.

Resolve `@jini-ai/plugin-fly/plugin.json` with the host's package resolver. Its containing directory
holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`. Host
policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **1.0.0**
and changes only when the plugin content changes. The publisher id stays `tovu/fly`, and the
contribution files keep their frozen names (`tovu-deploy-configs.json`, `tovu-deploy-ops.json`).
The `./fly/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/fly`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts fly`) generates only `fly/` here. The plugin-local
`node:test` suites under `packages/agent-plugins/fly` are not shipped.

## What it covers

- `skills/fly/SKILL.md` — the rules generic fly.io advice gets wrong (one machine for volume-backed state, the mount hiding the image's files, secrets never in `fly.toml`, the volume before the first deploy).
- `skills/fly/references/fly.template.toml` and `fly-deploy.template.yml` — the two files an operator writes, every host value a `<<PLACEHOLDER: ...>>`.
- `deploy-configs/fly.mjs` — the dependency-free `fly.toml` generator (`render(descriptor, options, kit)`). A CI job can import it from an unpacked tarball (`npm pack @jini-ai/plugin-fly@<exact version>`).
- `deploy-ops/fly.mjs` — status, logs, secrets and deploy operations through the host's credentialed HTTP port.
- `scripts/render-deploy-workflow.mjs --values <file> --repo-root <dir> [--check]` — renders a host's own workflow from the template plus the host's values file and blocks. Nothing about any host is defaulted; a missing `--values` or `--repo-root` exits 2.

## Host guidance

The shipped text is host-neutral. The host passes its own non-secret runtime variables in
`options.env`, appends its own notes after a generator renders, and adds its product-specific
instructions through its own plugin-guidance wiring, not by editing this payload.
