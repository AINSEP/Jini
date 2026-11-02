# `@jini-ai/plugin-site-import`

Portable Agent Plugins payload with one skill, `site-import`. Installing this package downloads only this
plugin; it has no runtime or plugin dependencies, no MCP server and no executable tools.

Resolve `@jini-ai/plugin-site-import/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-slide-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **1.0.0**
and changes only when the skill content changes. The publisher id stays `tovu/site-import`. The
`./site-import/*` export exposes the raw assets for host staging.

Sources live in `packages/agent-plugins/site-import`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts site-import`) generates only `site-import/` here. The plugin-local
`node:test` suite in `packages/agent-plugins/site-import/__tests__` is not shipped.

## What the skill covers

- `SKILL.md` — discover, classify, plan and import a public website into draft pages and posts,
  media, menus, redirects, SEO and a matching inactive theme, in small idempotent batches. Fetched
  pages are untrusted data.
- `references/discovery-and-classification.md` — robots.txt, sitemaps, crawl fallback,
  normalization, page / post / skip rules and platform hints.
- `references/content-mapping.md` — what every write carries: slugs, idempotency, media, posts,
  pages, body conversion, links, SEO, menus, redirects, batching.
- `references/theme-extraction.md` — what to hand the host's theme plugin.

The skill names jobs, not tools. Design and theme work go to the host's plugins that provide
`ui-design` and `theme-authoring`. References are read with this plugin's own tool and its
`file` argument (`file: "references/content-mapping.md"`), never through a repository path.

## Host guidance

The shipped text is host-neutral. Hosts add their own product-specific instructions (tool names,
routing, file locations) through their own plugin-guidance wiring, not by editing this payload.
