# interactive-ui

Catalog-driven components an agent can search for, request by id, and mount — feeding both
`agentic/core`'s A2UI (page-embedded) and `mcp-ui` (chat-embedded) surfaces. Not for agent-authored
arbitrary React; that path is `@jini-ai/renderers-react`'s sandboxed srcDoc host (artifacts).

Name is a placeholder — revisit before this ships anywhere public.

## The one rule

`*.manifest.ts` files must never import React (not even `import type`). `manifests.ts` is the
Node/MCP-safe entry point — it (transitively) imports only manifest files, never a provider's
`.tsx`, and is published as its own `@jini-ai/ui/interactive-ui/manifests` subpath so a headless
host (an MCP server, an agent-runtime with no browser) can import it without pulling in React.
`registry.ts` and `providers/*/index.ts` are the React-aware side; they may import manifests,
never the other way around.

## Layout

- `types.ts` — `InteractiveComponentManifest`: id, provider, capabilities, propsSchema. Zero React.
- `providers/<provider>/*.manifest.ts` — one manifest per component, zero React.
- `providers/<provider>/*.tsx` — the real component, imports its own manifest for the schema.
- `manifests.ts` — Node-safe barrel: every manifest, zero React. Own `exports` subpath.
- `registry.ts` — `InteractiveUiRegistry`: pairs manifests with components, resolves by id or
  capability, fallback order = registration order.
- `providers/native/` — dependency-free reference provider (plain HTML table). Proves the split
  end-to-end without committing to a component library.
- `providers/shadcn/` — real shadcn/ui source (`table.tsx`, `lib/utils.ts` — `npx shadcn@latest
  add table`, run for real 2026-08-08 against a scratch Vite+Tailwind v4 project, ported with only
  the `@/lib/utils` import path changed to this repo's relative-import convention; every class
  name and `data-slot` attribute is unmodified CLI output — see each file's own header comment).
  `data-table.tsx` composes those primitives into the same `columns`/`rows`/`onRowClick` contract
  `native.data-table` exposes, under the *same* capabilities, so `resolveByCapability('data-table')`
  returns both — the fallback-chain mechanic this whole package exists to prove.
- `styles.css` — Tailwind v4 entry point, scoped to `providers/**/*.tsx` only (`@source`), not the
  rest of `ui`. Published as `@jini-ai/ui/interactive-ui.css`; nothing else in `ui` depends on
  Tailwind existing. `clsx`/`tailwind-merge` are real runtime dependencies now (shadcn's `cn()`
  needs them); `tailwindcss`/`@tailwindcss/cli` are dev-only, used to generate the CSS at build time.
- `DEFAULT_INTERACTIVE_UI_REGISTRY` (root `index.ts`) — shadcn preferred, native as fallback.

## Not done yet

- Only one shadcn component (`table`) — `21st`/`magic` providers don't exist yet, and shadcn only
  has the one.
- `search_components`/`describe_component` exist in `@jini-ai/mcp`, and Tovu wires them for real
  (`src/assistant/component-catalog-query.ts`, mirroring that repo's own `tool-catalog-query.ts` —
  in-memory, not SQLite, since `ALL_MANIFESTS` is static). Any *other* consumer of `@jini-ai/mcp`
  still needs its own equivalent wiring; there is no default.
- `ui/features/a2ui` consumes this registry (full recursive tree-walking as of 2026-08-08, not
  root-only — see its own README for the per-row-action gap that remains).
- No agent tool anywhere yet actually *places* a registry component into a live surface via
  conversation — `search_components` only lets an agent discover one exists. Tovu's admin
  Playground page (`apps/admin/src/features/playground/`) adds components by hand, not by asking
  the assistant; that's still open.

## Decided: shipping without shadcn's real styling for now

`styles.css` (this folder) is real and correctly scoped (`@source` limited to `providers/**`,
verified to produce ~7.5KB of only the classes actually used, not a sweep of anything else) — but
it is **not imported anywhere** in Tovu yet. A naive global `import '@jini-ai/ui/interactive-ui.css'`
would inject Tailwind's preflight layer app-wide, resetting every button/input across the whole
admin, not just this feature. Confirmed live in a browser 2026-08-08: both `native.data-table` and
`shadcn.data-table` render with zero visual styling — structurally different (shadcn's `data-slot`
div-wrapped markup vs. native's bare `<table>`), equally plain.

Decided 2026-08-08: ship unstyled for now, revisit real CSS scoping (`@scope`, a prefixed wrapper
selector, or a preflight-disabled build) once there's a clearer sense of what needs to be covered —
right now there's exactly one shadcn component, not enough to design the scoping approach around.

## Decided: mcp-ui does not consume this registry

`ui/features/mcp-ui`'s surfaces are sandboxed HTML strings mounted via `<iframe sandbox srcDoc>`
with no React runtime inside (see that folder's own module doc) — a deliberate security boundary
for chat-embedded content, different from `a2ui`'s direct-mount-of-a-vetted-catalog model. A
registry component's real React (`onRowClick` etc.) has nowhere to attach inside that sandbox.

Decided 2026-08-08: keep them separate rather than either (a) server-rendering a non-interactive
static preview, or (b) adding a non-sandboxed "trusted" mcp-ui mode for registry-sourced
components. Both remain open options if a real need shows up — (a) is a small addition, (b) is a
real security-boundary change that deserves its own review when there's an actual case for it, not
as a byproduct of this scaffold. Revisit here before re-attempting either.
