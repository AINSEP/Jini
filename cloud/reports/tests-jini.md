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

## Fix 3 — Standalone Sonar policy ownership

Copied inline lint directives in generated provider payloads activated unavailable TypeScript rules, producing four configuration errors. Authored inline suppressions could also hide enabled Sonar findings. Added global `noInlineConfig: true` to the standalone entrypoint. Rules, severities, thresholds, source targets and ignores are unchanged; source findings can no longer be hidden with inline suppressions. No runtime code changed.

Two public-ESLint-API regressions verify that generated payloads remain unignored and copied directives cannot produce unknown-rule errors, and that authored inline suppression cannot hide an identical-expression finding.

- RED against original config: `VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 pnpm exec vitest run scripts/__tests__/sonar-standalone-config.test.ts --maxWorkers=2 --minWorkers=1` — 0 passed, 2 failed.
- GREEN with policy fix: same command — 2 passed, 0 failed, 0 skipped.
- `pnpm exec eslint development/quality/eslint.sonar.config.mjs scripts/__tests__/sonar-standalone-config.test.ts` — passed.
- `pnpm exec tsc --noEmit --module ESNext --moduleResolution Bundler --target ES2022 --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck scripts/__tests__/sonar-standalone-config.test.ts` — passed.
- Full `pnpm quality:sonar` rerun in progress.

BUG: Copied inline lint directives in generated payloads could make standalone Sonar activate unavailable rules. Fixed.
BUG: Authored inline suppressions could hide findings enabled by the standalone Sonar policy. Fixed.

## Checkpoint 2

- `pnpm guard:drift` now passes: zero new or total violations, no baseline additions.
- Agent-runtime initial run: 4285 passed, 5 failed only because the sandbox did not allow `/var/tmp`. Focused retry with temporary-directory write access: `VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 pnpm --filter @jini-ai/agent-runtime exec vitest run src/__tests__/integration/claude-temp-realpath.integration.test.ts` — 6 passed, 0 failed. No test changed.
- Chat: 4227 passed, 0 failed, 1 existing skipped private-transcript benchmark (`JINI_CHAT_LONG_TRANSCRIPT` unavailable; no owner data used).
- CMS: 3968 passed, 0 failed. Forms compatibility suite passed. Commerce running.

## Fix 4 — Root scripts test runner

The sync-software-engineering suite uses node:test but was collected by Vitest. Added that exact file to the existing `test:scripts:node` command and routed it out of Vitest to that owning runner. Every assertion is retained and executed; no suite is skipped. The other two native suites retain their ownership.

- RED: isolated Vitest execution of `scripts/__tests__/sync-software-engineering.test.mjs` fails with `No test suite found` although its Node assertion passes.
- `pnpm test:scripts:node` — 7 passed, 3 failed, 0 skipped. Subsets: hardwiring 3/0; infra retirement 3/3; sync 1/0.
- Focused Vitest discovery confirms this native file is routed out; script inventory confirms all three native suites occur in the Node command.
- `pnpm exec eslint vitest.config.ts` and focused strict TypeScript config check — passed.

BUG: The root scripts command sent the node:test sync suite to Vitest instead of its owning runner. Fixed.
OPEN: Infra retirement remains deliberately incomplete: Tovu has 11 infra/outbox import reaches, its manifest still depends on infra, and the infra workspace still exists. The existing test explicitly requires retaining infra until its shim-release and outbox-ownership gates are resolved. All three failing assertions remain intact; no package deletion or publish was attempted.

## Checkpoint 3

- Final standalone Sonar rerun: 3458 files, 176 warnings, 0 errors. Directive-no-effect diagnostics are warnings, not parse errors. Rules/targets/ignores unchanged.
- Daemon initial 4042 passed, 10 failed, 1 existing skipped live-CLI contract. Its two failing temporary-directory files pass unchanged with `/var/tmp` access: 17 passed, 0 failed.
- Database 735 passed, 0 failed. Commerce default phases: 52 native catalog + 10 React + 1406 kernel passed, 1 existing Postgres placeholder skipped without its URL. Real-Postgres execution pending.

## Fix 5 — Stale exact-output fixtures for touch targets

Approved commit `1e4b1d4ba` added four shared CSS lines giving controls 44px targets for coarse pointers, without refreshing the form/outcome/secret-card exact-output fixtures. Historical scratch proof removed only those exact four CSS lines and made all 137 tests pass with every old hash unchanged. Current renderer/security sources were not changed.

Updated 15 unique expected SHA-256 digests covering 17 failing cases, and retained the existing why comments with the touch-target change documented. Every hash equality, semantic assertion and case remains intact; no snapshot update mode or weakened assertion was used. The existing shared-document touch-target semantics also pass against current source.

Commands from `packages/ui`, after sourcing the setup env:

- RED: the three affected surface files — 120 passed, 17 failed.
- Historical scratch transform: the same 137 cases — 137 passed using old expected hashes and only the historical CSS addition subtracted in scratch.
- GREEN: `VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 pnpm exec vitest run src/features/mcp-ui/__tests__/surfaces/form.test.ts src/features/mcp-ui/__tests__/surfaces/outcome.test.ts src/features/mcp-ui/__tests__/secret-card.unit.test.ts src/features/mcp-ui/__tests__/surfaces/document.test.ts --maxWorkers=2 --minWorkers=1` — 173 passed, 0 failed, 0 skipped.
- `pnpm run typecheck` — passed; focused ESLint and `git diff --check` passed.

BUG: Exact-output fixtures omitted the approved shared 44px coarse-pointer CSS addition. Fixed with proven same-strength expected-byte updates.

## Workspace run complete; additional checks in progress

All 45 workspace commands finished. Initial evidence: 53204 passed, 33 failed, 4 existing skipped; 40 commands passed and 5 failed. Reference-web additionally had two initial collection failures, rather than failing test cases. The recovered failures and focused retry evidence are documented above; these initial counts do not include retries.

The extra serial checks now cover writable-cache packed-host recovery, root scripts, CI property tests, real Postgres for DB/chat/daemon/commerce, final plugin content, rebuild/relink, touched scripts typecheck, complexity and guard. No new production state, I/O, polling, options, tables or abstractions were added by the job.
