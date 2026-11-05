# ci — partial completion (2026-11-05)

Jini's build, source guard, focused regressions, and touched-package typechecks pass. CI is **not green**: the pinned Semgrep rule still misses rejection-callback flows. The repair stopped under COMMON.md's repeated-failure rule; all original fixtures and enforcement remain intact. Tovu also has one unrelated type error in unchanged publish-credentials code.

## Branches and pushed code commits

Only `cloud/ci` was pushed in each repository. No force pushes, deployments, publishing, or main pushes occurred.

Jini base: `6f507852d` (the pinned base in COMMON.md; origin/integ/night-1105 had moved ahead).

- `a35259ef34e32e6215788be837e97d22caac5989` — lint configuration and guard metadata/environment repairs.
- `c34dd1188c8cbcfe648041a6563689414a25b6db` — inject forms cleanup grace and shared hash lock.
- `d76b91f21a8e7f2b499d87f4a70df383c43b5cbe` — MCP adapter boundary and security-header regression.
- `fe4dec4f88d4f374a6035ddf6fa848efd5aaffdc` — callback failure reproductions and cleanup serialization regression.

Tovu base: `e327c07c8`.

- `f6aa38c4d855c9469e9e19094f1183d3f0631af0` — compose the existing media grace and shared lock into cleanup.

This report is committed after the code commits above; its own commit is discoverable from branch history.

## Changes

- Removed duplicate ESLint neutrality policy, restoring the existing parser for legacy React directives. Ignored generated `packages/provider-plugins/plugins/**` payloads while retaining authored provider source linting.
- Expanded lint regression coverage to the actual hook directive, markdown renderer, generated scope, and authored Sonar diagnostics. Retained the source-neutrality guard and added lower/mixed-case HTTP security-header fixtures alongside existing uppercase specification-ID refusals.
- Moved stale namespace exceptions to the shared identity resolver, preserving the compatibility reason; corrected both Antigravity source paths; explicitly exported SurfaceRecoveryInfo.
- Injected the native runtime probe environment through the existing options seam while retaining ambient defaults and caller immutability.
- Renamed the MCP HTTP implementation to `.adapter.ts`, preserving public barrel exports, and reused the existing protocol adapter for CallToolResult.
- Removed forms-to-media implementation imports. Tovu injects DEFAULT_GC_GRACE_MS and the existing withSha256Lock instance; cleanup still rechecks ownership inside that lock before deleting bytes and metadata. Tests cover host-supplied delay, lock ownership, and an upload/cleanup race.
- Added six Semgrep callback fixtures; the rule YAML is unchanged because no attempted repair satisfied the pinned scanner and existing safety cases.
- Cloudflare receiver behavior already passes all 18 tests; no speculative receiver change was made.

Reuse: existing source-neutrality guard, media grace constant, shared hash lock, and MCP protocol adapter. No new abstraction, database schema, service, poll, or production I/O was added. Cleanup job frequency and payload stay unchanged: added reads/writes/polls = 0 × 0 bytes.

## Setup

Read COMMON.md and ci.md via git show on origin/cloud-plans-1105, followed by TRIM.md GA and GA-plan-result.md. Loaded Software Architect, Programmer, and TDD personas from the archived plans-branch toolkit. The named `/workspace/shared` setup scripts were absent; used the preinstalled equivalents:

```bash
source /workspace/.tovu-build/env.sh
/workspace/.tovu-build/start-postgres.sh
pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store --config.confirmModulesPurge=false
```

Node 24.22.1, pnpm 10.33.2. The writable local store avoids the read-only preinstalled store. Obsolete, untracked generated package directories with no package.json were moved out of packages into `/workspace/work/ci`; no tracked package was removed. An initial broad lint run overlapped a generated plugin version replacement and hit ENOENT; final lint runs against stable build output.

## Validation

Commands below use `source /workspace/.tovu-build/env.sh`. HTTP wire tests were run with network-enabled execution so binding a local listener is permitted. Only focused/affected tests ran, per COMMON.md; full test suites remain the release/integration run's responsibility.

Jini, from `/workspace/Jini`:

```bash
pnpm -r run build
# PASS, including all workspace/example builds.

pnpm exec vitest run development/quality/eslint-uninstalled-rules.test.mts scripts/__tests__/check-model-fallback-freshness.test.ts scripts/__tests__/check-subpath-isolation.test.ts --maxWorkers=1 --minWorkers=1
# PASS: 36 tests.

pnpm exec vitest run scripts/__tests__/check-model-fallback-freshness.test.ts scripts/__tests__/check-subpath-isolation.test.ts packages/devops/src/local-dev/__tests__/node-runtime.test.ts packages/agent-plugins/src/lifecycle/__tests__/unit/manifest-default-namespace.unit.test.ts packages/plugins/src/host/__tests__/unit/plugin-format.unit.test.ts --maxWorkers=1 --minWorkers=1
# PASS: 56 tests, including preserved namespace/plugin-format compatibility.

pnpm --filter @jini-ai/mcp exec vitest run src/server/__tests__/http-tool-server.wire.test.ts src/server/__tests__/tool-result-pages.unit.test.ts src/server/__tests__/run-tool-host.http.test.ts --maxWorkers=1 --minWorkers=1
# PASS: 26 tests before and after the adapter rename.

pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/attachment-cleanup.test.ts --maxWorkers=1 --minWorkers=1
# PASS: 4 tests; supplied delay and ownership/deletion locking, including serialization.

node --test --test-isolation=none --test-reporter=tap packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver.test.mjs
# PASS: 18 tests. No receiver changes needed.

pnpm --filter @jini-ai/chat --filter @jini-ai/mcp --filter @jini-ai/devops run typecheck
pnpm --filter @jini-ai/cms exec tsc -p tsconfig.json --noEmit --pretty false
pnpm exec tsc -p scripts/tsconfig.json --noEmit --pretty false
# PASS. Initial stale dist errors resolved by rebuilding, without speculative source changes.

node --import tsx scripts/check-guard-drift.ts
# PASS: 0 total violations, 0 new. Live vendor discovery reports unavailable sources explicitly.

node --import tsx -e "import('./scripts/lib/publish-hygiene-self-test.ts').then(m=>{ const failures=m.runPublishHygieneSelfTest(); console.log(failures); process.exitCode=failures.length?1:0; })"
# PASS: []. Includes HTTP header casing and genuine forbidden-token regressions.

pnpm exec eslint packages/devops/src/local-dev/node-runtime.ts packages/mcp/src/server/http-tool-server.adapter.ts packages/mcp/src/server/tool-result-pages.ts --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'
pnpm exec eslint --no-error-on-unmatched-pattern --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/cms/src/forms/attachment-cleanup.ts
# PASS: 0 errors; 3 existing MCP Sonar warnings.

pnpm complexity
# PASS, exit 0: 0 errors, 210 warnings.

PATH=/workspace/work/ci-semgrep/bin:$PATH SEMGREP_SETTINGS_FILE=/workspace/work/ci-semgrep-settings.yml SEMGREP_LOG_FILE=/workspace/work/ci-semgrep.log SEMGREP_SEND_METRICS=off SEMGREP_ENABLE_VERSION_CHECK=0 pnpm quality:semgrep:test
# FAIL, exit 1, Semgrep 1.175.0: 5/6 rule suites pass.
# no-provider-error-echo misses original line 31 and new lines 57 and 69.
```

Tovu, from `/workspace/Tovu`:

```bash
npm run build --workspace @tovu/contracts
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
# PASS; linked against rebuilt Jini.

TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none --experimental-test-module-mocks apps/website/src/features/forms/__tests__/form-file-purge.test.ts
# PASS: 8 tests after rebuilding/relinking.

node node_modules/eslint/bin/eslint.js apps/website/src/server/runtime/composition/app.ts apps/website/src/server/runtime/composition/deps.ts
# PASS: 0 errors, 11 existing warnings; changed wiring adds no decisions/complexity.

npm exec -- tsc -p tsconfig.json --noEmit --pretty false
# FAIL: only store.ts:410 TS2322, string | undefined passed as string.
# Unchanged at e327c07c8; unrelated to the cleanup wiring. Listed, not repaired.
```

Runtime startup/root-barrel checks also passed (6 tests): `pnpm --filter @jini-ai/agent-runtime exec vitest run src/__tests__/startup-failure.test.ts src/__tests__/index.test.ts --maxWorkers=1 --minWorkers=1`. No tests, rules, assertions, or thresholds were disabled, skipped, weakened, or deleted. No coverage exclusions were added.

## Open findings and CI

BUG OPEN: Semgrep no-provider-error-echo misses error.message in a rejection callback throw, aliased response.data in a callback return, and String(error) in a callback return. Source-only matching finds the expressions; the precise dataflow failure remains unverified. Temporary experiments stayed outside the repository. Repeated hypotheses failed without closing the gap, so repair stopped as required rather than broadening taint to every callback or weakening fixtures.

BUG OPEN: Tovu apps/website/src/features/deployments/publish-credentials/store.ts:410 passes optional input.id to a required string id. The same code exists at pinned base e327c07c8 and was not modified.

BUG FIXED: ESLint's duplicate final block overrode its legacy-directive parser and imposed conflicting neutrality/case policy.

BUG FIXED: Generated provider payloads were linted as authored source.

BUG FIXED: Namespace exceptions and Antigravity paths referred to obsolete locations; SurfaceRecoveryInfo was missing from its public React surface.

BUG FIXED: Native probe environment, MCP SDK imports, and forms cleanup dependencies violated the existing injection/adapter/domain boundaries.

Cloudflare historical failure: not reproduced, 18/18 pass.

Code workflow: [Jini CI run 42090384151](https://github.com/AINSEP/Jini/actions/runs/42090384151), source commit fe4dec4f88d4f374a6035ddf6fa848efd5aaffdc. The Custom Semgrep rule regressions step failed. Other jobs were still running at the last inspection; this is not a green workflow claim.

Edited boundary audit: PASS. Forms reuse the host's existing lock and retention owner; MCP SDK imports stay in adapters; compatibility exceptions retain reasons; public HTTP exports stay intact. Changed logic units are directly testable through injected environment/lock/grace seams. Variable names were checked against computed values; no new scale, resource, or I/O costs were introduced. The unresolved Semgrep and unrelated Tovu error prevent a green completion claim.

Evidence logs and temporary Semgrep diagnostics remain under `/workspace/work/ci` and `/workspace/work/ci-semgrep-*` in this environment.
