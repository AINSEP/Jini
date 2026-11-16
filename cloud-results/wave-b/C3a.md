# C3a storage-Jini — DONE (hand-edit scope; repoint rows left to applier pass B1)
Branch `wave-b/C3a` from refactor/terra `b7666092` (Jini). Tovu not edited (HEAD b28d38c6). Commits: see `git log wave-b/C3a`.

Done: core `contracts/storage` (+`storage/{kernel,values,rows,sqlite,migration}.ts`); db `kernel/port.ts` replaced (`KyselyKernel`, `DbTransport`); moved fns/types out of db `dialect.ts`, `row-values.ts` (JsonObject only), `migrate/step.ts`; deleted `sqlite/{types,sync-types,restore-types}.ts`; `driver.ts` `SqliteKernel = KyselyKernel`; `kernel-core.ts` driver transport typed `DbTransport`; commerce `COMMERCE_PAYMENTS_SOURCE_DIGESTS` + test split (ledger checksums byte-identical, asserted as literals; mutation check red then reverted); tests: core rows (moved)/values/kernel, db kysely-kernel; changeset `core-storage-contract.md`.
Skipped (by brief/scope): events (C3b); barrel DROP rows, importer repoints, runner.ts signature, SK-DB renames, commerce step-file imports (all TSV rows, applier). Added a NEW `export type { DbTransport, KyselyKernel }` line in `kernel/index.ts` and a new core import line in `driver.ts`/`dialect.ts` rather than replacing statements, so TSV rows stay applicable.
core/package.json: `./contracts/storage` export + `jini.entries` universal; README row added (coordinator: merge with C3b's events entry). No lockfile/debt-json edits. Debt retired: none verified (ratchet not run post-applier).

Verified in a throwaway worktree with the C3 jini rows applied (storage rows only; events rows excluded): core build+typecheck green; db typecheck green; core storage tests 13/13; commerce migrations test 18/18.
Checks on the branch: complexity ratchet pass; size ratchet pass; `rg` Tovu-text on touched files empty; guard 145 violations, none on touched files (PRE-EXISTING: N1/N2 Tovu text in untouched db files, HW3, SI, R13; ENV: unbuilt deps).
Errors: 
- NEEDS-APPLIER-PASS: branch db/commerce/etc. do not typecheck until C3 rows are applied.
- Sheet wrong (3 STALE rows, all "moved/rewritten by symbol_map"): C3.repoint.tsv:187,188 (`sqlite/{restore,sync}-types.ts`) and :201 (`migrate/step.ts` StorageKernel import) — applier must skip them (files deleted/rewritten here).
- Sheet wrong: row for `db/src/sqlite/transaction.ts` RawBuilder→`kysely` makes `import-isolation.test.ts` fail ("kysely outside kernel/migrate"). Skip that row; `port.ts` still re-exports `RawBuilder`, so the file keeps importing it from `../kernel/port.js`.
- After the pass: `kernel-core.ts` keeps an unused `StorageTransport` import (moved to core by its row); drop it.
- LANE-CAUSED (needs applier-time fix, not done: owner rule against loosening): `db/src/__tests__/loads-without-driver.test.ts` allowlists of runtime-loaded packages (kernel, kernel/sqlite, kernel/pglite, pglite, data-modules) must now include `@jini-ai/core` (db imports core's `UnsupportedCapabilityError` at runtime). PRE-EXISTING in same file: peer `@jini-ai/platform` expected `^0.6.10`, is `^0.7.0`.
- ENV: `vitest --maxWorkers=2` throws "minThreads/maxThreads must not conflict" on this image; used `--pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=2`.
Context ~70 tool calls; wall clock ~20 min.
