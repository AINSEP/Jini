# ci-errors — completed

Started 2026-11-06 16:41 UTC. Completed 2026-11-06 17:22 UTC, within the two-hour cap (deadline 18:41 UTC). Work is on `cloud/ci-errors` in both repositories. No main/force pushes, deployment or package publishing.

## Bases and existing work

- Jini base: `f07ae3d6ff55cf4da480acac44cc6f4b7686966b` (`origin/cloud/combine`).
- Tovu base: `74fedc1320d31431ab4a13d1e38af03a402ca28b` (`origin/cloud/combine`).
- The earlier GA fixes are already present: ESLint parser/generated-payload configuration, original neutrality enforcement, model fallback paths, the chat recovery type export, environment/forms dependency injection, MCP adapter boundaries, and the historical Cloudflare receiver correction. They were retained.
- The earlier error job is already present: approved vocabulary and request wording, safe correlated helper defaults, one shared ErrorNotice beside ServerRestartingBanner, anonymous disclosure limits, analytics/forms/uncaught exception handling, recovery/publishing phase wording, and run-start/update/model-stream explanations. The trimmed preview/auth/download/inline-notice exclusions were retained.

## Changes

- Corrected remaining guard failures: readonly lookup contracts, public/extensionful test imports, an explicit chat test dependency, isolated fallback kit state, and instance-owned document-read admission. The default reader still admits two concurrent reads process-wide and releases admission after failure.
- Reused the existing shared commerce Money owner; moved existing strict input readers into commerce core with the old path retained as a re-export. Documented the two optional packaged-payload peers without permitting upward imports from agent-plugins TypeScript runtime. Added negative boundary regressions. Removed an obsolete debt entry; no guard floor/baseline was broadened.
- Corrected ESLint's generated-report exclusion so authored devops coverage tooling is checked.
- Fixed Semgrep's callback blind spot. The enclosing promise return competed with the callback's return/throw as the selected sink; the OSS engine does not propagate callback return taint into that promise. Callback sinks now own those findings. All original unsafe/safe fixtures remain; added concise-callback and logging checks. Fixture cases increased from 8 unsafe/6 safe to 13 unsafe/8 safe. Final review also found that the first repair missed tainted fulfilled promise receivers. Two new fixtures reproduced that regression; a separate receiver-focused sink restored detection while retaining callback and chained-callback detection. A sanitized fulfilled-value negative also passes.
- Replaced higher-hit whole-report selection with LCOV line/branch/function entry unions. Duplicate artifacts are idempotent; input is not mutated. Function declaration identity includes spans/names and supports optional end lines and reordered unique FNDA entries. Summary-only or ambiguous/incompatible duplicate artifacts fail explicitly instead of inventing a union.
- Added whole-admin runtime coverage scope and 98% floors on all four axes, following the current test-design policy. No existing floor was lowered and no runtime source was excluded.
- Fixed the one remaining shared-error gap: default GET requests (for example `api.listPages()`) now receive read wording rather than uncertain-mutation wording. The new regression first failed with 12 existing cases passing; the final direct file has 13 passing cases.

## Validation

Commands below use `source /workspace/.tovu-build/env.sh` first. The final source rebuild and relink passed; targeted checks and touched-package compilers passed.

### Setup

- `pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store --config.confirmModulesPurge=false` (Jini): PASS. The default cache was read-only; a previous store-change attempt required the noninteractive purge setting. These were setup failures, not source failures.
- `pnpm --no-bail -r build` (Jini): PASS on the unmodified base and again after all source changes.
- `npm --prefix packages/contracts run build` (Tovu): PASS.
- `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` (Tovu): PASS. Repeated after the base build. Repeated after the final source build; PASS.

### Error behavior

Jini:
```sh
npm --prefix packages/core test -- src/user-facing-error.test.ts src/request-failure.test.ts
npm --prefix packages/ui test -- src/features/panel-kit/__tests__/failure-channel.test.ts src/features/panel-kit/__tests__/ErrorNotice.test.tsx
npm --prefix packages/daemon test -- --minWorkers=1 --maxWorkers=2 src/http/__tests__/runs.test.ts src/http/__tests__/model-proxy.test.ts src/http/__tests__/model-proxy-fields.test.ts
```
PASS: 15 core, 7 UI, 425 daemon tests. Daemon tests require the supported network permission for loopback HTTP. The original sandboxed run stalled; the first worker-limited attempt had a min/max worker configuration conflict. The final corrected command exited 0.

Tovu:
```sh
npm --prefix apps/admin test -- --maxWorkers=2 src/lib/__tests__/admin-failure-channel.unit.test.ts src/components/__tests__/AdminFailureNotice.unit.test.tsx src/__tests__/unit/app-session-failure-reset.unit.test.tsx src/lib/__tests__/api-user-facing-fallback.unit.test.ts src/lib/__tests__/api-request-unreachable.unit.test.ts src/lib/__tests__/server-reconnect.unit.test.ts
npm --prefix apps/admin run typecheck
npx eslint apps/admin/src/lib/api.ts apps/admin/src/lib/admin-failure-channel.ts apps/admin/src/lib/__tests__/admin-failure-channel.unit.test.ts
```
PASS: 53 admin tests, admin tsc, lint with 0 errors and 4 existing api.ts warnings. After the final Jini rebuild/relink, repeated the same six admin files plus `__tests__/vitest-coverage-config.unit.test.ts`: PASS 54/54 across seven files. The initial test attempt failed import resolution until contracts were rebuilt. The initial implementation exceeded the host's complexity ceiling; resolving the HTTP method once at its request boundary passed the effective lint gate.

```sh
TOVU_DB=memory node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-force-exit --test-isolation=none --test-concurrency=1 apps/website/src/server/inbound/admin-http/routes/system/__tests__/user-facing-failure.test.ts apps/website/src/server/inbound/shared/__tests__/unexpected-admin-escape-paths.unit.test.ts apps/website/src/server/inbound/shared/__tests__/publishing-failure-copy.unit.test.ts apps/website/src/server/inbound/shared/__tests__/publishing-peer-failure-context.unit.test.ts apps/website/src/server/inbound/admin-http/http/__tests__/ranked-user-facing-errors.test.ts apps/website/src/server/inbound/admin-http/__tests__/admin-failure-copy.test.ts
```
PASS: 32 tests, including anonymous secret canaries and correlated IDs. The first run without loopback network permission failed the peer file; its isolated corrected run passed 8/8, then the full focused command above passed 32/32.

### Coverage

All from Jini:
```sh
pnpm --filter @jini-ai/devops exec vitest run src/checks/coverage/__tests__ --coverage --coverage.include=src/checks/coverage/lcov.ts --coverage.reportsDirectory=/workspace/work/ci-errors/lcov-coverage
pnpm --filter @jini-ai/devops run typecheck
pnpm exec eslint --no-ignore --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/devops/src/checks/coverage/lcov.ts
```
PASS: 138 tests across three affected files, devops tsc, strict complexity lint. Direct coverage.test.ts grew from 42 baseline tests to 53. Existing winner-selection characterization became an explicit summary-only refusal because selection contradicts the requested union. An initial duplicate-name success fixture was corrected once review showed classic FNDA lacks location identity; unique names now union independently of order and duplicate names have explicit refusal tests. No assertion was weakened to make coverage pass.

Tovu:
```sh
npm --prefix apps/admin run test -- __tests__/vitest-coverage-config.unit.test.ts
npx eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/admin/vitest.config.ts apps/admin/__tests__/vitest-coverage-config.unit.test.ts
npm --prefix apps/admin run test:cov -- __tests__/vitest-coverage-config.unit.test.ts --coverage.reportsDirectory=/workspace/work/ci-errors/admin-scope-coverage --coverage.reporter=json-summary --coverage.reporter=lcov
```
Config test and lint PASS; the scope probe has expected exit 1 (1/1 test passes, all four 98% floors reject0%). It retained886 runtime files:19,724 lines/23,907 statements/8,591 functions/16,204 branches. Full-suite attainment remains unmeasured.

Current result: 138 affected Jini coverage tests pass; devops typecheck and strict complexity <=10 pass. lcov.ts statements/lines/functions: 100%; branches: 96.66%, above unchanged package floors. The only uncovered branches belong to unchanged path/source classification helpers.

Admin config regression: PASS 1/1; tsc/lint PASS. A one-test coverage scope probe deliberately failed the 98% gate, retaining 886 unloaded runtime files at 0%. This proves denominator enforcement; it is not a full-suite coverage measurement. Full admin coverage attainment was not measured because this job explicitly permits only affected tests.

### Semgrep and CI

The historical failed run for `7c7552493` is [42187862409](https://github.com/AINSEP/Jini/actions/runs/42187862409). Its public quality-gates annotation identifies guard drift. Local guard reproduction found current source violations plus stale untracked checkout directories; those directories were moved outside packages, reversibly, without committing them. The full GitHub API log endpoint is unavailable here; current failures were reproduced locally.

Pinned Semgrep 1.175.0:
```sh
PATH=/workspace/work/ci-errors-semgrep/bin:$PATH SEMGREP_LOG_FILE=/workspace/work/ci-errors-semg-user.log SEMGREP_SETTINGS_FILE=/workspace/work/ci-errors-semgrep-settings.yml pnpm quality:semgrep:test
SEMGREP_LOG_FILE=/workspace/work/ci-errors-local-scan-user.log SEMGREP_SETTINGS_FILE=/workspace/work/ci-errors-semgrep-settings.yml /workspace/work/ci-errors-semgrep/bin/semgrep scan --config .semgrep --baseline-commit f07ae3d6ff55cf4da480acac44cc6f4b7686966b --metrics=off --disable-version-check --oss-only --strict --json .
```
PASS: all six rule suites; local differential scan 6 rules/19 files, 0 findings, 0 analysis errors. Initial source/option experiments did not repair the callback issue; they were discarded. The successful fix addressed sink ownership and retained every fixture.

`pnpm quality:semgrep --baseline-commit f07ae3d6ff55cf4da480acac44cc6f4b7686966b`: BLOCKED/exit 2 because this environment rejects `semgrep.dev/c/p/typescript` with proxy 403. No network policy was bypassed; local rules and blocking fixture checks were verified separately. Final source checkpoint `a8ad8686d645d6f888c895a46618ab8c7d03d253` passed [GitHub run 42259553378](https://github.com/AINSEP/Jini/actions/runs/42259553378): quality-gates SUCCESS at 17:21:16 UTC and Semgrep SUCCESS at 17:16:05 UTC. Build, guard, full typecheck, plugin-content tests, complexity and the blocking Semgrep regressions all passed. Existing report-only SonarJS and application-scan exit 1 annotations remain; no scan policy was relaxed. The report closeout after this checkpoint changes only these Markdown reports, so no additional source validation run is claimed for that documentation-only commit.

### Remaining CI fixes: exact commands

`node --test --test-isolation=none packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver.test.mjs`: PASS: 18/18 on the unchanged base receiver; no historical Cloudflare repair remains.

All commands run from /workspace/Jini after `source /workspace/.tovu-build/env.sh`.

- `pnpm --filter @jini-ai/ui exec vitest run src/features/site-card/__tests__ --maxWorkers=1 --minWorkers=1`: PASS: 31 tests.
- `pnpm --filter @jini-ai/chat exec vitest run src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.agent-handles.test.tsx --maxWorkers=1 --minWorkers=1`: PASS: 5. Initial public-import run exposed missing ui-kit dependency; declared/linked it and the final run passes.
- `pnpm --filter @jini-ai/ui-kit exec vitest run src/react/__tests__/provider-edges.test.ts src/react/__tests__/confirm.test.ts --maxWorkers=1 --minWorkers=1`: PASS: 24. New isolation test RED before fix; provider suite10->11, confirm13 unchanged.
- `pnpm --filter @jini-ai/cms exec vitest run src/media/__tests__/unit/document-text.unit.test.ts src/media/__tests__/documents.test.ts --maxWorkers=1 --minWorkers=1`: PASS: 19. Factory regression RED before implementation. Text suite5->7, documents12 unchanged. Covers fixed cap, independent explicit instance, success and failure slot release.
- `pnpm --filter @jini-ai/commerce exec vitest run -c vitest.kernel.config.ts src/payments/tools/__tests__ src/catalog/__tests__/unit/catalog-tools.vitest.test.ts src/money/__tests__ --maxWorkers=1 --minWorkers=1`: PASS: 176 across9 files, no tests deleted.
- `pnpm exec vitest run scripts/__tests__/check-package-layers.test.ts --maxWorkers=1 --minWorkers=1`: PASS: 73 (66->73). New peer tests RED before fix; upward src imports, direct dependencies and required peers remain forbidden.
- `pnpm exec vitest run scripts/__tests__/coupling-isolation.test.ts -t 'commerce shared value and input owners' --maxWorkers=1 --minWorkers=1`: PASS: 1 affected regression. Other20 tests intentionally not selected. Two initial entire-file attempts stalled in unrelated live checks and were terminated, with no full-file pass claim.
- `pnpm exec vitest run development/quality/eslint-uninstalled-rules.test.mts --maxWorkers=1 --minWorkers=1`: PASS: 3 (2->3), new authored-coverage scope test RED before fix.
- `pnpm --filter @jini-ai/cms --filter @jini-ai/commerce --filter @jini-ai/ui-kit run build`: PASS.
- `pnpm exec tsc -p scripts/tsconfig.json --noEmit --pretty false`: PASS after final source changes.
- `pnpm guard:drift` (network-enabled execution permits tsx IPC/live model discovery): PASS: 0 new violations,0total. Default sandbox attempt failed on tsx IPC EPERM; execution permissions, no code change, fixed that setup issue.
- `pnpm exec eslint scripts/check-package-layers.ts packages/cms/src/forms/stale-form.ts packages/cms/src/media/document-read.ts packages/commerce/src/catalog-tools.ts packages/commerce/src/core/tool-input.ts packages/commerce/src/payments/tools/input.ts packages/commerce/src/payments/tools/catalog.ts packages/commerce/src/payments/tools/resolve-unknown.ts packages/ui-kit/src/react/Kit.hooks.ts --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'`: PASS: 0 errors,1 existing duplicate-string warning in payments tool catalog. Initial strict check found complexity11 in existing isDocumentOnlyBlob and new payload-peer helper; pure predicates extracted without changing decisions.
- `pnpm --filter @jini-ai/cms --filter @jini-ai/commerce --filter @jini-ai/ui-kit --filter @jini-ai/ui --filter @jini-ai/chat run typecheck`: PASS all five.
- `pnpm complexity`: PASS exit0,0 errors/216 warnings. No rule disabled or threshold lowered.


### Chromium

`node /workspace/work/ci-errors-display/verify.cjs` and `node /workspace/work/ci-errors-display/verify-430-stable.cjs`: PASS with Chromium 155.0.8059.79, synthetic intercepted replies only. Viewports 320, 360, 390, 430, 844 landscape and 1440. Secret canary absent, incident retained, details/copy/feedback/dismiss work, login remains, zero page exceptions. A controlled 430px rerun removed concurrent HMR console artifacts. Blocked Google Fonts and intentionally synthetic 401/500 resource errors were observed. Screenshots remain local and do not contain live data. No visual redesign was made; styling review remains a separate follow-up as specified by the job.

## Bugs found

- FIXED: Default GET admin failures used mutation-style fallback wording.
- FIXED: Semgrep missed unsafe rejection-callback constructor, alias/object and String echoes.
- FIXED DURING REVIEW: The first Semgrep repair missed tainted fulfilled promise receiver values. Receiver-focused return detection now covers direct and aliased values, and preserves sanitized/chained callback cases.
- FIXED: LCOV higher-hit selection discarded complementary coverage.
- FIXED: Admin coverage lacked explicit runtime scope and floors.
- FIXED: Optional FN end-line and declaration/order ambiguity were discovered while implementing the union and now have regressions.
- FIXED: Authored coverage tooling was accidentally excluded by ESLint's generated-report glob.
- FIXED: New source guard violations in imports, mutable lookup declarations, fallback kit state, document-read ownership and commerce/package metadata.
- FIXED DURING VALIDATION: Missing chat test dependency and over-ceiling reader/peer-helper complexity; all final checks pass.
- OPEN/MINOR: Existing 320px login/recovery cards cause 352px document width; the shared notice itself fits 320px. Listed, not fixed.
- OPEN/MINOR: The pre-existing awaited callback form `return await promise.catch(error => { throw new Error(error.message); })` is missed by the scanner before and after this repair. A pinned direct probe reproduced both versions missing it; no runtime leak was observed. Listed rather than expanded into another rule repair, as the job instructs for minor findings.
- OPEN/CI: GitHub report-only SonarJS and Semgrep application scan have exit 1 annotations under their existing policy; blocking checks and both overall jobs pass. No scan policy was relaxed. Existing warning/deprecation annotations remain informational.
- OPEN/MINOR: Three existing super-linear-regex warnings in coverage classifiers, four existing api.ts Sonar warnings, and one existing catalog duplicate-string warning. Root complexity reports216 warnings/0 errors. Listed, not fixed.

## Architecture, scope and cost

Generic runtime/tooling logic remains in Jini; Tovu contains request wiring and coverage configuration only. Shared ErrorNotice and existing ports are reused. Existing inline notices, anonymous disclosure limits, response contracts, retry counts and process-wide document admission are retained. No schema, dependency framework, scheduled task, deployment or publishing was added. No tests/rules were disabled, skipped, deleted or weakened; no coverage floor was lowered. Existing obsolete characterization expectations were replaced only where the required union behavior superseded report selection, with explicit negative evidence for ambiguous inputs.

Changed-unit review: request method resolution, LCOV entry parsing/union, kit ownership, reader admission and payload-peer predicates have direct positive/negative evidence. Aggregate probes cover complementary/repeated reports, altered layouts, function order/ambiguity, two pending readers plus third refusal and failure recovery, kit-consumer isolation, and optional payload declarations alongside forbidden upward imports. The receiver-focused Semgrep repair was independently reviewed with chained throws, String conversion and alias/object callbacks. No further introduced regression was found; the pre-existing awaited-callback gap is listed above. Architecture audit: PASS.

Added production network/database reads, writes and polls: 0. Error method resolution is O(1); offline LCOV unions retain O(entries) maps. Runtime state is owned by kit consumers/reader instances; the existing default reader retains its process lifetime and two-read limit.

## Pushed source history

All commits below belong only to `cloud/ci-errors`. The final report commit is identified in the final response.

### Jini

- `1333b02e9c00652e5e201eccc368eb4bf72f051c` — docs: record CI and error verification progress
- `b6b7e9b7d503ceb07a43064553743aebd39ade54` — fix: union matching coverage report entries
- `2d465f23bb5a4cc26b2bb1d50dacf7f7937f425c` — fix: declare immutable lookups and use public test imports
- `de62de86ce149d901dcb9ee83f2025caf1323e95` — fix: retain function identities in extended LCOV declarations
- `0c1cc900ea642abfcf9f1dea023dbc2a51b20daf` — fix: isolate fallback kit state and declare test dependency
- `b55d0af115bd08b1a7f967947022d50d6b9ce47d` — fix: retain locked workspace dependency for chat tests
- `24baa3e598c42c2f603996dfcb1382b6598c5945` — fix: own document read admission in a stable reader instance
- `6903e747630299ed163f3493989f85876e1ecd62` — fix(semgrep): scope promise rejection sinks to their callbacks
- `0b52d9214f56e70f17f183d7aa7c32dbd07f85e4` — fix: align shared commerce contracts and packaged peer boundaries
- `f648290a6ea6e46bcb3b2035588078e1fa1e070a` — fix: lint authored coverage checks alongside other source
- `a94c6ba813ab86cab73536ffe6f9c9a958f02ac8` — fix: validate function declaration identities before coverage union
- `1342a24c8df120202a7d06528c393e004a1ab61e` — fix: bound source complexity and retain reader failure recovery
- `ed6ce2efae278f0d1ddd9fe5059be936ea54e81d` — docs: clarify shared document reader lifetime
- `8dfb336cbf1c0d7c4f4ae95df149c914f7c9a4c9` — docs: record verified CI and error checks
- `34cbff54eb12a19733543d8fd90f918f86358acc` — fix(semgrep): retain tainted fulfilled promise returns
- `a8ad8686d645d6f888c895a46618ab8c7d03d253` — docs: record fulfilled promise regression coverage

### Tovu

- `7a7a6b5c850356800d72450c62a97f41f8a6bfa7` — docs: record CI and error verification progress
- `7ce3d77a361403df7b637ca31a615addf7c7eac6` — fix(admin): describe default GET failures as reads
- `9eef40716ef7a4099d4aa3e0ba2c010512bc9d02` — refactor(admin): resolve the request method at its HTTP boundary
- `afc6e0e723de294a0c8fb51e74837a671981168d` — refactor(admin): reuse the resolved HTTP method
- `8853ca970eed691c4e82424bcea7d891326b5818` — test: define admin coverage scope and minimums
- `0234aab3e41078a39eb22266bf6f9e56c6bd6122` — docs: record verified CI and error checks
- `9100feb0b28c3ec597dc517ad3f21548834064e5` — docs: record fulfilled promise regression coverage
