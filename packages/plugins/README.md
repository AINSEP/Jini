# `@jini-ai/plugins`

Packaging support for **Agent Plugins**, an open, vendor-neutral spec (v1.0.0, published
2026-08-06) for bundling Agent Skills and MCP servers into one portable directory. Published by a
Technical Steering Committee with maintainers from Amazon, Cursor, Google, Microsoft, OpenAI, and
Vercel. Source: https://developers.googleblog.com/agent-plugins-package-your-skills-tools-and-more/

If you are an agent reading this cold: this document is written so you don't need the source
article to understand the shape of a plugin or what this package provides. `PluginManifest` and
`McpManifest` (exported from `./core`) type every field confirmed against the published schemas
(`AGENT_PLUGINS_SCHEMA_URL`, `AGENT_PLUGINS_MCP_SCHEMA_URL`) — both still carry an index signature
in case a future schema revision adds a field neither type has caught up to yet.

## The problem this solves

Before this spec, shipping the same skill or MCP server to multiple agent clients meant
maintaining incompatible copies — every client used a different manifest format and directory
layout ("fork and drift"). Agent Plugins standardizes the packaging format only; each client still
decides its own install mechanism, permission model, and sandboxing.

## What a plugin looks like on disk

A plugin is a directory. Minimal example (this package's `samples/design/`):

```
design/
├── plugin.json                       # manifest — minimally { "$schema": ..., "name": "design" }
├── mcp.json                          # MCP server declarations (empty here — example only)
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md                  # Agent Skills format: frontmatter (name, description) + body
│       ├── references/               # optional supporting docs the skill body links out to
│       ├── examples/                 # optional
│       └── scripts/                  # optional
└── com.anthropic.claude-code/        # client extension directory (§8.2) — example only
    └── hooks/
        └── hooks.json
```

`plugin.json` optional fields beyond `$schema`/`name`: `version`, `description`, `author`
(`{name, email, url}`), `homepage`, `repository`, `license`, `keywords` (string array), and
`extensions` — an object keyed by reverse-domain client namespace (e.g. `com.example.client`) for
client-specific data the schema assigns no semantics to.

`mcp.json` declares MCP servers under `mcpServers`, one of three explicit transport shapes — no
guessing which one a client should assume:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "local-validator": {
      "type": "stdio",
      "command": "./bin/validator",
      "args": ["--data", "${PLUGIN_DATA}/validator"],
      "env": { "CONFIG": "${PLUGIN_ROOT}/config.json" },
      "cwd": "${PLUGIN_ROOT}"
    },
    "deployment-api": {
      "type": "streamable-http",
      "url": "https://deploy.example.com/mcp",
      "headers": { "X-Tenant": "public-tenant" }
    },
    "legacy-events": {
      "type": "sse",
      "url": "https://legacy.example.com/sse"
    }
  }
}
```

`samples/design/mcp.json` ships with an empty `mcpServers: {}` — a valid, working example of the
file's shape, not a real server declaration. Replace it (or delete it — `mcp.json` is optional)
the moment this plugin actually needs one.

A plugin can also have reverse-domain-namespaced directories at its root — §8.2 of the
specification: "the extension directory for a namespace is the top-level directory named after
it," contents entirely client-defined, and clients that don't recognize a namespace simply ignore
it. The spec's own example is `com.example.client/hooks/hooks.json` — using `example.com` the same
way an RFC does, since the spec assigns no real namespace to any actual client and publishes no
namespace registry. `samples/design/com.anthropic.claude-code/hooks/hooks.json` follows the same
shape with a real client substituted in: `com.anthropic.claude-code` is a plausible reverse-DNS
guess (Anthropic controls `anthropic.com`; Claude Code is the client this whole package was built
inside), **not** a confirmed or registered identifier — nothing publishes one. Content is
illustrative only, per the same "no portable semantics" rule.

Discovery (how a client finds/installs a plugin in the first place) is explicitly out of scope for
the packaging spec itself — it lives in separate layers (Agentic Resource Discovery, an AI
Catalog format) that this package does not implement.

## Layers

| subpath | runtime | contents |
|---|---|---|
| `.` / `./core` | universal | `PluginManifest`/`McpManifest` types, `isPluginManifest`/`isMcpManifest` structural validators, and the known path constants (`PLUGIN_MANIFEST_FILENAME`, `PLUGIN_SKILLS_DIRNAME`, `PLUGIN_MCP_MANIFEST_FILENAME`). No filesystem access, no DOM. |

`core` deliberately stops at "validate a manifest object" — there is no loader, installer, or
discovery client yet. Add those as the actual consumer (a Jini agent runtime, an admin UI, or a CLI
install command) makes the requirement concrete, rather than building ahead of a real caller.

## `samples/`

Not published under `./core` — these are static plugin directories shipped alongside the code so a
consumer (human or agent) can see a real, valid plugin rather than only a type definition. Included
in the npm package via the `files` field so `node_modules/@jini-ai/plugins/samples/design/` is a
complete, install-ready plugin directory as-is.

### `samples/design/`

Bundles the AI-Dev-Shop Web Design agent's full skill set (per its `agents/web-design/skills.md`
persona and the `framework/routing/skills-registry.md` ownership mapping) into one portable plugin:

- `ux-design` — design-foundations: tokens, typography, spacing, breakpoints, component state matrix
- `premium-ui` — first-impression polish, scanning hierarchy, conversion-focused visual signals
- `interface-design` — repeatable, memory-consistent visual systems for dashboards/admin panels/apps
- `gstack-design` — manual four-mode workflow (consultation, shotgun, html, review)
- `frontend-accessibility` — WCAG 2.1 AA checklist
- `vercel-web-design-guidelines` — Vercel Web Interface Guidelines auditor
- `shadcn-ui` — shadcn/ui (Radix + Tailwind) component discovery/integration guidance
- `web-compliance` — legal/compliance checkpoints for public-facing UX flows

Each skill directory is a verbatim copy of the corresponding `AI-Dev-Shop/skills/<name>/` tree —
copied rather than referenced, because the whole point of a plugin is that it is self-contained and
portable to a host that has never heard of AI-Dev-Shop. `AI-Dev-Shop/agents/web-design/skills.md`
itself (the persona that composes these skills into one role) is not bundled — it is ADS-specific
routing glue, not a portable skill.

## Scripts

```bash
pnpm --filter @jini-ai/plugins build
pnpm --filter @jini-ai/plugins typecheck
pnpm --filter @jini-ai/plugins test
```

## Adding another sample plugin

1. Create `samples/<plugin-name>/plugin.json` with at least `{ "$schema": AGENT_PLUGINS_SCHEMA_URL, "name": "<plugin-name>" }`.
2. Add `samples/<plugin-name>/skills/<skill-name>/SKILL.md` per skill (plus any `references/`,
   `examples/`, `scripts/` the skill needs).
3. Add coverage in `src/core/__tests__/` following `manifest.test.ts`'s `samples/design plugin`
   block — assert the manifest validates and the expected skill directories exist.
