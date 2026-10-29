# Commerce coverage canary (2026-10-29)

## Why coverage read 4.01% lines / 39.7% branches
It was a **measurement-slice bug, not a test gap.** The package runs three suites (see `pnpm test`):
node:test for `catalog/__tests__/unit/*.test.ts`, the jsdom config `vitest.config.ts` (`include: src/react/**/*.test.tsx` only),
and `vitest.kernel.config.ts` (node env, `src/**/*.vitest.test.ts` — 48 files, ~1100 tests).
Running `npx vitest run --coverage` with no `-c` picks the default config, which collects only the 3 React test files.
With the repo-wide include, every other source file sat in the denominator at 0% (money, catalog, payments, http, tools = 0%; `src/react` = 100%) — hence ~4%.
Tests were collected correctly under their own config, none import `dist`, and only one test file is skipped (`postgres.vitest.test.ts`, needs a live Postgres).

## Fix (measurement only; no code excluded, no threshold touched)
- Added `vitest.coverage.config.ts`: one run over both the node `*.vitest.test.ts` suite and the React suite (jsdom via `environmentMatchGlobs`), `all: true`, include `src/**/*.{ts,tsx}`, exclude only `__tests__`.
- Added `pnpm test:coverage` script in package.json. Use `--maxWorkers=2 --minWorkers=1` (included in the script).

## Before / after
Before (default config): 4.01% lines, 39.7% branches. After the config fix alone: 98.31% lines (kernel config only) / 100% lines, 99.95% branches (combined config). After one new test: **100% statements / branches / functions / lines across all 68 source files.**

| directory | files | lines | branches |
|---|---|---|---|
| `src` | 2 | 25/25 | 6/6 |
| `src/catalog` | 11 | 585/585 | 178/178 |
| `src/http` | 2 | 61/61 | 23/23 |
| `src/money` | 1 | 49/49 | 34/34 |
| `src/payments` | 4 | 136/136 | 105/105 |
| `src/payments/accounting` | 2 | 400/400 | 329/329 |
| `src/payments/contract` | 7 | 74/74 | 33/33 |
| `src/payments/ingest` | 3 | 218/218 | 152/152 |
| `src/payments/ledger` | 5 | 984/984 | 399/399 |
| `src/payments/ledger/migrations` | 5 | 215/215 | 39/39 |
| `src/payments/ops` | 12 | 753/753 | 512/512 |
| `src/payments/providers` | 1 | 9/9 | 1/1 |
| `src/payments/state` | 1 | 73/73 | 24/24 |
| `src/payments/testkit` | 3 | 159/159 | 72/72 |
| `src/payments/tools` | 6 | 277/277 | 103/103 |
| `src/react` | 3 | 168/168 | 2/2 |

## Tests written
- `src/catalog/__tests__/unit/repo.vitest.test.ts`: webhook-event repo against a driver that omits `numInsertedOrUpdatedRows`. Covers the only uncovered branch (`src/catalog/repo.ts:271`, the `?? 0` fallback). Mutation-checked: removing `?? 0` makes the test fail.

## Real bugs found
None.

## Still under 100%
Nothing under the combined config. Caveats: the node:test catalog files (`*.unit.test.ts`, 9 files) are not in this vitest run (they run via `node --test`), so coverage of catalog code comes from the vitest catalog suites alone and is already 100%; the Postgres ledger test is skipped without a database, so Postgres-specific behavior is unmeasured by this run (the file's code is still counted as covered by other suites).
