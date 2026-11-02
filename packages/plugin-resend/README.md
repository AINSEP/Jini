# `@jini-ai/plugin-resend`

Portable Agent Plugins payload with one skill, `resend`, the Resend mail adapter it owns
(`adapters/resend.mjs` and `lib/*.mjs`, plain JavaScript with no npm imports) and a remote MCP
declaration for Resend's hosted MCP server. Installing this package downloads only this plugin; it
has no runtime or plugin dependencies.

Resolve `@jini-ai/plugin-resend/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.2.1**
and changes only when the plugin content changes. The publisher id stays `tovu/resend`. The
`./resend/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/resend`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts resend`) generates only `resend/` here. The plugin-local
`node:test` suite in `packages/agent-plugins/resend/__tests__` is not shipped.

## What the plugin holds

- `SKILL.md` — the two jobs (site mail through the sending card, account work through Resend's
  hosted MCP server), which tools to use for which, the two keys, domain verification and what each
  send failure means.
- `adapters/resend.mjs`, `lib/` — the mail adapter, domain checks, error mapping and the signed
  bounce/complaint feedback parser. The host hands the adapter its guarded outbound-HTTP client.
- `tovu-mail-adapters.json` — the host contribution file that names the adapter and its card.
- `mcp.json` — Resend's hosted MCP server, `https://mcp.resend.com/mcp`, with token auth.
- `NOTES.md` — implementation notes (rate limit, idempotency keys, MCP auth history, default tools).

Frozen identifiers are unchanged: the contribution file name, the `tovu*` manifest and MCP keys and
the credential label `Tovu Mail — Resend API` are persisted by existing sites.

## Host guidance

The shipped text is host-neutral. The webhook endpoint, its signing-secret labels, rotation and
suppression rules are the host's and come from its plugin-guidance wiring, not from this payload.
