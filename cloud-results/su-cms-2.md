# su-cms-2: lane S cms chain, S2c and S4a done (PARTIAL: S4b, S7a not started)

Branch `wave3/su-cms` in BOTH repos, fast-forward pushes only on top of `d834b6ddc` (Tovu) / `8f4969a9c` (Jini). Plan: `origin/plan/lanes-s-u-2026-11-16` (`INDEX-SU.md`, `T-SQLREPO.md`, `S/S2`, `S/S4`). No HELD decision ID applies.

## Done (all pushed)
| step | Tovu | Jini |
|---|---|---|
| S2c T0 (characterization, 16 mutations) | 00d813cbd | - |
| S2c J1 (`TrashAwareInMemoryEntryRepo`, `./entries`) | - | 35d847e1d |
| S2c T1 (delete, repoint, bind `onWriteSettled`) | b018e58be | - |
| S4a T0 (claimDue / notTrashed / readLiveSnapshot / entryWhere, 9 mutations) | bfc74897b | - |
| S4a J1 (registry types, `trashEntityLockKey`, `./trash/sql`) | - | a4aca6a56 |
| S4a J1 follow-up (`loose`, `readLiveSnapshot` generic over the host schema) | - | d666808cc |
| S4a T1 (importers + barrel repointed, files deleted, binding) | f4384c489 | - |
Final heads: Tovu `f4384c489` (+ this report), Jini `d666808cc` (+ this report).

## Left / next step
- **S4b** (`table-adapter.ts` partition into `trash/sql/table-adapter.{context,rows,cascade,transitions,purge}.ts`; deps.ts:1641, taxonomy slice :23/:33, entries repair :100, 9 test files, marker-sql parity table). Needs ~210k: not started. Prerequisite S4a is true now. `createTableTrashAdapter({ entry, db })` is still the Tovu shape; it already imports `entryWhere, loose, qualified` from `@jini-ai/cms/trash/sql` and `TrashEntry` etc. from `@jini-ai/cms/trash`.
- **S7a** not started (needs S4b).
- 24 why-comment blocks of earlier lanes still fail `npm run check:why-comments` (same 24 as on the base of this run; I added none: one comment I reworded in `features/publish-content/ui/report-rows.ts` lost its block, restored verbatim plus a second line).
- `check:hardwiring` is red on the base (8 stale `HW5-jini-export` occurrences) and unchanged by this run (output identical).

## Deviations from the sheets (judgement calls)
1. S2c tests: the ~15 test files and `memory-widget-trash.ts` that built `new TrashAwareInMemoryEntryRepo()` now call one test factory `features/entries/__tests__/support/trash-aware-entry-repo.ts` (`trashAwareEntryRepo()`, same binding expression as composition). Production `memory-deps/slices/repos.ts` builds the Jini class inline with `onWriteSettled: ({ repo }) => invalidateMediaAccessEvidence({ owner: repo })`.
2. S2c: local `type CollectionSortBy = CollectionListQuery["sort"]["by"]` in the Jini file (not exported) so the moved `{@link CollectionSortBy}` why-comment survives verbatim.
3. S4a: **`loose` is `loose<DB>(db: Kysely<DB>): Kysely<LooseTables>`, not `Kysely<unknown>` as the sheet says**: Tovu's typed `Kysely<ContentDatabase>` is not assignable to `Kysely<unknown>` (16 typecheck errors) and `withTables` alone keeps the static tables in the type. The one existing `as unknown as` moved with it (Tovu lost one, Jini gained one, with a why-comment). `readLiveSnapshot<DB>` takes `StorageKernel<Kysely<DB>, unknown>` for the same reason, so no kernel erasure is needed at the Tovu call sites.
4. S4a: `SqlTrashRepo` binding keeps `SqliteTrashRepo({ store })` (`schemaErasedKernel` + `tables: { trashedItems: "trashed_items" }`); `repo.contract.test.ts` builds the Jini class through a local `sqlTrashRepo(kernel)` helper; `p1-lock-keys.test.ts` builds `SqliteTrashRepo` instead of `SqlTrashRepo` (call shape only). `p1b` also asserts `trashEntityLockKey` equals the table adapter's key (the sheet's T1 lock-key parity test).
5. S4a: `./trash/sql` entry appended after `./entries/sql` in the cms manifest (the S1/S2 order).
6. The sheet's "`notTrashed` has 1 call site" holds; its call shape `notTrashed({ entityType, registry })` and `isTrashedRecord({ entityType, record, registry })` changed in the two tests only (allowed edit).

## Overlaps to list
- `apps/website/src/server/routes/types.ts` (S4a repointed `TrashRegistry`/`TrashBlockerSpec` import; T-PO-01g's file) and `features/trash/*` (K-07 agent tools: `agent-tools.ts`, `tool-registrations.ts` import lines), `features/entries/unreadable-owner-entries-repair.ts` import, `features/widgets/__tests__/*`, `assistant/__tests__/tool-registrations.{trash-item,widgets-contracts}.test.ts`, `server/inbound/public-http/**/__tests__/*` (K-01/K-02/K-02b rows: import lines only). Jini: `packages/cms/package.json`, `README.md`, `src/trash/index.ts`, `src/entries/index.ts` (T-PO-02 row). The su-s5 run (S6a) was not touched: no file of mine is in `outbox`/`settings`/`token`/`origin`; `package.json`/README of cms may conflict textually if it adds an export entry.

## Gates (exact command -> result)
Setup: Node 24.11.1 (`~/.local/node24`); Jini `pnpm install --frozen-lockfile` ok, `pnpm --no-bail -r build` exit 0; Tovu `npm ci`, `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`; contracts + sdk built with `npx tsc -p tsconfig.json` (the `npm run build` refuses while linked). Link/unlink dirties the four `package-lock.json` files: restored with `git checkout`, never committed.
Base (unmodified tree) captures: Jini `pnpm guard` 0; Tovu `check:size` 0 lines, `check:complexity` 0 lines, `check:boundaries` 16 errors, `check:architecture` 4 `regressed:` lines (as in the previous report).
- T0 mutation loops (`cloud-results/su-cms-2/mutate-s2c.py`, `mutate-s4a.py`; `mutations-s2c.txt`, `mutations-s4a.txt`): S2c 16/16 red on the expected test, S4a 9/9. The source is restored from `git show` after each; `git status` clean. (A first S2c run exposed two bad mutations/one weak test; fixed before commit.)
- J1 (Jini), S2c / S4a: `pnpm --filter @jini-ai/cms build` 0; `cd packages/cms && npx vitest run` 0 (S2c 348 files / 4234 tests; S4a 351 / 4256); `pnpm typecheck` 0; `pnpm guard` 0 and `diff guard-before guard-after | rg '^>'` empty; `pnpm check:size` and `check:complexity` pass; `limits` (50/10/10/500) prints nothing; STOP (b) only own-package/core/kysely imports, no `@jini-ai/db`, no raw SQL / `.dialect`; Jini `deleteFrom` lines: the two moved `trashed_items` bookkeeping deletes (Tovu lost the same two).
- T1 (Tovu), S2c / S4a: `npm run typecheck` 0 and `npm run typecheck:tests` 0; `check:boundaries` no new line; `check:size` and `check:complexity` print nothing beyond base; `check:architecture`: S2c propagation cost 3.21 -> 3.22 (worse by 0.01, already regressed), module API surface 851 -> 850 (better); S4a propagation cost 3.21 -> 3.23 (worse by 0.02, already regressed), API surface 851 -> 850; no new regressed metric. `limits` prints nothing; no new `deleteFrom` / `as unknown as` / `eslint-disable` / `@ts-ignore` in Tovu production code; stale-path `rg` prints nothing.
- Tests (`--test-concurrency=2`): S2c set 1337 tests, 1317 pass, 17 fail, 3 skipped; the 17 failures are the known base failures (Postgres `*.postgres.test.ts` x3 files, packaged-provider pins, EACCES, trickle deadline, roster federation, N-1 row), none in entries/widgets/trash. S4a set (trash tests, lane-su-pins, admin-trash, trash-item assistant, entries, post trashed-slug) 571 tests, 567 pass, 4 fail (all `*.postgres.test.ts`: no server), 0 skipped.
- `npm run check:why-comments`: 24 blocks (unchanged from base). `check:hardwiring`: identical to base (red, 8 stale).
- Server/test processes: none left running.
