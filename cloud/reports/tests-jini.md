# tests-jini — in progress

Started 2026-11-06 19:48 UTC; hard stop by 21:48 UTC.

- Jini branch: cloud/tests-jini; base 3a41ec5b678e7445dce1f23d5fe08735cdd4e2b8 (origin/cloud/combine).
- Tovu local branch: cloud/tests-jini; base b34b9cb7ada1783698eea8ec83bb3d6913fc63c4 (origin/cloud/combine). No tracked changes planned.
- Job instructions: origin/cloud-plans-1105 cloud/jobs/COMMON.md and cloud/jobs/tests-jini.md.
- Loaded shared AI-Dev-Shop instructions and software-architect, programmer, tdd personas.
- Logs: /workspace/work/tests-jini/.

## Progress

Initial rebuild in progress (`source /workspace/.tovu-build/env.sh; pnpm -r build`).
Dependency verification: `pnpm install --frozen-lockfile`.
Next: refresh Tovu links, run package tests serially, run CI quality gates, diagnose failures and make minimal fixes.

## Bugs found

None confirmed yet.

## Checkpoint 1

- Rebuild passed after refreshing dependencies; Tovu link refresh passed. Scratch cache/store used because the default home caches are read-only. Obsolete installed plugin directories were preserved under the job scratch directory.
- `pnpm typecheck`: passed (all workspace packages plus scripts).
- `pnpm test:agent-plugins:content`: 1405 passed, 0 failed, 0 skipped before the new regression.
- `pnpm guard:drift`: identified obsolete setup directories and the CMS dependency bug below; final rerun pending.
- Initial complexity scan overlapped setup directory cleanup and failed with ENOENT; rerun on the stable tree pending.
- Workspace tests running serially, max two Vitest workers; each package has its own log.
- `examples/minimal-host`: 2 passed, 1 failed because npm's default cache is read-only; rerun with writable npm cache pending.
- `examples/reference-web`: 54 passed, 2 suite collection errors because node:test browser suites were collected by Vitest; runner repair in progress.
- Dependency-cruiser report completed; full counts will be included at closeout.
- Gitleaks 8.28.0 (CI checksum verified): current-change scan passed; full-history scan reported 347 untriaged historical findings across 4238 commits. No values inspected or included here.
- Semgrep 1.175.0: local rule regressions 6/6 passed. Application scan blocked by the environment's HTTP policy denying the configured registry host; incomplete, not green.

## Fix 1 — CMS build dependency

CMS portable APIs are bundled into the Cloudflare plugin payload, so the agent-plugin distribution must not install CMS at runtime. Moved the unchanged CMS link from dependencies to devDependencies and updated its lockfile classification. Added a regression that executes the bundled evidence reader without package ancestry, checks valid/invalid evidence, and asserts distribution dependency isolation. No existing assertion or rule changed.

Exact commands after sourcing `/workspace/.tovu-build/env.sh`:

- RED: `node --test packages/agent-plugins/cloudflare/__tests__/bundled-package.test.mjs` — 4 passed, 1 failed.
- GREEN: `node --test packages/agent-plugins/cloudflare/__tests__/bundled-package.test.mjs packages/agent-plugins/cloudflare/lib/__tests__/forms.test.mjs` — 17 passed, 0 failed, 0 skipped.
- `pnpm --filter @jini-ai/agent-plugins run typecheck` — passed.
- `pnpm exec eslint packages/agent-plugins/cloudflare/__tests__/bundled-package.test.mjs` — passed.
- `pnpm install --frozen-lockfile --lockfile-only --offline --store-dir /workspace/work/tests-jini/pnpm-store --cache-dir /workspace/work/tests-jini/pnpm-cache` — passed.
- Existing package layer checker, filtered to the agent-plugin manifest — no violations.

BUG: The agent-plugin distribution declared bundled CMS code as a runtime dependency, violating the existing package layer gate. Fixed.
BUG: Reference-web's default Vitest command collects browser suites authored for node:test. Under investigation.

## Fix 2 — Reference-web test runners

The browser E2E files use node:test; passing them to Vitest caused two collection failures. The default command now runs every src Vitest test and then every E2E file with its owning Node runner: `vitest run src && node --test e2e/*.test.mjs`. No tests removed, skipped or weakened; no assertion changed. Existing Playwright was linked into ignored node_modules for the browser-host setup.

- RED: `VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 npm --prefix examples/reference-web run test` — 54 passed, 2 collection failures.
- After repair: `CHROMIUM_PATH=/usr/bin/chromium VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 npm --prefix examples/reference-web run test` — 54 Vitest tests and 2 real browser tests passed; 1 browser test failed because its default Playwright Chromium binary is absent. That test is unchanged and unskipped.
- `pnpm --filter @jini-app/reference-web run typecheck` — passed.
- Stable-tree `pnpm complexity` — passed, 0 errors and 211 warnings.
- `pnpm quality:knip` — exit 0, report-only findings retained; `pnpm quality:depcruise` — exit 0, report-only observations retained.
- `pnpm quality:sonar` — 111 warnings and 4 errors, including one parser/configuration issue; diagnosis pending.

BUG: Reference-web's default test command sent node:test browser suites to Vitest. Fixed by invoking both runners.
