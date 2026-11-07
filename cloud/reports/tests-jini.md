# tests-jini — completed with reported open checks

Executed all 45 workspace test commands, CI quality commands available in this environment, and additional real-Postgres contracts. Repaired the discovered test-runner, packaging, import-cycle, SQL, and fixture problems. Remaining failures and unavailable checks are explicit below; this is not an all-green report.

- Started 2026-11-06 11:48 PST; finished 2026-11-06 12:35 PST, within the two-hour cap. Raw logs use UTC.
- Jini: `cloud/tests-jini`, verified code SHA `e6e3b57d0ab13c18329cdc956599ece793a645ad`; base `3a41ec5b678e7445dce1f23d5fe08735cdd4e2b8` (`origin/cloud/combine`).
- Tovu: local `cloud/tests-jini`, unchanged at `b34b9cb7ada1783698eea8ec83bb3d6913fc63c4`. Links refreshed; no tracked Tovu changes or push.
- Instructions read with `git show origin/cloud-plans-1105:cloud/jobs/COMMON.md` and `git show origin/cloud-plans-1105:cloud/jobs/tests-jini.md`. Required AI-Dev-Shop personas loaded.
- All pushes target only Jini `cloud/tests-jini`; no force push, deployment, publish, or main push. Closing report commit follows the verified code SHA.
- Logs and scratch evidence: `/workspace/work/tests-jini/`. Dependencies use writable scratch caches/stores; obsolete setup plugin directories were preserved in scratch.

## Open results

1. Three existing infra-retirement assertions remain deliberately red: Tovu has 11 infra/outbox import reaches, its root manifest depends on infra, and the Jini infra workspace remains. The contract explicitly requires retaining it until the shim release and outbox ownership handoff are resolved. Assertions remain unchanged; no premature deletion or forbidden publish was attempted.
2. One reference-web browser test cannot launch the default Playwright Chromium headless-shell binary. The other two browser tests pass with installed system Chromium. The failing test remains unchanged and unskipped.
3. Semgrep application scanning cannot fetch the configured registry packs because the environment proxy denies `semgrep.dev` (HTTP CONNECT 403). Local rule regressions pass. No rules were removed to manufacture a scan.
4. Full-history Gitleaks reports 347 untriaged potential findings across 4,238 commits. Values were not inspected or included in this public report. The final change-range scan has no leaks.

## Full workspace run

Exact command for each row: `npm --prefix <workspace> run test`, from `/workspace/Jini`, after `source /workspace/.tovu-build/env.sh`. Environment: `VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 NO_COLOR=1`. Commands ran serially. Logs: `packages/<workspace-with-slashes-replaced-by-hyphens>.log` under the job log directory.

**These are the initial full-command results, not invented full reruns after each fix.** The recovery table records later full or focused evidence. Initial totals: 53,204 passed, 33 failed, four existing skipped; 40 commands passed and five failed. Reference-web also had two collection failures, rather than failing test assertions.

| Workspace | Passed | Failed | Existing skipped | Exit |
| --- | ---: | ---: | ---: | ---: |
| examples/minimal-host | 2 | 1 | 0 | 1 |
| examples/nlweb-demo | 18 | 0 | 0 | 0 |
| examples/reference-desktop | 4 | 0 | 0 | 0 |
| examples/reference-web | 54 | 0 | 0 | 1 |
| packages/admin | 2847 | 0 | 0 | 0 |
| packages/agent-plugins | 1583 | 0 | 0 | 0 |
| packages/agent-runtime | 4285 | 5 | 0 | 1 |
| packages/agentic | 1555 | 0 | 0 | 0 |
| packages/analytics | 197 | 0 | 0 | 0 |
| packages/artifacts | 204 | 0 | 0 | 0 |
| packages/capability-providers | 198 | 0 | 0 | 0 |
| packages/chat | 4227 | 0 | 1 | 0 |
| packages/cli | 575 | 0 | 0 | 0 |
| packages/cms | 3968 | 0 | 0 | 0 |
| packages/cms/forms | 157 | 0 | 0 | 0 |
| packages/commerce | 1468 | 0 | 1 | 0 |
| packages/cookie-consent | 174 | 0 | 0 | 0 |
| packages/core | 1857 | 0 | 0 | 0 |
| packages/daemon | 4042 | 10 | 1 | 1 |
| packages/db | 735 | 0 | 0 | 0 |
| packages/desktop-host | 688 | 0 | 1 | 0 |
| packages/devops | 1097 | 0 | 0 | 0 |
| packages/diagnostics | 956 | 0 | 0 | 0 |
| packages/http-kit | 579 | 0 | 0 | 0 |
| packages/infra | 144 | 0 | 0 | 0 |
| packages/integrations | 1981 | 0 | 0 | 0 |
| packages/mcp | 1559 | 0 | 0 | 0 |
| packages/memory | 332 | 0 | 0 | 0 |
| packages/oauth | 714 | 0 | 0 | 0 |
| packages/platform | 3074 | 0 | 0 | 0 |
| packages/plugin-catalog | 65 | 0 | 0 | 0 |
| packages/plugin-fixture-provider | 2 | 0 | 0 | 0 |
| packages/plugins | 776 | 0 | 0 | 0 |
| packages/protocol | 106 | 0 | 0 | 0 |
| packages/provider-plugins | 806 | 0 | 0 | 0 |
| packages/registry | 355 | 0 | 0 | 0 |
| packages/sandbox | 132 | 0 | 0 | 0 |
| packages/search | 320 | 0 | 0 | 0 |
| packages/server | 472 | 0 | 0 | 0 |
| packages/sidecar | 247 | 0 | 0 | 0 |
| packages/sqlite | 9 | 0 | 0 | 0 |
| packages/ui | 8893 | 17 | 0 | 1 |
| packages/ui-kit | 225 | 0 | 0 | 0 |
| packages/user-management | 1162 | 0 | 0 | 0 |
| packages/vibecoding | 360 | 0 | 0 | 0 |

Commerce initial phases: native catalog 52/0, React 10/0, kernel 1406/0 plus one Postgres placeholder skip. The actual Postgres contract was subsequently executed (55/0).

Default-command existing skips: private-transcript chat benchmark (no owner data accessed), live Claude Bash contract (no provider tokens used), macOS-only speech helper on Linux, and the commerce Postgres placeholder. Root scripts additionally report 32 existing digest-selection matrix omissions: two representative design plugins exercise that lifecycle branch; every plugin still executes its contents/seeding cases. No skip was added by this job.

## Recovery and additional suite results

All commands below inherit the same setup and worker limits. `npm_config_cache=/workspace/work/tests-jini/npm-cache` is set for packed-host/root-script runs. Postgres URLs name only disposable job databases on the local `/tmp` socket, port 5432; no live or owner data is used. Primary scratch databases were dropped after checks.

| Exact command / scope | Final passed | Failed | Notes |
| --- | ---: | ---: | --- |
| `npm --prefix examples/minimal-host run test` | 3 | 0 | Full retry with writable npm cache; real packed-tarball boot |
| `CHROMIUM_PATH=/usr/bin/chromium npm --prefix examples/reference-web run test` | 56 | 1 | 54 Vitest + 2 browser pass; missing default browser binary |
| `pnpm --filter @jini-ai/agent-runtime exec vitest run src/__tests__/integration/claude-temp-realpath.integration.test.ts` | 6 | 0 | Focused retry with sandbox write access to `/var/tmp`; resolves all five initial failures |
| `pnpm --filter @jini-ai/daemon exec vitest run src/agent-executor/__tests__/agent-executor-filesystem-policy.test.ts src/agent-executor/__tests__/agent-executor-read-only-dirs.test.ts` | 17 | 0 | Same `/var/tmp` permission; resolves all ten initial failures |
| `pnpm --filter @jini-ai/ui-kit run test` | 225 | 0 | Full package rerun after the final narrow cycle fix |
| `pnpm exec vitest run scripts/__tests__/leaf-import-closures.test.ts --maxWorkers=2 --minWorkers=1` | 7 | 0 | Actual source-closure cycle regressions |
| `pnpm test:scripts` — Vitest phase | 726 | 0 | 46 files; 32 existing matrix omissions |
| `pnpm test:scripts` — native phase (`test:scripts:node`) | 7 | 3 | Only the deliberate infra-retirement failures remain |
| `pnpm quality:properties` | 24 | 0 | Platform 10, chat 4, OAuth 5, CMS 5 |
| `pnpm test:agent-plugins:content` | 1406 | 0 | Includes the new packaging regression; zero skips |
| `TEST_DATABASE_URL=<job-db-url> COMMERCE_PG_URL=<job-db-url> pnpm --filter @jini-ai/db run test:postgres` | 27 | 0 | Full seven-file Postgres rerun |
| `JINI_CHAT_TEST_POSTGRES_URL=<job-chat-url> pnpm --filter @jini-ai/chat run test:postgres` | 53 | 0 | Full configured contract |
| `JINI_DAEMON_TEST_POSTGRES_URL=<job-daemon-url> pnpm --filter @jini-ai/daemon run test:postgres` | 8 | 0 | All fixture contracts retained |
| `COMMERCE_PG_URL=<job-commerce-url> pnpm --filter @jini-ai/commerce exec vitest run -c vitest.kernel.config.ts src/payments/ledger/__tests__/postgres.vitest.test.ts --maxWorkers=2 --minWorkers=1` | 55 | 0 | Real Postgres, including empty operations |

UI focused command from `packages/ui`: `pnpm exec vitest run src/features/mcp-ui/__tests__/surfaces/form.test.ts src/features/mcp-ui/__tests__/surfaces/outcome.test.ts src/features/mcp-ui/__tests__/secret-card.unit.test.ts src/features/mcp-ui/__tests__/surfaces/document.test.ts --maxWorkers=2 --minWorkers=1` — **173 passed, zero failed/skipped**, replacing the initial 17 stale-hash failures.

Commerce affected adapter command: `pnpm --filter @jini-ai/commerce exec vitest run -c vitest.kernel.config.ts src/payments/ledger/__tests__/postgres.vitest.test.ts src/payments/ledger/__tests__/sqlite.vitest.test.ts src/payments/ledger/__tests__/memory.vitest.test.ts src/payments/ledger/__tests__/empty-attempt-ops.vitest.test.ts --maxWorkers=2 --minWorkers=1` — **173/0** (Postgres 55, SQLite 58, memory 59, new no-read regression 1). Focused SQL coverage: 96.77% statements, 99.30% branches; no thresholds or exclusions changed.

DB helper/privacy command: `pnpm --filter @jini-ai/db exec vitest run src/__tests__/transfer/psql-target.test.ts src/__tests__/transfer/transfer-pg-test-db.test.ts src/transfer/__tests__/postgres-target.characterization.test.ts` — **28/0**. Daemon adjacent agent-session command: `pnpm --filter @jini-ai/daemon exec vitest run src/store/agent-sessions/__tests__ --maxWorkers=2 --minWorkers=1` — **44/0**.

## CI build, typecheck and quality gates

Security tools were selected with `PATH=/workspace/work/tests-jini/quality-security/bin:/workspace/work/tests-jini/quality-security/semgrep-venv/bin:$PATH`, `SEMGREP_SEND_METRICS=off`, and `SEMGREP_ENABLE_VERSION_CHECK=0`; Semgrep XDG config/cache paths were redirected under the same scratch directory. Gitleaks 8.28.0 matched CI SHA-256 `a65b5253807a68ac0cafa4414031fd740aeb55f54fb7e55f386acb52e6a840eb`.

| Exact command | Final result |
| --- | --- |
| `pnpm install --frozen-lockfile --store-dir /workspace/work/tests-jini/pnpm-store --cache-dir /workspace/work/tests-jini/pnpm-cache --fetch-retries=0` | Passed; dependency refresh from base |
| `pnpm -r build` | Passed again after the final source fixes (`build-after-fixes.log`) |
| `JINI_PACKAGES_DIR=/workspace/Jini/packages npm --prefix /workspace/Tovu run link:jini` | Passed after that build |
| `pnpm typecheck` | Passed again on the final code (`typecheck-final.log`) |
| `pnpm exec tsc -p scripts/tsconfig.json --noEmit` | Passed |
| `pnpm complexity` | Passed: 0 errors, 211 warnings |
| `pnpm guard:drift` | Passed: zero new/total violations; no baseline additions |
| `pnpm quality:sonar` | Passed execution: 3458 files, 176 warnings, 0 errors; directive-no-effect warnings are not parse failures |
| `pnpm quality:knip` | Exit 0, report-only findings retained |
| `pnpm quality:depcruise` | Exit 0: 72 warnings, zero errors; 7361 modules / 24932 dependencies |
| `python3 scripts/quality-semgrep.py --test` | Semgrep 1.175.0; 6/6 local rule regressions pass |
| `python3 scripts/quality-semgrep.py` | Unavailable: registry host denied by proxy; stopped retry wait, not a green scan |
| `gitleaks git . --config .gitleaks.toml --log-opts='origin/cloud/combine..HEAD --full-history -m' --redact --exit-code=1` | Gitleaks 8.28.0, CI checksum verified; final code range clean |
| `bash scripts/quality-secrets.sh --exit-code=1` | Exit 1: 347 untriaged historical potential findings; redacted |
| `git diff --check` | Passed |

Strict touched production complexity checks also passed: `pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/commerce/src/payments/ledger/repo.sql.ts packages/commerce/src/payments/ledger/__tests__/empty-attempt-ops.vitest.test.ts`. UI-kit strict check from `packages/ui-kit`: `pnpm exec eslint --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' src/react/native/Navigation.hooks.ts`.

Final Knip report categories: unused files 38, dependencies 9, devDependencies 17, referenced optional peers 103, unlisted dependencies 19, unlisted binaries 1, unresolved imports 15, unused exports 170, unused exported types 358, duplicate exports 26, configuration hints 534. These and the report-only lint/dependency warnings are observations, not silently fixed or claimed as confirmed runtime bugs.

## Changes and why tests changed

1. **Packaging:** moved bundled CMS from agent-plugin runtime dependencies to build dependencies, retaining the same link/version. Added a real bundled-reader isolation/validation test. RED 4/1 became GREEN 17/0 with adjacent forms tests; final complete content run 1406/0.
2. **Reference-web runner:** every src Vitest case and every browser node:test file now executes under its owning runner. No assertion or browser test changed.
3. **Standalone Sonar:** global `noInlineConfig` prevents copied directives from activating absent rules and authored suppressions from hiding selected policy findings. Rules, severities, thresholds, targets and ignores are unchanged. Two public-ESLint-API regressions went RED 0/2 to GREEN 2/0; generated paths must remain unignored.
4. **Root scripts runner:** routed the sync node:test file to the existing native command. No test disappeared; its one case passes.
5. **UI exact-output fixtures:** approved commit `1e4b1d4ba` added four coarse-pointer CSS lines for 44px controls. A scratch-only historical transform subtracting exactly that addition made every old hash pass (137/0), proving the fixtures were stale. Updated 15 unique SHA-256 expectations covering 17 cases across form/outcome/secret-card tests. Retained every equality and semantic assertion and the why comments; current source plus document semantics passes 173/0. No renderer/security source changed.
6. **UI-kit cycle:** NativeMenu now reads its existing context leaf with identical provider/body/server fallback, avoiding the facade/default-native-assembly cycle. Public hooks and context files remain unchanged. A broader discarded candidate had timing-sensitive guard-conformance failures; the final one-file fix passes all 225 cases without test or timeout edits.
7. **DB constraints:** safe-error change `c5fded4b45c7af5ac4623ec6c50645dfe05753e7` intentionally hid server text. The outdated `/violates/` test now uses the existing pg driver to assert exact SQLSTATE 23503/23505 and complete unchanged rows. Fixture-only mutation probes dropping the FK or unique index each fail the corresponding assertion. Production redaction and transfer helpers remain unchanged.
8. **Daemon PG fixture:** startup search_path consistently scopes every dedicated pool connection and raw fixture SQL, preserving all eight contracts. No production schema/migration change.
9. **Commerce SQL:** empty operations return the existing empty-selection semantics before reading, avoiding invalid Postgres `IN ()`. Existing contract reproduced 54/1; new no-read regression also failed before the guard. All nonempty cursor/scope/limit behavior remains unchanged.

## Bugs found

- FIXED: Bundled CMS incorrectly remained an agent-plugin runtime dependency and violated the layer gate.
- FIXED: Reference-web sent native browser tests to Vitest.
- FIXED: Copied inline lint directives activated unavailable rules in standalone Sonar.
- FIXED: Authored inline suppressions could hide findings selected by standalone Sonar.
- FIXED: Root scripts sent the native sync suite to Vitest.
- FIXED: Exact-output fixtures omitted the approved 44px coarse-pointer CSS addition.
- FIXED: NativeMenu imported through the kit facade and introduced an assembly cycle.
- FIXED: Transfer constraint assertions expected server text intentionally hidden by safe-error redaction.
- FIXED: Daemon real-PG fixtures scoped builders but not raw SQL/every pool connection.
- FIXED: Empty operation selections generated invalid Postgres SQL instead of returning no attempts.
- OPEN: Infra-retirement acceptance state is intentionally incomplete pending its release/outbox handoff.

## Integrity and handoff

Architecture audit: PASS for changed code. Existing ports, public signatures, layer rules and schema remain intact. No new abstraction, framework, production table, runtime option, vendor dependency, poll or production write was added. The empty-operation path removes one read (frequency of empty selections × prior query/row payload); the menu context lookup adds no I/O. Changed function assessments: menu lookup O(1), existing menu item mapping O(n); ledger empty path O(1), nonempty path remains one bounded query plus O(n) row decoding. Strict complexity checks pass.

No test, assertion, rule, threshold or check was deleted, weakened or disabled; no debt baseline or eslint-disable directive was added. Directive strings inside the new policy regressions are hostile fixture inputs, not active suppressions. Native-runner files remain executed rather than skipped. Historical/source mutation probes were scratch-only and restored. Fresh evidence, scope review and diff checks completed; source code is at the verified SHA above. Full suites were not repeated gratuitously: failures were repaired with focused evidence, and affected root/PG commands were then rerun in full.

Pushed code/checkpoint commits on `cloud/tests-jini`: `e7667d16d`, `76ffad62a`, `c5bb2ff53`, `f5aa3f128`, `fcfb99607`, `daa877107`, `e6e3b57d0`. The final report-only commit closes this branch. Next work is the explicit infra retirement/release handoff, provisioning the missing browser/allowed Semgrep registry access, and separate review of historical secret-scan findings.
