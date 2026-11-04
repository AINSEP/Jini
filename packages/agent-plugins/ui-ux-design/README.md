# `@jini-ai/agent-plugins/ui-ux-design`

This plugin ships only as a subpath of `@jini-ai/agent-plugins`.

Portable Agent Plugins payload containing seven design skills: UI/UX design, interface design,
gstack design, frontend accessibility, Vercel web guidelines, shadcn/ui, and web compliance.
Resolving this subpath reads only this plugin; it has no runtime or plugin dependencies.

Resolve `@jini-ai/agent-plugins/ui-ux-design` with the host's package resolver. Its containing
directory holds the payload. Copy that selected directory beneath the host's bundled-source root,
then use `@jini-ai/agent-plugins/lifecycle` to seed it. That existing path packs the directory,
verifies its digest, installs atomically, records activation and selects the bundled digest.
Use the lifecycle's trusted installed-file readers for contributions. Host policy controls activation;
installing this npm package grants no permission and preserves operator disablement on later boots.

The npm version follows Jini's fixed release group. The inner `plugin.json` version (**0.6.2**)
orders the plugin's own content releases; hosts refuse a lower one over an installed copy.
The `./ui-ux-design/*` export exposes its raw assets for host staging.

Sources ship in place from `packages/agent-plugins/ui-ux-design`: `plugin.json`, `mcp.json`, the
complete skills tree (including references, examples and scripts), and the existing
`com.anthropic.claude-code` extension. Tests, build output and caches are excluded. LICENSE and NOTICE retain provenance;
no provider plugin or vendor SDK is included.

## Host-neutral wording

This is the one shared copy for every host. Its text names no host tools: it tells the agent to
discover the host's tools, follow the host's permissions and explain a missing capability. The
`shadcn-ui` frontmatter keeps `Bash` for coding hosts. A host that forbids shell use adds its own
chat rules and strips that entry when it delivers the guidance, from its own overlay folder.

## Upstream

`skills/ui-ux-design/` is synced from AI-Dev-Shop's `skills/ui-ux-design/` (last sync: commit
c10abee, 2026-10-30). Change guidance there first, then sync here, keeping the local host-neutral
parts: the "Tool use and context" section and the "Read any supplied feature spec" bullet in
`skills/ui-ux-design/SKILL.md`, the opening tool-discovery paragraph in `skills/shadcn-ui/SKILL.md`,
and the `name`/`description` frontmatter in `skills/web-compliance/SKILL.md`.

## Included skills

Bundles the AI-Dev-Shop Web Design agent's full skill set (per its `agents/web-design/skills.md`
persona and the `framework/routing/skills-registry.md` ownership mapping) into one portable plugin:

- `ui-ux-design` — design-foundations (tokens, typography, spacing, breakpoints, component state
  matrix) *and* first-impression polish, scanning hierarchy, conversion-focused visual signals —
  one skill, not two. AI-Dev-Shop merged its former separate `ux-design` and `premium-ui` skills
  into this single `ui-ux-design` skill; this sample tracks that merge instead of carrying the two
  predecessor skills as stale copies (see git history for the 2026-08-12 consolidation).
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

