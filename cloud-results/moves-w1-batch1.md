# moves/w1-batch1 results

Window: 03:58 to about 04:04 UTC 2026-11-16. Both branches are cut from origin/refactor/terra. Nothing was skipped.

| # | Slice | Result | Jini SHA | Tovu SHA | START / END |
|---|---|---|---|---|---|
| 1 | delete-postgres DL-postgres-1 | DONE | none (Tovu only) | 54421a74 | 03:59:02 / 03:59:27 |
| 2 | split-commands MV-commands-1 | DONE | cc16cee1 | e42acbec | 03:59:40 / 04:00:00 |
| 3 | move-kernel MV-kernel-1 | DONE | 0c6b6f9b | 4e69539c | 04:00:07 / 04:00:40 |
| 4 | split-web DL-web-1 | DONE | f0cf14bb | f931ce45 | 04:00:47 / 04:01:01 |

Every blob guard, census and reach check matched the sheets. Slice 2 uses T-MOVE; the task text said T-SPLIT, but the sheet itself names T-MOVE, so I used that.

## Paths
- **1:** Tovu deleted `db-ops.ts`. It edited `db-ops-adapter.ts`, `db-ops.integration.test.ts` and `.dependency-cruiser.mjs`. `node --check .dependency-cruiser.mjs` passed.
- **2:**
  - Jini added `packages/plugins/src/host/node/integrity-command.ts`, edited `host/node/index.ts` and added `.changeset/plugins-integrity-command.md`.
  - Tovu deleted `cli/commands/plugin/integrity.ts` and edited `program.ts` plus 2 unit tests.
- **3:**
  - Jini added `packages/db/src/sqlite/stopped.ts` and `__tests__/stopped.test.ts`, edited `sqlite/index.ts` and added `.changeset/db-stopped-sqlite.md`.
  - Tovu deleted `checkpoint-stopped-wal.ts` and its test, and reduced `stopped-database.ts` to the binding.
- **4:** Jini added `packages/platform/src/web/__tests__/html-document-host-pin.test.ts`. Tovu deleted `features/web/html-document.ts` and its unit test.

## Checks
- **Jini rule-2 (no Tovu text) and rule-5 greps:** clean on every Jini file I created or edited.
- **eslint (Jini):** the three slice-3 files had 0 errors.
- **eslint (Tovu):** the 6 edited existing files had 0 errors.
- **vitest:**
  - `packages/db` `src/sqlite`: 21 passed, including the 4 relocated tests.
  - `packages/platform` `html-document-host-pin.test.ts`: 1 passed.
  - I did not run the plugins tests; slice 2 added no Jini test.
- **Jini typecheck:** `tsc --noEmit` per package.
  - `pnpm -r build` fails in `packages/desktop-host`, so sibling dist is missing. The failing errors are at `src/logging.ts(76,32)` and `(79,63)` (TS2379, exactOptionalPropertyTypes). They are in files my commits did not touch, so I take them as pre-existing, but I did not run a baseline on the unmodified tree.
  - `packages/platform`: 0 errors.
  - `packages/db`: 26 errors. 25 are unresolved `@jini-ai/platform/*` imports in the secrets-vault files, which are unrelated and come from the missing dist. **1 is mine (below).**
  - `packages/plugins`: 13 errors, none in my files. They are unresolved `@jini-ai/db/kernel`, `@jini-ai/platform/fs/file-lock` and the like, plus `src/host/__tests__/unit/source-drafts.unit.test.ts(34,65)`.
- **Tovu typecheck:** not run; it would only show unresolved new Jini specifiers until the clones are linked.

## Sheet errors
1. **`packages/db/src/sqlite/stopped.ts(69,39)` TS2740 (my error).** MV-kernel-1 types `StoppedSqliteOpener` as returning `Pick<SqliteClient,'exec'|'pragma'|'close'>`. But `verifySqliteIntegrity({ db })` needs `SqliteSyncClient` (open, prepare, transaction, memory, and more).
   - Fix, for the coordinator: widen the opener's return type to `SqliteSyncClient`, or `Pick<SqliteSyncClient,...>` with the members `VerifyDbOptions` needs.
   - I did not change it, because the recipe says never improvise.
   - Tests pass because vitest does not typecheck. `checkpointStoppedSqliteWal` itself types fine.
2. The MV-kernel-1 census says `stopped-database.ts:5`, but the actual line is 6. The blob matched, so this is a one-line sheet typo.
