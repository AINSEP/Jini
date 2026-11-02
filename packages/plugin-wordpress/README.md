# `@jini-ai/plugin-wordpress`

Portable Agent Plugins payload with one skill, `wordpress`. Installing this package downloads only this
plugin; it has no runtime or plugin dependencies, no MCP server and no executable tools.

Resolve `@jini-ai/plugin-wordpress/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0**
and changes only when the skill content changes. The publisher id stays `tovu/wordpress`. The
`./wordpress/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/wordpress`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts wordpress`) generates only `wordpress/` here. The plugin-local
`node:test` suite in `packages/agent-plugins/wordpress/__tests__` is not shipped.

## What the skill covers

- `SKILL.md` — choosing between an owned subdomain, a free WordPress.com address redirect, and
  the existing host; reporting DNS, HTTPS and content separately.
- `references/subdomain.md` — exact DNS records per host and WordPress.com dashboard steps.
- `references/free-site-redirect.md` — Site Redirect options, with unconfirmed pricing and host
  URL eligibility marked **confirm in your dashboard**.
- `NOTES.md` — scope notes.

Vendor-free guidance: no WordPress credential, OAuth, deploy target, upload or MCP server. The
selected hosting plugin publishes the site.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
