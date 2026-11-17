# bug-triage-1 — Jini, branch `fix/coverage-red-tests`

Base: `origin/refactor/terra` 65d73b0d5. Setup: Node 24 (~/.local/node24), `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build`.

## Baseline (unmodified tree)
- `pnpm --no-bail -r build`: 41 pass, 1 fail — `packages/sandbox` (`tsconfig.cjs.json`: TS5107 `moduleResolution=node10` deprecated). Pre-existing, not touched.
- `packages/plugins`: `tsc --noEmit` clean; `vitest run` green (the 6 tests the coverage report listed as red on its old base are green here — the missing `PLUGIN_PROVIDER_CAPABILITY` import was already restored on terra by 2c3be00a).
- vitest note: `--maxWorkers=2` alone crashes this tinypool pairing ("minThreads and maxThreads must not conflict"); used `--maxWorkers=2 --minWorkers=1`.

## The 4 red tests (coverage branch `test/coverage-jini-integrations-plugins`, report `cloud-results/coverage-jini-integrations-plugins.md`)
They are the "provider plugins" block of `packages/plugins/src/host/__tests__/unit/runtime-core.coverage.unit.test.ts` (the branch's report says 4; the block has 6 tests, 5 were red on terra). I ported only that block (plus a trimmed host fixture) into `runtime-core-providers.unit.test.ts`; the rest of the coverage branch is not merged.

Verdict per test:
| test | verdict |
|---|---|
| lists enabled provider plugins with declarations | **wrong test** — fixture id `prov-a-engine` has hyphens; provider ids must match `PROVIDER_ID_PATTERN` `[a-z][a-z0-9_]*`, so the manifest was (correctly) invalid. Fixture changed to `prov_a_engine`. |
| loads only requested, enabled provider plugins | **wrong test** — same fixture. |
| skips provider plugin on boot re-attach | **wrong test** — same fixture. |
| logs and skips a provider plugin that fails to load | **wrong test** — same fixture. |
| abandons a provider plugin whose load outlasts the deadline | **real bug** — stayed red after the fixture fix. `loadProviderPlugins` logged a timeout via `describeErrorForLog`, which prints only a class label (`Error`) by design, so the warning never said the load timed out. Fixed: new `ProviderLoadTimeoutError` (`packages/plugins/src/host/node/provider-load-timeout-error.ts`, message built only from the deadline number, safe to log verbatim); the catch logs its message and still uses `describeErrorForLog` for every other error. Test kept as written (only renamed "…and says it timed out"). |
| (6th) starts with empty browser provider generation | passed unchanged. |

Red shown first: `npx vitest run src/host/__tests__/unit/runtime-core-providers.unit.test.ts` → 1 failed / 5 passed (timeout test, `expected false to be true`). After the fix: 6 passed.

## Gates (after the change)
- `packages/plugins`: `npx vitest run --maxWorkers=2 --minWorkers=1` → 76 files, 1017 tests passed.
- `packages/plugins`: `npx tsc -p . --noEmit` → no output (clean).
- `pnpm guard` → ok, zero violations.
- runtime-core.ts: +3/-2 lines (file was already >500 lines on base; the new class lives in its own file so it did not grow).

## Commit
- 157ff6ea `fix(plugins): a provider plugin load timeout is logged as a timeout, not a bare 'Error'` on `fix/coverage-red-tests` (pushed).

## Left / next
- Integrations coverage items in the old report (sign-in, tool-registrations, host.ts, …) are NOT ported — coverage runs last.
- Overlap: `packages/plugins/src/host/node/runtime-core.ts` (one import + two lines) — other runs touching it will conflict trivially.
