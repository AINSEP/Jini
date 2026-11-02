# Resend — implementation notes

Vendor-specific notes moved out of the host's core comments (2026-10-22, vendor-to-plugins). Core describes
these behaviours generically; the vendor detail lives here.

- **Rate limit.** Resend's 2/s, burst-2 bucket (`capabilities.rateLimit` in `adapters/resend.mjs`) is why
  core's newsletter send pipeline treats a quota answer as back-pressure, not a failure (review email#4,
  2026-10-21): a batch of 20 deferred on almost every other row and used to exhaust the outbox budget.
- **Batch idempotency keys.** One key per message (`<key>:<index>`), which core's mail delivery policy now
  mirrors for per-recipient dispatch.
- **Credential label.** `Tovu Mail — Resend API` is the v1 label shape core's `defaultCredentialLabel`
  reproduces for v2 descriptors without one.
- **Feedback inbox.** Resend webhook events are recorded under `providerId: "resend"`.

## Resend's hosted MCP server (2026-10-22)

- **Server.** Resend's official hosted server, `https://mcp.resend.com/mcp` (streamable HTTP), the same
  open-source code as the `resend-mcp` npm package (github.com/resend/resend-mcp). Docs:
  https://resend.com/docs/mcp-server. The hosted URL is unversioned; tool names were read from
  `resend-mcp@2.25.0` (2026-10-06) and checked unchanged in 2.27.1, which only adds inbox tools.
- **Why remote, not `npx resend-mcp`.** Core never auto-wires a plugin's `stdio` server
  (`federate-mcp.ts`), and a remote row is what `agent_plugin_connect` and the token form act on.
- **Auth (2026-10-25).** The account connection uses `tovuAuthMode: "none"` plus the existing
  `tovuTokenAuth` declaration. The Full access key arrives through the plugin's secure account card,
  is sealed on the MCP row and sent as `Authorization: Bearer`. `agent_plugin_connect` reuses a saved
  credential or opens that card; it does not start OAuth for this declaration.
- **Historical OAuth rationale (superseded 2026-10-25).** Resend's MCP advertises RFC 9728 metadata pointing at `https://api.resend.com`, which
  supports dynamic client registration and PKCE (scopes `full_access`, `emails:send`), so
  the earlier declaration selected `tovuAuthMode: "oauth"` as the primary sign-in and `tovuTokenAuth`
  as its fallback: the key arrives
  through `credential_save { kind: "agent-plugin-token", target: "resend" }`, is sealed on the row and
  sent as `Authorization: Bearer`, the header Resend documents for headless clients.
- **Historical OAuth discovery mismatch (2026-10-24).** The server's protected-resource metadata lives only at the origin
  root and names `"resource": "https://mcp.resend.com"`, not the `/mcp` endpoint. RFC 9728 wants an exact
  match and `oauth4webapi` enforces it, so Jini's discovery fails ("did not return a JSON object") and no
  sign-in card opens; the chat falls back to the Full access key card. MCP's own SDK accepts a same-origin
  path-prefix resource, which is the generic Jini fix.
- **Probe.** `GET /domains` answers 200 for a Full access key and 401 `restricted_api_key` for a
  Sending access key, so a key that cannot manage the account is refused before it is saved. A
  malformed key gets 400, which core's generic probe reports as "unavailable", not "rejected"; the
  skill tells the assistant what that usually means.
- **Two keys on purpose.** The site's mail adapter keeps its own Sending access key
  (`Tovu Mail — Resend API`); the account tools use the separate Full access key. Site mail keeps
  least privilege, and revoking one never breaks the other.
- **Default tools.** 62 of the 64 allowed. Left out: every `remove-*`, `batch-remove-suppressions`,
  `send-broadcast`, API key create/update/remove, webhook create/update/rotate/replay, OAuth-grant
  revoke, automations, events, the dashboard editor, contact imports and inboxes. Resend's tool names
  are hyphenated and most carry no annotations, so the federation's per-call confirm classifier
  (which splits on `_` and knows `delete`, not `remove`) would let removals and `send-broadcast` run
  without a card; keeping them out of the defaults is the plugin-side guard until that is fixed.

- **0.2.1 (2026-10-25).** Version bump distributes the token-based account authentication declaration to already installed bundled packages.
