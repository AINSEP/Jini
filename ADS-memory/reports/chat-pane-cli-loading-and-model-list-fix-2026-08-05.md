# ChatPane: CLI-detection loading state + current Claude model list

**Date:** 2026-08-05
**Agent:** Programmer
**Repos touched:** Jini only (`packages/agent-runtime`, `packages/chat`). No Tovu source changed.

## Bug 1 — "No usable CLI" flashed red on load

**Root cause confirmed at `packages/chat/src/react/features/chat-pane/components/ChatPane.tsx:394`:**
`const unavailable = pane.selectedAgent === undefined;` — this is `true` both while the runtime
inventory is still loading and once it has finished loading and genuinely found nothing. The
banner in `ChatPaneStatusMessages` rendered `unavailable` as a permanent `role="alert"` with no
loading branch, unlike the `workingDirectoryPending`/`workingDirectoryInvalid` pair a few lines
below it, which already has the three-state shape this needed.

The actual flash source was two-fold:
1. `ChatPaneStatusMessages` never consulted the loading signal at all (`scanningAgents`, already
   returned by `useChatPaneRuntimeInventory` at
   `packages/chat/src/react/features/chat-pane/hooks/useChatPaneRuntimeInventory.hooks.ts`).
2. Even if it had, `scanningAgents` itself started at `useState(false)` — the load effect only
   flips it to `true` once it runs, which is after the first paint. So there was one rendered
   (and often painted) frame at mount where inventory was neither loaded nor marked loading —
   indistinguishable from "finished, nothing usable."

**Fix:**
- `useChatPaneRuntimeInventory.hooks.ts`: seed `scanningAgents` from `access !== undefined` instead
  of `false`, closing the mount-frame gap.
- `ChatPane.tsx`: `ChatPaneStatusMessages` now takes `scanningAgents` and renders
  `unavailable && scanningAgents` as a `role="status"` ("Loading available CLIs"), else
  `unavailable` alone as the original `role="alert"` ("No usable CLI is selected."). Wired at the
  call site from `runtimeView.scanningAgents`.
- Verified in Tovu (`apps/admin/src/components/AssistantDock.tsx:524`) that `runtimeAccess` is a
  `useMemo(() => ({...}), [])` — stable for the component's lifetime, always defined by first
  render. So the only place `access` transitions from absent to present is mount itself; the fix
  covers the actual product path, not just a synthetic one.

## Bug 2 — stale Local CLI model list

**Confirmed hardcoded**, not runtime-derived: `packages/agent-runtime/src/defs/claude.ts:46-54`,
`CLAUDE_FALLBACK_MODELS`, used both as `fallbackModels` and as the fallback argument inside
`fetchModels: (_resolvedBin, env) => loadMmdRouteModels(env, CLAUDE_FALLBACK_MODELS)`. The
comment above it says the CLI has no `list-models` subcommand, so this array (plus any local mmd
routes) is the entire model surface for the Local CLI, `claude` def.

**Confirmed this is NOT the same list as the BYOK surface** — grepped the Tovu-side BYOK
fixtures/specs the dispatch flagged (`AssistantDock.unit.test.tsx`,
`execution-settings.test.ts`, `byok-*.spec.ts`); those model ids there are opaque test fixture
strings validated by Tovu-side persistence logic, not sourced from `CLAUDE_FALLBACK_MODELS`. Left
untouched.

**Fix:** added `claude-opus-5` / `claude-sonnet-5`, kept `claude-haiku-4-5` (still current, no
change), and kept `claude-opus-4-5` / `claude-sonnet-4-5` as older options at the end of the list
rather than removing them — reasoning: they're still active per the dispatch brief, and an
installed CLI or a user's existing pinned config could still reference one; dropping a working
selection is worse than listing it last. Aliases (`sonnet`/`opus`/`haiku`) untouched, as directed.

## Files changed
- `packages/agent-runtime/src/defs/claude.ts` — `CLAUDE_FALLBACK_MODELS`
- `packages/agent-runtime/src/defs/__tests__/claude.test.ts` — updated the fallback-model-id
  assertion to the new 9-entry order
- `packages/chat/src/react/features/chat-pane/components/ChatPane.tsx` — `ChatPaneStatusMessages`
  three-state banner + `scanningAgents` wiring
- `packages/chat/src/react/features/chat-pane/hooks/useChatPaneRuntimeInventory.hooks.ts` — lazy
  initial `scanningAgents` state
- `packages/chat/src/react/features/chat-pane/__tests__/components/ChatPane.test.tsx` — fixed the
  now-multi-`status` assertion in the existing "renders pending, invalid, and runtime inventory
  failure states" test (both `workingDirectoryPending` and the new CLI-loading status are
  legitimately up at once there); added two new tests asserting the three distinct states
  (loading → status, resolved-empty → alert, resolved-with-agent → neither)
- `packages/chat/src/react/features/chat-pane/__tests__/hooks/useChatPaneRuntimeInventory.test.tsx`
  — added two tests asserting the synchronous initial `scanningAgents` value with/without `access`
  at mount, with no `act()` in between so they catch a regression back to the old flash

## Test results (scoped, not full suite)
- `packages/chat`: `npx vitest run` → **67 files / 963 tests passed**
- `packages/agent-runtime`: `npx vitest run` → **99 files / 1963 tests passed**

## Dist rebuild — required because Tovu resolves `@jini-ai/*` to Jini's built `dist/`, not source
- Ran `npx tsc -p tsconfig.json` in both `packages/agent-runtime` and `packages/chat` (no
  `install`/`ci` used). Both built clean, no TS errors.
- Grepped the rebuilt `dist/` output directly and confirmed the changes are present:
  - `packages/agent-runtime/dist/defs/claude.js` — contains `claude-opus-5`, `claude-sonnet-5`,
    both legacy ids, in the new order.
  - `packages/chat/dist/react/features/chat-pane/components/ChatPane.js` — contains the
    `unavailable && scanningAgents` branch and `t('Loading available CLIs')`.
  - `packages/chat/dist/react/features/chat-pane/hooks/useChatPaneRuntimeInventory.hooks.js` —
    contains `useState(() => access !== undefined)`.
- Confirmed Tovu's `node_modules/@jini-ai/chat` and `@jini-ai/agent-runtime` are symlinks into
  these exact package directories, and `require.resolve('@jini-ai/agent-runtime')` resolves to
  `dist/index.js` — so the admin app picks up the rebuilt output on next dev-server reload with no
  further action needed.
- Noted but did not touch: `packages/chat/dist/react/features/chat-pane/react/hooks/
  useChatPaneRuntimeInventory.hooks.js` is a stray, unreferenced duplicate from an older dist
  layout (no source imports that path). Harmless dead build output, out of scope for this fix.

## Scope discipline
- Did not touch `packages/vibecoding/**`, `pnpm-lock.yaml`, or `packages/vibecoding/package.json`
  (all pre-existing dirty from another live session) — confirmed via `git status` before and after,
  committed only the 6 files listed above with explicit paths.
- Did not run `npm install`/`pnpm install`. Did not touch any Tovu source file — both bugs lived
  entirely in Jini's `packages/chat` and `packages/agent-runtime`.
- No BYOK code path touched.

## Architecture Audit
- **Status: PASS.** Changes stay inside `@jini-ai/chat`'s `react/features/chat-pane` slice and
  `@jini-ai/agent-runtime`'s `defs/claude.ts`, both pre-existing owners of this behavior. No new
  cross-package imports, no new public API surface beyond the new `scanningAgents` prop on an
  already-internal (non-exported) `ChatPaneStatusMessages` component.

## Pre-Completion Checklist
- Requirements re-verified against both bug reports: three-state banner (loading/error/none) ✓,
  current model ids present without removing active legacy ones ✓.
- Fresh evidence: both scoped `vitest run` invocations above, run after the source edits, both
  green; dist greps after rebuild confirm the fix is live in built output.
- No certified/pre-existing test was deleted or weakened — the one pre-existing assertion that
  had to change (`getByRole('status')` → `getAllByRole('status')`) changed because the new,
  correct behavior legitimately produces two simultaneous status banners in that scenario, and the
  replacement still asserts both texts explicitly.
- Scope: 6 files, all inside the two features the bugs live in. No Tovu files touched.
- Open items: none blocking. The stray dead dist path noted above could be cleaned by a full
  `rm -rf dist && tsc` in `packages/chat` if anyone wants to tidy it, but it has zero runtime
  effect today.

## Commit
`9525b794` on `refactor/jini-admin-extraction` (Jini repo) — `git commit -F <msgfile> -- <6 explicit paths>`.
