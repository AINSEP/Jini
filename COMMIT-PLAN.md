# P8-T3.J — prepared commits

Base: `codex/b-p8aj`, `010c8cd874f709ffa2c61de0de4e1dde4f808aad`.
All changes remain in the working tree; no Git writes were performed.

## 1. test(admin): characterize internal-link preflight and Back-link ownership

Written before production edits. Files:

- `packages/admin/src/browser/__tests__/navigation-interceptor.test.ts`
- `packages/admin/src/screens/menus/__tests__/MenuEditor.header-characterization.unit.test.tsx`

Three tests added; existing tests and fallback cases retained:

| Test | Named mutation | Assertion that detects it |
| --- | --- | --- |
| `canceling an internal link preflight keeps the route and emits no navigation event` | Remove the return on canceled dispatch. | A canceled click remains prevented, URL/history remain unchanged, and notifications stay at zero; allowing the same link adds exactly one transition. |
| `modified clicks and hash-only changes do not ask the leave guard` | Dispatch from the raw click handler before classifying the click and destination. | The window preflight counter stays zero after cmd-click, `#frag`, and `/admin/start#frag` from `/admin/start`. |
| `a router-owned Back link does not ask the header to confirm` | Restore the unconditional header call. | The rejecting `confirmLeave` spy is never called and the header leaves the click unprevented. |

## 2. fix(admin): add cancelable internal-link leave preflight

Files:

- `packages/admin/src/browser/navigation.ts`
- `packages/admin/src/browser/index.ts`
- `packages/admin/src/screens/menus/hooks/use-menu-editor.hooks.ts`
- `packages/admin/src/screens/menus/MenuEditorHeader.tsx`
- `packages/admin/docs/spec/api.spec.md`
- `.changeset/p8-t3-admin-link-leave-guard.md`

Adds the exact specified dispatch gate before history writes and navigation notification. The interceptor supplies `fromInternalLink: true`. Adds the optional controller ownership field, threads it through the header, updates the required why-comments and public API documentation, and records an admin patch release.

## Handoff

- Built: P8-T3.J. Stopped sheets: none; source anchors match.
- P8-T3.T belongs to Tovu and remains for that repository.
- OPUS sheets left untouched: P8-J1.J (Jini), P8-T1.S (Tovu).
- Tovu needs an artifact exposing `BEFORE_LINK_NAVIGATION_EVENT` from `@jini-ai/admin/browser` and `MenuEditorController.leaveGuardOwner?: "router"` from `@jini-ai/admin/screens/menus/hooks/use-menu-editor.hooks`. No new subpath or export-map change is needed.
- Generated API-baseline refresh remains for Opus combine work.
- Tests, mutation runs, builds, installs, type-checks, linters, coverage measurement, and browser validation were not run, as required by dispatch. Runtime correctness remains unverified pending the cloud run.
- Static architecture review: PASS against P8-T3.J. Existing window port and header hook seam reused; no React or host imports added to the browser adapter, no new helpers or abstractions, route matching and dirty comparison unchanged.
- Function review: `navigate`, interceptor callback, Back-link callback, and header prop wiring have no recorded static findings. Skepticism pass rechecked effect order, hash bypass, cancellation, ownership, variable names, existing fallbacks, and diff scope. No runtime or complexity-tool result is claimed.
- Documentation is limited to the requested API additions and why-comments.
- Scope cleanup deletions: none. No existing tests, files, or capabilities deleted or weakened.
- This `COMMIT-PLAN.md` is the required coordinator handoff artifact, in addition to the files listed above.
