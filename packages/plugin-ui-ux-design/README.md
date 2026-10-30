# `@jini-ai/plugin-ui-ux-design`

Portable Agent Plugins payload containing seven design skills: UI/UX design, interface design,
gstack design, frontend accessibility, Vercel web guidelines, shadcn/ui, and web compliance.
Installing this package downloads only this plugin; it has no runtime or plugin dependencies.

Resolve `@jini-ai/plugin-ui-ux-design/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that selected directory beneath the host's bundled-source root,
then use `@jini-ai/agent-plugins/lifecycle` to seed it. That existing path packs the directory,
verifies its digest, installs atomically, records activation and selects the bundled digest.
Use the lifecycle's trusted installed-file readers for contributions. Host policy controls activation;
installing this npm package grants no permission and preserves operator disablement on later boots.

The next npm release is **0.6.15**, matching Jini's fixed release group. The inner `plugin.json`
version remains **0.4.6**; package extraction does not change the plugin's identity or authored bytes.
The `./ui-ux-design/*` export exposes its raw assets for host staging.

Sources remain in `packages/agent-plugins/ui-ux-design`. The build and prepack script generates only
`ui-ux-design/` here, selecting `plugin.json`, `mcp.json`, the complete skills tree (including
references, examples and scripts), and the existing `com.anthropic.claude-code` extension.
Tests, build output and caches are excluded; selected symlinks refuse assembly. LICENSE and NOTICE retain provenance;
no provider plugin or vendor SDK is included. Tovu-specific wording reconciliation is a later task.

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

