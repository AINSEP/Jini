# `@jini-ai/plugin-google-login`

Portable Agent Plugins payload with one skill, `google-login`, the Google member-login provider
descriptor (`tovu-login-providers.json`) and the `sign-in-button` page export (template, stylesheet
and the Google mark). Installing this package downloads only this plugin; it has no runtime or
plugin dependencies, no MCP server and no executable code.

**Tovu-only, in Jini.** This plugin moved here under a recorded exception (owner, 2026-10-29). Its
text and contributions describe Tovu's member login: the members callback route, the credential
card target and the `tovu` host key. Other hosts can read it, but nothing here is host-neutral yet.

Resolve `@jini-ai/plugin-google-login/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0**
and changes only when the plugin content changes. The publisher id stays `tovu/google-login`. The
`./google-login/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/google-login`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts google-login`) generates only `google-login/` here. The
plugin-local `node:test` suite in `packages/agent-plugins/google-login/__tests__` is not shipped.

## What the plugin holds

- `SKILL.md` — Google client setup, the Tovu members branch, the Supabase Auth branch (instructions
  only), troubleshooting without exposing secrets, and embedding the sign-in button.
- `tovu-login-providers.json` — the OIDC provider descriptor the host's member login reads.
- `exports/` — the `sign-in-button` template, its stylesheet and the unchanged Google mark.

Frozen identifiers are unchanged: the contribution file name, the card target
`google-login-oauth-client`, the label `google-login/google OAuth client` and the callback route.
