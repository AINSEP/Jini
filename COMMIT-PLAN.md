# P5 Jini implementation handoff

Base: `010c8cd874f709ffa2c61de0de4e1dde4f808aad` (`codex/f-p5j`). All changes remain in the working tree; `.git` is read-only. Tests, builds, installs, type checks, and linters are prohibited by dispatch and have not run. Tests are written before each sheet's production code. Mutations below are witnesses for Opus to apply and run; they remain unapplied.

## 1. P5-T1.J — Payload namespace

Files: `packages/devops/src/backup/site/import-index/{payload-namespace,errors}.ts`, `packages/devops/src/backup/site/import-index/__tests__/payload-namespace.test.ts`, `packages/devops/package.json`, `.changeset/p5-t1-import-payloads.md`.

Tests and named red mutations:

- `staging budget and orphan sweep never enumerate the history directory`: count budget from root instead of `payloads/`.
- `interrupted move (ZIP moved, metadata not) then restart keeps the upload claimable and owner setup completes`: sweep before ensure (Tovu owner witness); Jini interrupts metadata rename after the ZIP move and pins preserved payloads and retry completion.
- `active payloads survive the move; stale ones are removed`: drop the metadata move pass.
- `second open does not readdir the history root`: ignore the marker on a fresh instance.

Opus: regenerate `api-baseline/jini-ai__devops.json` after building. Tovu consumes universal `@jini-ai/devops/backup/site/import-index/{payload-namespace,errors}` and supplies every filesystem port.

## 2. P5-T2.J — SQL index, replay, pagination and neutral surfaces

Files:

- `packages/core/src/contracts/site/site-import-history.ts`, `packages/core/package.json`.
- `packages/devops/src/backup/site/import-index/migrations/{site-imports-v1,checksums}.ts`.
- `packages/devops/src/backup/site/import-index/{schema,open,rows,store,paging,admission,sweep,errors}.ts`.
- `packages/devops/src/backup/site/import-index/__tests__/{schema,store,paging,admission,sweep}.test.ts`.
- `packages/devops/src/backup/site/react/ShowMoreImports.tsx`, `packages/devops/src/backup/site/react/ShowMoreImports.test.tsx`.
- `packages/devops/package.json` (exports, targets, optional React peer feature description).
- `packages/cms/src/admin-http/routes/system/site-imports.ts`, `packages/cms/src/admin-http/routes/system/__tests__/site-imports.test.ts`.
- `.changeset/p5-t2-indexed-import-history.md`.

Tests and named red mutations:

- `history boundary: listed at 30d − 1 ms, hidden at exactly 30d`: make visibility inclusive. Paging exercises both times; sweep also pins physical retirement and rollback high-water behavior.
- `day 365 + 1 ms frees the key`, `fence still conflicts at 365d − 1 ms`: make fence visibility inclusive. The first witness explicitly includes exactly 365 days.
- `replay at day 200 returns the stored outcome but the row is not listed`: bypass replay lookup; also asserts the empty page and no admission writes.
- `REQUEST_CONFLICT leaves the upload unconsumed and makes no HTTP call`: consume before checking the fence (Tovu effect witness); Jini checks conflict precedes budget, new-row, write-fence callbacks, and SQL writes.
- `admission insert failure leaves no fence`: split fence and row inserts into separate transactions.
- `tied timestamps page with no duplicates, skips or cross-principal rows`: drop import-ID tie-breaking. Uses 120 rows, seven timestamps, three principals, 80 rows for the paged principal, and size 50.
- `invalid cursor (bad base64, v2, unsafe int, non-uuid) → INVALID_CURSOR`: catch and treat cursor as absent. Both decoder and list boundary are exercised.
- `recovery issues one indexed active-row query`: remove the active-status predicate.
- `needs-owner past deadline fails with "Owner setup expired" and its stage is removed`: use `<=` for owner expiry; Jini pins selection at and after the deadline and storing the named failure. Stage removal is the Tovu witness, because the Jini store has no stage filesystem port.
- `site-imports-v1 DDL checksum and applied ledger are pinned`: change one DDL byte or add an unknown applied ledger ID. The test hashes the DDL literal, never the source file. It intentionally remains pending the Opus pin.
- CMS: empty query, one cursor, duplicate/array/unknown query fields, missing authenticated context, dispatch using authenticated principal.
- React: cursor-only rendering of the supplied button and one supplied-loader invocation per press.

Tovu consumes universal Core `@jini-ai/core/contracts/site/site-import-history`; node devops `@jini-ai/devops/backup/site/import-index/{open,rows,store,paging,admission,sweep}`; browser devops `@jini-ai/devops/backup/site/react/ShowMoreImports`; and the already-exported CMS route owner. Schema and migration files have no public subpath. `mapSqliteError` is on the universal errors subpath and takes host-safe `busy`, `storage`, and `damaged` copy. The integrity callback performs `quick_check(1)` and throws on a failed result; the opener caches successful checks by file/DB ID (or by handle before an ID exists). Store handles are borrowed; opener handles are owned. Store absence is `undefined`; query errors propagate.

Opus must replace `OPUS_PIN_PENDING` with a newly derived, verified DDL-string pin and regenerate `api-baseline/{jini-ai__core,jini-ai__devops,jini-ai__cms}.json`. The pin witness is expected to remain red until then. No Admin manifest or baseline was changed.

## 3. P5-T3.J — One-transaction backfill

Files: `packages/devops/src/backup/site/import-index/backfill.ts`, `packages/devops/src/backup/site/import-index/__tests__/backfill.test.ts`, `packages/devops/package.json`, `.changeset/p5-t3-import-backfill.md`.

Tests and named red mutations:

- `backfill crash before commit leaves no marker and no rows`, `interrupt the backfill and restart → exactly one copy of each row and fence`: commit the marker separately. Interruption is injected mid-rows and immediately before transaction commit. The rerun also starts from the complete, committed candidate left before any external state publish. Plain meta INSERTs fail because schema and rerun metadata already exist.
- `origin-only key still fences a different source`: skip no-digest URL fences. Uses day 200 to require a live fence without visible detail.
- `unreadable row blocks cutover and keeps its file`, `malformed-but-parseable row blocks cutover`: skip bad records and cut over anyway. Candidate acquisition must not occur.
- `active verifying/creating recovery keeps its allocation`, `needs-owner row and its stage survive backfill; owner setup completes after cutover`: apply the terminal cutoff to active rows or drop `creation`. Jini preserves full active records and legacy inputs; Tovu supplies actual recovery, stage ownership, owner completion, and real-disk close/reopen witnesses.
- `two legacy rows with one requestId: newest fences, both histories listed`: sort duplicate owners ascending. Exercises different timestamps and equal timestamps with binary UUID ordering.

Tovu consumes node `@jini-ai/devops/backup/site/import-index/backfill`. The host holds `.import.lock`, supplies the non-quarantining JSON reader and owned candidate opener, and publishes external authority later. No state module or external authority write was introduced. Opus regenerates the devops API baseline.

## Deferred

- P5-T4.J is BUILDER: OPUS and remains untouched.
- All `.T` sheets belong to Tovu and remain untouched, including OPUS P5-T4.T.
- API baseline regeneration and the T2 DDL pin belong to Opus.

## Scope review

No pre-existing tests, assertions, behavior, or measured scope deleted. No mutations applied. Diff review removed an unnecessary payload path helper, an unnecessary schema-verification helper/export, an unused error-message field, an artificial test-only external-publish throw, and a redundant fake close call. All were introduced during this run; no existing implementation was deleted.

29 test declarations added across the named files (4 payload, 13 index/React, 4 CMS, 8 backfill). No existing tests removed or weakened. No coverage settings changed. No tests or other verification commands executed; no pass counts or runtime correctness claimed. Final evidence is source/diff review and clean starting-HEAD confirmation only. Runtime validation is deferred by explicit dispatch, including originals, red mutations, real-driver transactions and host effects.

Architecture source review: only the named Core/devops/CMS files and changesets were touched. Core is types-only; devops uses injected structural filesystem/SQLite/clock dependencies; React uses its injected button; there are no native drivers, Express, Admin implementations, Tovu imports, sibling-package implementations, forwarding shells, or new dependencies. T4 mode/authority/retirement remains unimplemented. Function size, complexity, package build, API compatibility and runtime behavior still require the authorized cloud checks; this handoff is implementation for review, not verified delivery.

Cost: payload expiry/budget scan only the disposable namespace after its one-time root migration. Indexed pages fetch at most 51 rows; physical retention batches 500 per immediate transaction. Backfill reads legacy names once, processes slices of 500, retains validated rows in memory, and selects fence owners in O(n log n); it warns above 20,000 records. The process integrity cache records successful file/DB identities; unnamed candidates use weak handle identity.
