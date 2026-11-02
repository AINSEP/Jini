# `@jini-ai/plugin-site-compliance`

Portable Agent Plugins payload with one skill, `site-compliance`. Installing this package downloads only this
plugin; it has no runtime or plugin dependencies, no MCP server and no executable tools.

Resolve `@jini-ai/plugin-site-compliance/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **1.0.0**
and changes only when the skill content changes. The publisher id stays `tovu/site-compliance`. The
`./site-compliance/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/site-compliance`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts site-compliance`) generates only `site-compliance/` here. The plugin-local
`node:test` suite in `packages/agent-plugins/site-compliance/__tests__` is not shipped.

## What the skill covers

- `SKILL.md` — evidence-based screening: every finding cites the page path, selector, header,
  cookie or request that supports it; "cannot determine" where evidence is missing; never a
  GDPR, CCPA/CPRA or WCAG compliance verdict.
- `references/gdpr-eu-uk.md`, `references/ccpa-cpra.md`, `references/wcag-2-2.md` — versioned
  rulepacks.

The skill uses the host's own evidence tools (site profile and rendered-page evidence) when the
host offers them, and says so plainly when it does not.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
