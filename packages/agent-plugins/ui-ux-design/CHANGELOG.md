# @jini-ai/agent-plugins/ui-ux-design

## 0.7.0 (inner plugin version)

- The always-delivered `skills/ui-ux-design/SKILL.md` is now a short core (under 4 KiB) so it fits
  the 8 KiB automatic guidance limit and arrives on the first turn: tool-use wording, core rules
  (a redesign keeps the theme's design system) and a required load-before-you-build table that
  names every reference, every other skill and the split-out plugins.
- The former SKILL.md body (Execution, UI Loop Contract, Guardrails, Output, Reference) moved
  verbatim to `references/full-workflow.md`, loaded on demand.
- `skills/shadcn-ui/` moved unchanged to its own plugin, `@jini-ai/agent-plugins/shadcn-ui`.
- `references/kuinetic-reference.md` moved verbatim to its own plugin, `@jini-ai/agent-plugins/kuinetic`;
  `ui-animation.md` and the workflow now point at that plugin.

## 0.6.19

- Publishes in place as the `@jini-ai/agent-plugins/ui-ux-design` subpath; the wrapper and assembler are retired.
- One shared copy across hosts: the skills carry the newer AI-Dev-Shop sync (c10abee: UI loop,
  Chrome mobile matrix, animation and kUInetic references), the host card summary and Jini's search
  keywords. Host chat rules are replaced by host-neutral tool-use wording; hosts add their own at
  delivery. Inner plugin version 0.6.2 (above the 0.6.0 hosts seeded earlier).

## 0.6.17

### Patch Changes

- Version bump only.

## 0.6.15

### Minor Changes

- Breaking package-surface change for the fixed 0.6.15 release: remove the bundled
  ui-ux-design files and wildcard export from @jini-ai/agent-plugins. Hosts must
  explicitly install @jini-ai/agent-plugins/ui-ux-design and resolve its ./plugin.json
  export, stage that payload and seed through the existing Agent Plugin lifecycle.
  The lifecycle implementation remains in @jini-ai/agent-plugins. Inner plugin
  version 0.4.6, deterministic packing, digest selection and operator activation
  decisions are preserved. Host wording reconciliation and cutover follow later.

