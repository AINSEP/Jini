# su-cms-3: lane S cms chain, S4b done (PARTIAL: S7a step 0 only, S7b not started)

Branch `wave3/su-cms-3` in BOTH repos. Base `origin/refactor/terra` (Tovu b5fbf2a5e / Jini 6c9effae4) with `origin/wave3/su-cms` merged first (one `--no-ff`, no conflicts). No HELD decision ID applies. Plan: `origin/plan/lanes-s-u-2026-11-16` (`INDEX-SU.md`, `T-SQLREPO.md`, `S/S4`).

## Done (all pushed)
| step | Tovu | Jini |
|---|---|---|
| S4b T0 (characterization + marker-sql parity table, 15 mutations) | b4dbe0cd | - |
| S4b J1 (`table-adapter.{context,rows,cascade,transitions,purge}.ts` + `table-adapter.ts`, dialect-matrix tests, README, changeset) | - | 689fd45ec |
| S4b J1 follow-up (`createTableTrashAdapter<DB>`: a typed host kernel is accepted; the one schema-erasing cast lives in the factory) | - | 10e0e77f0 |
| S4b T1 (30 call sites repointed, `features/trash/table-adapter.ts` + `index.ts` re-export deleted, stale size-debt entry deleted) | 8e422f7a | - |

## Left / next step
- **S7a** (step 0 done, nothing written; stopped for context budget): prerequisites hold (S4b true now; R6-R9: `ColumnCatalogPort` exists in cms `forms/sql`). **Step 0 diff, Tovu `InMemoryVersionedMediaRepo` vs Jini `InMemoryMediaRepo` (`media/repo.memory.ts`)**:
  | member | Jini `InMemoryMediaRepo` | Tovu `InMemoryVersionedMediaRepo` |
  |---|---|---|
  | constructor | `{ initialRows }` | `{ initialRows, renditionRepo }` (a shared `InMemoryAssetRenditionRepo`) |
  | `findBySlug` | live row only | live row, else a retired slug's owner |
  | `save` | upsert by id, creator preserved | same, plus `reclaimOwnSlug` (another asset's retired slug throws `MediaConflictError`) and `retireSlug` |
  | `remove` | drops the row | drops the row and its retired slugs |
  | `listRetiredSlugs`, `saveIfVersion`, `insertIfAbsent`, `saveRenditionIfSource`, `replaceFileIfVersion` | absent | present |
  Decision the table makes: Jini's class would change behavior in three EXISTING methods (not just gain methods), so it is NOT extended; MOVE the class beside it as `packages/cms/src/media/versioned-repo.memory.ts` (the sheet's second branch), with `VersionedMediaRepoPort` in `media/versioned-repo.ts` and `guardMediaRenditionRepo` beside `rendition-service.ts`. `MediaFileReplacementRepoPort` (with optional `replaceFileIfVersion` / `saveRenditionIfSource`) is already in Jini `media/replace-media-file.ts:45`. T0 rows to write first against the Tovu class: stale `saveIfVersion` refused with the row unchanged; `insertIfAbsent` false on a taken id; `listRetiredSlugs` set for a rename chain and freed on `remove`; `saveRenditionIfSource` refuses when the source sha moved; `guardMediaRenditionRepo` throws `MediaConflictError` on a changed source. Tovu importers (facts file, re-verify with `rg`): prod `features/media/{index,where-used}.ts` + `guard-rendition-repo.ts`, `server/inbound/public-http/routes/site/media-rendition.ts`; tests `features/media/__tests__/{guard-rendition-repo,mediawidget-where-used,verify-published-media,versioned-*}.test.ts`, `server/inbound/admin-http/routes/media/__tests__/replace.test.ts`; `platform/db/repos/media-repo.ts:8` (S7b) imports the port.
  Next step: T0 (tests + mutations, commit), then J1, then T1; est. ~110k.
- **S7b** not started (needs S7a).

## Deviations from the sheet
1. Jini `createTableTrashAdapter` is `<DB>`-generic (`kernel: StorageKernel<Kysely<DB>, unknown>`) so Tovu passes the same lazy `ContentKernel` it passed as `db:` before, with no cast at any call site (S4a's `loose` follows the same pattern). The kernel is still read on first use (`ctx.kernel = () => (resolved ??= required.kernel as unknown as ...)`); a T0 test and a Jini test pin that.
2. `TRASH_TABLES = { trashedItems: "trashed_items" }` is defined once in `features/trash/repo.sqlite.ts` (also used by `SqliteTrashRepo`); every call site passes it. No barrel re-export of `createTableTrashAdapter`: importers use `@jini-ai/cms/trash/sql` directly.
3. `trash-adapters-taxonomy.ts`: its local `MemoryTaxonomyTrashInput` keeps the `db` prop (Tovu's own interface), typed `TrashDb` and `TrashEntry` instead of `Parameters<typeof createTableTrashAdapter>[0]` (the factory is generic now).
4. The marker-sql parity table (`table-adapter.marker-sql-parity.test.ts`) shows two differences, recorded as test expectations: the bespoke `flipMarker` omits the `noop: true` flag on the idempotent case, and the bespoke `compareAndDelete` purges a LIVE row (the table adapter returns `version-changed`). Every other row is identical. S4d may rely only on the identical rows.
5. T0 mutation count: 15 (sheet table has 9 risks; the cascade, lock and classification rows were split per method).

## Overlaps to list
Tovu: `server/runtime/composition/deps.ts` (import + the one constructor call; shared file, S6a is the other sheet), `memory-deps/slices/trash-adapters-taxonomy.ts` (K-05b), `features/entries/unreadable-owner-entries-repair.ts`, `features/trash/index.ts`, `features/trash/repo.sqlite.ts`, ~25 test files under `features/trash/__tests__`, `lane-su-pins/*`, `server/__tests__/admin-trash-*`, `commerce-strip-parity.test.ts`, `development/scripts/size-debt.json` (one entry deleted). Jini: `packages/cms/src/trash/sql/index.ts`, `README.md` (T-PO-02 row).

## Gates (exact command -> result)
Setup: Node 24.11.1 (`~/.local/node24`); Jini `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` exit 0; Tovu `npm ci`, `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`, contracts + sdk `npx tsc -p tsconfig.json`. Lockfiles not dirtied.
Base captures (unmodified tree): Jini `pnpm guard` exit 0; Tovu `check:size` 0 lines, `check:complexity` 0 lines, `check:boundaries` 14 errors, `check:architecture` 4 `regressed:` lines.
- T0: `TT table-adapter.characterization.test.ts` 6/6 green; `...marker-sql-parity.test.ts` 14/14 green; `npm run typecheck:tests` 0; mutation loop `cloud-results/su-cms-3/mutate-s4b.py` -> `mutations-s4b.txt`: 15/15 red on the named test, source restored (`git status` clean).
- J1 (Jini): `pnpm --filter @jini-ai/cms build` 0; `cd packages/cms && npx vitest run` 362 files / 4379 tests pass (new dialect test: 24 = 12 x sqlite+pglite); `pnpm typecheck` 0; `pnpm guard` 0, `diff guard-before guard-after | rg '^>'` empty; `pnpm check:size` and `check:complexity` pass; limits (50/10/10/500) print nothing for the 6 new files; STOP (b): only relative paths, `@jini-ai/core/contracts/storage`, `kysely`; STOP (a)/(c): every query target is a registry-driven name or `ctx.tables.trashedItems`, the only `sql` template is the moved version bump; Jini `deleteFrom` lines added: 4 (cascade x3 incl. `trashed_items`, parent delete x1), Tovu removed the same 4.
- T1 (Tovu): `npx tsc -p tsconfig.json --noEmit` 0 and `npm run typecheck:tests` 0; `check:boundaries` no new line; `check:architecture` identical to base (`diff` empty); `check:size`: the one "Delete stale debt entry" line deleted in this commit, then nothing beyond base; `check:complexity` nothing; limits: only `deps.ts max-lines` (file already 1910 > 500, +1 import line); no new `deleteFrom` / `as unknown as` / `eslint-disable` / `@ts-ignore` in Tovu production code; stale-path `rg` prints nothing in code; write-path baseline diff prints nothing.
- Tests (`--test-concurrency=2`, 61 files: all `features/trash/__tests__`, `lane-su-pins`, changed tests, admin-trash, trash-item, unreadable-owner): 587 tests, 584 pass, 3 fail, all three also fail on the unmodified base (the unreadable-owner `*.postgres.test.ts` x2: no Postgres server; `tool-registrations.contracts` redirects_get_hits description template).
- `npm run check:why-comments`: 1 block lost, `features/trash/entry-sql.ts:20-21` (`loose`'s S4a comment, reworded in Jini in S4a); nothing from the table adapter. Pre-existing, not touched here.
- Server/test processes: none left running.
