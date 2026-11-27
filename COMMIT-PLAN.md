# Commit plan

Base: `f36ab47ba97ad2f7deb102fe7b80ff4f3f43d06c` (`codex/x9smallj`). Changes remain uncommitted; `.git` is read-only. No tests, mutations, builds, installs, type-checks or linters were run. API baselines are reserved for cloud regeneration and review.

1. **SM-J01 — Newsletter catalog: completed (validation pending cloud).**
   - Created `packages/user-management/src/newsletter/__tests__/agent-tools.characterization.test.ts` before copying the source: ordered IDs, exact permissions/side effects, closed schemas, editorial bounds, no bulk import, exact campaign-list maximum.
   - Created `packages/user-management/src/newsletter/agent-tools.ts` from the pinned Tovu reference, changing only the campaign-write-service value import to `./campaign-write-service.js`; existing why-comments retained verbatim.
   - Updated `packages/user-management/package.json`: explicit `./newsletter/agent-tools` export and universal runtime entry. No typesVersions map exists in this package.
   - Named mutation `NL-LIST-LIMIT-101`: campaign-list `limit.maximum` 100 → 101 must fail the exact maximum assertion (cloud must execute and revert).
   - Tovu SM-T01 needs `@jini-ai/user-management/newsletter/agent-tools` before its four importer repoints and source deletion. No Jini callers require repointing.
   - Files touched: the three paths above and this `COMMIT-PLAN.md`. Deletions: none; no unrequested additions retained.

2. **SM-J02 — Webhook HTTP test double: completed (validation pending cloud).**
   - Created `packages/integrations/src/webhooks/site/__tests__/http.memory.unit.test.ts` before copying the source: default 200, recording every call, ordered responses, final-response repetition, thrown-thunk propagation and observable script advancement.
   - Created `packages/integrations/src/webhooks/site/http.memory.ts` from the pinned Tovu reference. Changed only the type-only HttpClientPort import to `./delivery.js` and stale transport references in existing comments; statements and class shape are unchanged. Core HTTP imports remain type-only; no production barrel addition.
   - Updated `packages/integrations/package.json`: explicit `./webhooks/site/http.memory` export, node runtime entry, and matching typesVersions entry.
   - Named mutation `WH-REPLAY-FIRST`: `this.cursor += 1` → `this.cursor += 0` must fail the second distinct-response assertion (cloud must execute and revert).
   - Tovu SM-T02 needs `@jini-ai/integrations/webhooks/site/http.memory` before its two test importer repoints and source deletion. No Jini callers require repointing.
   - Files touched: the three paths above and this `COMMIT-PLAN.md`. Deletions: none; no unrequested additions retained.

3. **SM-J03 — Comments marker rendering: completed (validation pending cloud).**
   - Created `packages/cms/src/comments/site/__tests__/public-markers.unit.test.ts` before copying the source. A fake narrowed to Pick<CommentsProviderRegistry, "active" | "get"> is cast once at the fixture boundary; no capability-providers implementation dependency.
   - Cases: byte-identical marker-free HTML without reads; multiple markers share one resolution/render; attributed wrappers and unrelated markers survive; cursor forwarded; draft, absent providers and unavailable adapter render no thread; scripts collected exactly once with the declared consent category, never executable HTML; marker-free/draft pages emit no scripts.
   - Created `packages/cms/src/comments/site/public-markers.ts` from the pinned Tovu reference, changing only the marker value import to `../../widgets/markers/index.js`. Existing signatures, core type imports, statements and why-comments are unchanged.
   - Updated `packages/cms/package.json`: explicit `./comments/site/public-markers` export and universal runtime entry. No typesVersions map exists in this package.
   - Named mutation `CM-DROP-CONSENT-DECLARATIONS`: removing the active-provider branch's contributeScripts call must fail the exact script-collector assertion while the thread remains rendered (cloud must execute and revert).
   - Tovu SM-T03 needs `@jini-ai/cms/comments/site/public-markers` before its four importer repoints, host barrel export removal and source deletion. No Jini callers require repointing.
   - Files touched: the three paths above and this `COMMIT-PLAN.md`. Deletions: none; no unrequested additions retained.

4. **SM-J04 — Settings reporters: left for OPUS-CLOUD, not executed.**
   - No reporter source, test, export or host binding changed. SM-T04 also remains OPUS-CLOUD work.

SM-J01 through SM-J03 had no destination/export collisions or source/contract mismatches. SM-T01 through SM-T03 are deferred to the later Tovu job; no Tovu files changed. Cloud must run characterization, named mutations, retained host integration suites, and built API checks, then regenerate/review the three named API baselines with `pnpm api:update` before promotion.

Final review: source-copy diffs contain only the prescribed imports and SM-J02's stale comment references; manifest diffs are additive. All eleven listed Tovu importer/barrel anchors match the pinned reference. Added 13 test cases across three new suites (newsletter 4, webhook 3, comments 6); existing tests removed or weakened: zero. No additional deletions were needed during the scope review.
