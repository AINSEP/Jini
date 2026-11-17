# xpkg-r6r9 — sheet R6-R9 (storage consumers) — DONE (all four parts)

Branch `wave2/xpkg-r6r9` in Jini and Tovu. Base: Jini `65d73b0d` and Tovu `232764af` (= `origin/refactor/terra` in both). Node 24.11.1, pnpm 10.33.2. Tovu linked to this Jini checkout.

## SHAs (steps run in the sheet's order: §3, §4, §2, §1)
| step | Jini | Tovu (paired) |
|---|---|---|
| 1 §3 `RateLimiter` + `RateLimitResult` -> core/contracts/server | `ae296d62` | `69d827ca` |
| 2 §4 `FormCommandExecutorPort` = core `ExecuteCommandFn` | `362d9c06` | none needed |
| 3 §2 `ColumnCatalogPort` for the IP retention repo | `9392b818` | `6fad5bbf` |
| 4 §1 `migrateCommercePayments({ kernel, runMigrations })` | `dea17a91` | `c2aada19` |
This report is the last commit in each repo.

## Baseline (unmodified tree, recorded before any edit that was kept)
Jini: `pnpm --no-bail -r build` ok; `pnpm guard` exit 0; `check:size` 0; `check:complexity` 0; `api:check` 0; `pnpm typecheck` 0; `check:hooks` exit 1 (BASE-RED: packages/ui "calls useT directly", 70 lines, untouched by this run). Package tests: http-kit 561, core 2934, cms 4085, commerce 1409 passed + 1 skipped (plus 3 jsdom + node unit files), cms/forms 157.
Tovu: `npm run typecheck` 0; `check:size` exit 1 and `check:complexity` exit 1 (BASE-RED, output saved as the base lines).
Setup slip, mine: I edited core/http-kit/cms for step 1 while the base build was still running; I stashed those edits, confirmed the built `dist` had none of them, and took the baseline on the clean tree.

## Ratchets after the work (vs the base output)
- Jini `pnpm guard`: same output except one advisory count line (`injection advisory`, "not failing"): test-only cross-package imports 383 -> 394 (+9 `runMigrations` imports in commerce tests, +2 in the new tests). No violation line added.
- Jini `check:size`, `check:complexity`: exit 0. `check:hooks`: identical to base. `pnpm typecheck`: 0. `pnpm api:check`: 0.
- Tovu `check:size`/`check:complexity`: identical to base except `commerce.ts:68 -> :69` for `composeCommerce` (same violation, 267 vs baseline 266, shifted one line by the added `runMigrations` import). No new violation. `npm run typecheck` 0 after every Tovu commit.

## Part 1 (§3) RateLimiter -> core
- `core/src/contracts/server/rate-limit.ts` NEW (`RateLimiter`, `RateLimitResult`), one `export *` line in `contracts/server.ts` (the sheet asks for it; it is a new core file in an existing barrel, not a forwarder). http-kit imports the types from core and no longer exports them. cms `comments/ingress.ts` imports from core.
- Debt keys retired: cms `ingress.ts` type-import; cms `package.json` http-kit manifest-peer. `@jini-ai/http-kit` removed from cms peerDependencies, peerDependenciesMeta, `jini.optionalPeers`; kept as devDependency (test fixtures). Manifest-assertion tests updated (see S13).
- Pin: `http-kit/src/__tests__/core-server-contract.typecheck.ts` (core `RateLimiter` and a literal copy of the old shape assignable both ways; `createRateLimiter` returns it). Mutation (drop `size` from the pinned shape) -> TS2741 red, restored -> green. http-kit's 561 existing tests unchanged and green.
- Tovu: `contracts/core/rate-limit/rate-limit.ts` takes the types from core. Typecheck 0; rate-limit and two external-mcp tests, 47/47.
- Changeset `rate-limiter-port-to-core.md` (core minor, http-kit minor, cms patch).

## Part 2 (§4) cms-forms -> cms
- `cms/forms/src/ports.ts`: `FormCommandExecutorPort = ExecuteCommandFn`. `@jini-ai/cms` moved from `dependencies` to `devDependencies` (four test files import `@jini-ai/cms/core`); lockfile importer entry edited by hand because `pnpm install --lockfile-only` is blocked here by `minimumReleaseAge` on an unrelated electron dependency; `pnpm install --frozen-lockfile` passes afterwards. Debt keys retired: forms `package.json` and `ports.ts`. `cms-forms→cms` removed from `sameLayerEdges` in `scripts/check-package-layers.ts` (no test named it; both layer test files pass, 95 tests).
- Reverse direction added to `cms/src/core/__tests__/execute-command-fn.typecheck.ts`. Mutation (core return type drops `changeSetId`) -> TS2322 red, restored -> green.
- cms/forms tests 157/157. Changeset `cms-forms-executor-port-from-core.md`.

## Part 3 (§2) cms retention repo -> host catalog port
- Tests first, RED run seen (8/8 failed: 4 cases x SQLite and PGlite) in `forms/__tests__/submission-ip-retention.ports.unit.test.ts` (fake catalog over a real database): nullable -> update runs and the probe is asked for `tables.submissions`; NOT NULL -> the 0006 error and no write; no re-probe after success; re-probe after a refusal and after a failing probe (the probe's own error propagates). Then green 8/8. Mutations, each red: branch inverted (8 fail), memo dropped (2), wrong table (2), probe error swallowed (2).
- `sql/ports.ts` NEW (`ColumnCatalogPort`, 2 lines; exported from `sql/index.ts` with `export type {…}`). Factory takes `columns` in the required object. Existing dialect tests unchanged: fixture binds `listColumns` from db.
- The one allowed edited cast (S10), position unchanged: before `suppliedKernel as unknown as KyselyKernel<FormSubmissionDatabase>`; after `suppliedKernel as unknown as StorageKernel<Kysely<FormSubmissionDatabase>, FormSubmissionDatabase>`. Comment reworded: "The kernel's catalog helper" -> "The host's catalog port".
- `@jini-ai/db` removed from cms peerDependencies/Meta/optionalPeers (devDependency kept); debt keys retired: cms `package.json` db peer, `submission-ip-retention-repo.ts`. New boundary test "CMS declares no production dependency on the database toolkit". cms api-baseline regenerated. Changeset `cms-retention-columns-port.md` (cms minor).
- Tovu `features/forms/repo.sqlite.ts`: `columns: ({ table }) => listColumns(kernel, table)`. Typecheck 0; dialect + expiry-sweep tests 9/9. The only construction site is that wrapper (the `:28` kernel belongs to a sibling class).

## Part 4 (§1) commerce -> db
- Tests first, RED run seen (4/4) in `ledger/migrations/__tests__/migrate.ports.vitest.test.ts` (recording fake runner): T1 positional `(kernel, steps, options)`, steps by identity, step ids/order; T2 ledger table forced even for a smuggled `ledgerTable`; T3 every option forwarded; T4 report by identity, rejection unchanged. T5 = the existing SQL suites, green before and after. Mutations, each red: spread order reversed (T2), options dropped (T2,T3), error wrapped (T4), object-shaped call (T1-T3).
- `migrations/index.ts` as the sheet's sketch (`PaymentsMigrationKernel`, `PaymentsMigrationRunner`, retyped step list); no cast needed, `pnpm --filter @jini-ai/commerce build` and typecheck pass.
- `migrations/__tests__/migrations.options.typecheck.ts` NEW: key-set equality and both-way assignability with db's `Omit<MigrationOptions, "ledgerTable">`, plus `runMigrations satisfies PaymentsMigrationRunner<KyselyKernel<unknown>, MigrationReport>`. commerce's tsconfig excludes `__tests__`, so I listed this file under `files` in `packages/commerce/tsconfig.json` so `tsc` checks it. Mutation (drop `clock` from the options) -> TS2322 red.
- `@jini-ai/db` removed from commerce peerDependencies/Meta/optionalPeers (devDependency kept); three debt keys retired. Header comments in `ledger/sql.ts`, `payments/kernel.ts`, `repo.sql.ts` reworded (db no longer loaded at runtime). Changeset `commerce-migration-runner-injected.md` (commerce minor).
- Callers: nine in-package test files pass db's `runMigrations` (the sheet listed five): ingest/accounting harnesses, sqlite, postgres, quarantine-limit, migrations, empty-attempt-ops, open-payments, ops/intent-recovery. Commerce suite: 1413 passed + 1 skipped (was 1409 + 1; +4 new). The test-caller lines type-check; the remaining TS errors under `__tests__` are pre-existing in other lines (that folder is excluded from the build).
- Tovu: `composition/commerce.ts` imports `runMigrations` from `@jini-ai/db/migrate` and passes it. Callers the sheet did not list, fixed in the same pair: `commerce-composition.unit.test.ts` (2 calls) and `settlement.integration.test.ts` (1 call). `commerce.errors.unit.test.ts` mocks the whole module with a no-arg fake and needed no change. Tests: 12 run, 11 pass; the one failure is the `[postgres]` case, `connect ENOENT /tmp/.s.PGSQL.5432` (no Postgres server in this container: ENV, same case does not run without one).

## Sheet errors found
1. §1 `PaymentsMigrationOptions` listed 7 of db's 11 option fields (the `rg -A14` in the sheet cut the interface). `historyCheck`, `clock`, `legacyLedger` were missing; an existing commerce test passes `clock`. Its own rule says "copy every field except ledgerTable", so I copied all ten, and `legacyLedger`'s three-field shape locally. The sheet's "assignable both ways" check could not see this because every field is optional; the new key-equality pin does.
2. §1 names the new test `migrate.ports.unit.test.ts`; commerce's runners only pick up `*.vitest.test.ts` (kernel config) and `src/catalog/__tests__/unit/*.unit.test.ts` (node:test), so I named it `.vitest.test.ts`.
3. §1 lists five in-package callers of the runner; there are nine (see above). §1 lists one Tovu caller; there are three.
4. §3/§1: base `api-baseline` files are stale relative to base for many packages (`api:check` only fails on removals). I committed regenerated files only for `core`, `http-kit`, `cms`, `commerce`; their diffs therefore also carry other lanes' additions that were already missing at base. The other packages' regenerated baselines were reverted, not committed.
5. §3 step manifest rule says the `rg` "prints nothing"; it still prints comment lines mentioning http-kit. I treated production imports as the criterion.

## Overlaps with parallel lanes
Touched shared files: `scripts/injection-debt.json` (own keys deleted by hand), `pnpm-lock.yaml` (one importer block), `api-baseline/jini-ai__{core,http-kit,cms,commerce}.json`, `.changeset/*` (four new files), `scripts/check-package-layers.ts` (one set entry). A later lane that regenerates those baselines should rebase and run `pnpm api:update`.

## S-gates (command output; BASE = base SHA above)
- S3: only `+export * from './server/rate-limit.js';` in core's existing barrel (the sheet's one line). No function bodies that are one forwarding call.
- S4, S5 (added keys / hook imports), S6, S11: print nothing. `check:hooks` has no new key.
- S7: comment lines that vanished are all reworded, not dropped: ledger/sql.ts header, repo.sql.ts "run migrateCommercePayments first", the lipay-removal why-comment and the ledger-table note (now in the doc block of `migrateCommercePayments`, with the spread-order note), `payments/kernel.ts` SQL-half comment, the retention repo "catalog helper" comment ("host's catalog port"), the execute-command typecheck doc comment, and the cms boundary-test REGRESSION comment (rewritten for the new invariant).
- S8 (eslint 50/10/500 on the 12 changed source files vs base): prints nothing.
- S9: one added exported function, `migrateCommercePayments(required: { kernel, runMigrations }, optional = {})`; two-object shape kept.
- S10: one hit, the allowed edited cast above. S12 binding test: T1 (argument order and positional shape). 
- S13: removed assertions, each replaced: cms manifest peer assertions for http-kit (3 lines + one test) and db (2 lines) -> the two "declares no production dependency on the HTTP/database toolkit" tests; 5 `migrateCommercePayments({ kernel })` lines and the rows-test title changed only by the added `runMigrations`/reworded title. Counts: cms 4085 -> 4094 (+8 retention port cases, +1 net boundary test); commerce 1409 -> 1413 (+4); http-kit 561 and core 2934 unchanged; cms/forms 157 unchanged.
- S14: see ratchets above.
- Not run: the root `pnpm test:scripts` suite and Tovu's full `npm test` (only changed files, per the brief); the Postgres variants that need a server.

## Left / next step
Nothing left in R6-R9. Next: owner merges `wave2/xpkg-r6r9` (Jini and Tovu together) into `refactor/terra`; the second lane to touch `api-baseline/jini-ai__{core,commerce}.json` or `injection-debt.json` rebases and regenerates.
