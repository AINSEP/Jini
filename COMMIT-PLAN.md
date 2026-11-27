# Commit plan — admin sheets 1 and 2

Working-tree handoff only; no git mutations. Tests are written before production edits. No installs, builds, tests, typechecks, or linters are run, as dispatched. Red/green and mutation execution are deferred to the coordinator.

## 1. Sheet 1 — qualify Trash retention copy (implemented; execution deferred)

- Files: `packages/admin/src/screens/trash/__tests__/header-copy.unit.test.tsx`, `packages/admin/src/screens/trash/trash-i18n/__tests__/create-trash-dictionary.unit.test.ts`, `packages/admin/src/screens/trash/rules.ts`, `packages/admin/src/screens/trash/trash-i18n/trash-i18n-a.ts`, `packages/admin/src/screens/trash/trash-i18n/trash-i18n-b.ts`, `packages/admin/src/screens/trash/trash-i18n/trash-i18n-c.ts`, `.changeset/admin-trash-retention-copy.md`.
- Regression: “the current window does not replace previously assigned deadlines”: 30-day qualified header and legacy Days left cell 44. Existing 14-day exact pin updated; null-policy witness preserved.
- Mutation `retention-copy-promises-retroactive-window`: restore the unqualified template in `retentionLine`; the full qualified header assertion fails.

## 2. Sheet 2 — expose current Trash policy and scope countdowns (implemented; execution deferred)

- Files: `packages/cms/src/react/media/__tests__/media-grid-cursor.unit.test.tsx`, `packages/admin/src/screens/media/__tests__/media-screen-states.unit.test.tsx`, `packages/cms/src/react/media/hooks/use-grid-pages.hooks.ts`, `packages/admin/src/screens/media/MediaGridOrEmpty.tsx`, `packages/admin/src/screens/media/MediaCards.tsx`, `.changeset/admin-media-trash-retention.md`.
- Regression: “Trash policy comes from the current first page, even when that page is empty”: empty first page reports 30, continuation reports 60 but policy stays 30, Images request remains pending and policy is null while the previous settled empty first page remains displayed. Existing `deriveGridView` retains settled page one, not its continuation rows, across tab changes; this behavior stays unchanged.
- Regression: “an active tab hides countdowns while the previous Trash rows are still displayed”: the exact same trashed legacy row renders 44 days left in Trash, then stays rendered without the countdown on Images. Existing panel fixture is shared; the original witness is retained.
- Mutation `media-grid-drops-retention-policy`: return null instead of the Trash page-one policy; the first-page 30 assertion fails.
- Mutation `media-countdown-ignores-current-tab`: restore the status-only countdown guard; the retained trashed row still displays 44 days left on Images.

## Scope

- Sheet 8: no-op per coordinator; no production, changeset, or release work.
- Sheet 5: excluded; owned by another job.
- No package versions, export paths, route contracts, paging, stored deadlines, themes, or host bindings change.
- No new subpaths or exports are required by the host. Host follow-up is the specified header/dictionary pins and real-hook integration witness; no version bump under the coordinator override.

## Final review

- Source review: retention template/null/interpolation contract, 21 copied translations, current page-one policy, required card prop, status/undefined countdown guards, controller wiring, and existing route witness inspected. Paging, stored deadlines, and route enrichment untouched.
- Fresh evidence: `git diff --check` exited 0; `git status --short` shows only the 11 assigned source/test files, the two requested changesets, and this uncommitted plan. No runtime/test pass is claimed.
- Architecture audit: PASS by source review against the sheet boundaries; no new dependencies, helpers, exports, hooks, or host logic. Existing hooks remain required/injected. No new comments; existing why-comments preserved.
- Documentation: changed public fields are described in the sheet-2 changeset; obvious copy/boolean wiring intentionally has no added inline comments, per dispatch.
- Function review: `retentionLine`, `MediaCard`, `MediaGridOrEmpty`, `useGridPages`: no recorded findings in changed logic. Added work is O(1) time/space per render/card; existing iteration remains unchanged. Names reviewed against their computed values; retention reads `first.data`, not retained `shown`.
- Three added tests; no tests deleted. Existing 14-day and dictionary key pins updated without weakening assertions; null-policy, route, paging, and Storage witnesses preserved. Mutation execution and runtime verification remain for the coordinator, per the explicit no-run instruction.
- Deleted during review: redundant title assertion from the new media transition test; corrected its hook counterpart's pending-tab assertion to match the unchanged settled-first-page fallback. No production deletions beyond the required replaced copy.
