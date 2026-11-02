# `@jini-ai/plugin-meilisearch`

Portable Agent Plugins payload with one skill, `meilisearch`, and the Meilisearch site-search
provider it owns (`providers/meilisearch.mjs`, plain JavaScript with no imports). Installing this
package downloads only this plugin; it has no runtime or plugin dependencies and no MCP server.

Resolve `@jini-ai/plugin-meilisearch/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0**
and changes only when the plugin content changes. The publisher id stays `tovu/meilisearch`. The
`./meilisearch/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/meilisearch`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts meilisearch`) generates only `meilisearch/` here. The
plugin-local `node:test` suite in `packages/agent-plugins/meilisearch/__tests__` is not shipped.

## What the plugin holds

- `SKILL.md` — what Meilisearch receives (published, publicly visible content only), the card that
  saves the server URL and a scoped key, and what each search failure means.
- `providers/meilisearch.mjs` — the generic site-search provider contract on a Meilisearch v1.x
  server. It declares `acceptsRestricted: false` and refuses restricted documents itself. The host
  passes the index name, the saved credentials and its guarded outbound-HTTP client per call.
- `tovu-search-providers.json` — the host contribution file that names the provider module.

Frozen identifiers are unchanged: the contribution file name and the credential label
`Tovu Search — Meilisearch` are persisted by existing sites.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
