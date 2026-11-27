# bug-admin — Jini half

Working tree only; no commits, installs, builds, tests, typechecks or linters run.
Regression witnesses are written before their implementation. RED/GREEN execution is deferred to the coordinator.

## Ordered logical commits

1. admin 5: expose the existing locale resolver through `@jini-ai/ui/core`.
   - `packages/ui/src/features/i18n/__tests__/locale.test.ts`: public-entry Portuguese witness first.
   - `packages/ui/src/core.ts`: explicit existing-symbol export.
   - Mutation: `desktop-base-must-be-a-dictionary-key` (host) restores the bare `pt` lookup; the Jini witness also fails if the new core export is removed.
   - Tovu must add the named whole-copy desktop witness, use the resolver with `?? "en"`, and consume a published UI release.

2. admin 2: media Trash stamped deadlines and current policy.
   - Witness first: `packages/cms/src/admin-http/routes/media/__tests__/grid.test.ts`.
   - Mutation: `media-countdown-recomputed-from-policy` replaces a stored countdown with the current 30-day policy; the legacy 44-day assertion fails.
   - Witness first: `packages/admin/src/screens/media/__tests__/media-screen-states.unit.test.tsx`; mutation `media-trash-copy-dropped` suppresses the policy and row countdown render sites.
   - `packages/core/src/contracts/site/cms-admin-media.ts`: grid-only optional policy and countdown fields.
   - `packages/cms/src/admin-http/http/trash.ts`: export the existing calculation for CMS-local use.
   - `packages/cms/src/admin-http/routes/media/grid.ts`: required clock, policy, bulk deadline read; enrich only authorized, trimmed Trash rows / exact lookup.
   - `packages/admin/src/screens/media/{hooks/use-media.hooks.ts,MediaLibraryPanel.tsx,MediaCards.tsx,media-i18n/media-addons-i18n.ts}`: carry policy, render it on empty/populated Trash and supplied per-row days, add two keys in existing 21 dictionaries.
   - Tovu binds `clock: { nowIso() }`, `retentionDays`, and `readTrashDeadlines({ workspaceId, ids }, _optional = {}) => Promise<ReadonlyMap<string, string>>`. One SQL read of `trashed_items` (`workspace_id`, `entity_type = media`, returned `entity_id`s; select only entity_id/purge_after). Add the sheet's `SqlMediaRepo.listGridTrashDeadlines` and sibling query. Its injected `useGridPages` now returns `retentionDays: number | null`, sourced from the current page. Update controller fakes. Land the host binding in the same consumer bump, after data 4 and before LF-3 A.

3. admin 3 commit 1 only: isolate initial Tier 1 read failures and keep healthy rows under inline notices.
   - Witness written before implementation: `packages/admin/src/security/host/__tests__/AccessTokensTab.unit.test.tsx` (one rejected Tier 1 read, then Tier 2 failure with healthy Tier 1).
   - Mutations: `secrets-error-replaces-list` restores the error-only early returns; `secrets-rows-require-every-success` leaves the rejected read pending / restores the all-success row gate. Both lose the healthy hosting-row assertion.
   - `packages/admin/src/security/host/AccessTokensGroups.tsx`: extract named `StoreNotices`, keep search/category/healthy rows, suppress global empty on any error.
   - `packages/admin/src/security/host/hooks/{access-token-stores.hooks.ts,access-token-rows.hooks.ts,access-token-groups.hooks.ts,access-token-refresh.hooks.ts}`: three independent pending/ok/error states, successful-store groups only; same Promise.allSettled and generation settlement ordering.
   - `packages/admin/src/security/host/hooks/{access-token-actions.ts,access-token-add-actions.ts,access-token-replace-actions.ts}`: thread existing write/promotion results into the named state shape; no change to I/O or statement order.
   - The raw AccessTokensTab's injected hooks are already required and the Security binding already owns its hook wiring. No new binding layer or routes. Tovu consumes this existing host subpath, not the separate security/react rewrite.

4. admin 8 Jini-owned title lifecycle only.
   - Witness first: `packages/admin/src/screens/storage/__tests__/Storage.unit.test.tsx`; mutation `storage-title-never-set` removes the effect, breaking the setter/title/restoration assertions. All local StorageScreen test mounts receive the required dependency.
   - `packages/admin/src/screens/storage/StorageScreen.tsx`: required `setDocumentTitle({ title }, _optional = {}) => cleanup`, called by effect with localized `Storage`; cleanup returned unchanged to React.
   - Category labels and link associations are injected by the host, not defined in Jini. Tovu must distinguish WAL/SHM with two dictionary keys, remove category associations for Database/Screenshots while keeping links, and bind the title suffix and previous-title restoration. Jini never embeds host identity; the browser binding formats the title as localized Storage plus the host suffix. The full four-category/link/title witness remains for that host change.

## Stopped / skipped

- admin 1 STOP: data 8 prerequisite has not landed: `TrashItemsView` still returns the terminal empty state unconditionally for an empty page, even with a cursor. Copy waits for data 8; Q1=A is resolved. No paging or deadline changes made.
- admin 3 commit 2 deferred by owner (H1440 mitigated; continuation is a feature).
- admin 4 REJECT: duplicate owned by data 7.
- admin 6 REJECT: already styled in the host; no second rule.
- admin 7 relay skipped: chat 2 owns it. CSS remains host-owned; no Jini markup change specified.
- admin 9 host-owned `logBundledIdUpgrade`; no Jini verifier/registry changes authorized.

## Boundaries and review

Reuse existing `daysRemaining` inside CMS only. No storage queries in routes; inject clock, policy and one bulk deadline lookup. No product copy added to Jini. No themes changed. The only new production function is the explicitly named `StoreNotices`.

Final diff review: re-read the patches and both new witness files against the corrected sheets. No unrelated additions retained. Removed a redundant status conditional in the row projection: failed store state has no rows, and the existing group owner filters failed catalogs. No source files, tests, assertions, why-comments or capabilities deleted. Six regression cases added (the Secrets witness runs its two specified scenarios); no existing tests weakened or removed. Mutations are documented, not executed.

Architecture audit: static boundary review PASS for touched files: storage effects remain injected; CMS imports the day calculation by a relative internal path; grid-only metadata stays in Core's existing contract; fixes use the extracted security/host controller, not the parallel security/react implementation; no new package subpaths, dependencies, host identity, browser clock or deadline recalculation. Package/UI release and host wiring remain outstanding cross-repo work. No automated architecture, complexity or type checks were run.

| Assessed units | Disposition | Evidence / remaining limitation |
| --- | --- | --- |
| grid handler / existing daysRemaining export | INCONCLUSIVE | Route witness pins 44 versus policy 30, trimmed IDs, exact lookup, missing stamp and active omission. One bounded bulk read, O(page size) time/space; execution deferred. |
| media policy/countdown render sites and controller field | INCONCLUSIVE | Empty/populated/active view witness; host useGridPages must pass the policy. Execution deferred. |
| AccessTokensBody / StoreNotices / loaded empty gate | INCONCLUSIVE | Two partial-failure scenarios retain real hosting row and search plus a healthy other-store entry and error. Execution deferred. |
| store seeds / row and group projections / refresh | INCONCLUSIVE | Independent settlement, failed catalog omitted, no false Not connected; generation guard and allSettled order retained. Existing O(rows × providers) projection shape unchanged. Execution deferred. |
| mergeCredential / refetchStore / removeToken / applyPromotedDefault / createCustomCredential / replaceCustomCredential | INCONCLUSIVE | Mechanical state-shape propagation only; I/O, promotion ordering and why-comments retained. Existing write witnesses retained, not run. |
| StorageScreen effect | INCONCLUSIVE | Setter and cleanup witness; O(1), host formats suffix and restores title. Execution deferred. |
| ui/core export | INCONCLUSIVE | Portuguese regional resolution through the public framework-free entry point; execution and published release deferred. |

Documentation classification: existing why-comments retained; no new source commentary added under the owner rule. Review found no new abstraction or hidden effect. Runtime/self-validation and coverage are not measured because this dispatch forbids execution; no passing-test, browser, packaged-app or release claim is made. Next routing: coordinator test execution, Tovu host/binding changes, and UI publication. All changes remain in the working tree; `.git` was not written.
