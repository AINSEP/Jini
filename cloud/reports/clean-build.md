# Clean build

Status: complete. Branch: `cloud/clean-build` in both repositories. No changes pushed to other branches.

## Causes and smallest fixes

Jini's clean serial build failed at `packages/commerce/src/react/commerce-i18n.ts` with TS2307 for `@jini-ai/ui/panel-kit`. pnpm included two cycles in one strongly connected component:

- `commerce → agent-plugins → commerce`.
- `commerce → ui → integrations → agent-plugins → commerce`.

Commerce's dev dependency on agent-plugins was unused. Integrations used agent-plugins only in a test of agent-plugin lifecycle behavior; that test imported no integrations code. Remove those two development dependencies and move the lifecycle test to its owning package. UI now builds before commerce. Keep the optional commerce peer on agent-plugins: it describes a real adapter requirement. No production imports, package exports, build scripts, or retry behavior changed.

Tovu's `npm ci` failed in contracts' `prepare` build with TS2305: `describeRequestFailure` is present on the Jini branch but absent from the published `@jini-ai/core@0.6.23` installed by npm. A contracts test imported that unreleased API and inspected the website's route tree. Move this host integration test into the website's admin-http test directory, retaining every test and assertion. Contracts' production source compiles with registry dependencies; the host test runs with the freshly built local Jini as required by COMMON.md.

Guard: enable pnpm's existing `disallowWorkspaceCycles` option. This rejects cycles at installation rather than allowing an order that depends on stale dist output. No custom graph checker was added.

## Exact files

Jini:

- `packages/commerce/package.json`: remove unused agent-plugins dev dependency.
- `packages/integrations/package.json`: remove lifecycle-test-only agent-plugins dev dependency.
- `pnpm-lock.yaml`: remove exactly the corresponding two local-link entries (six lines); no registry resolutions changed.
- `pnpm-workspace.yaml`: enable the built-in cycle check.
- `packages/integrations/tests/plugin-uninstall-message.unit.test.ts` → `packages/agent-plugins/tests/plugin-uninstall-message.unit.test.ts`: move test, retain the historical why comment with its new ownership rationale.
- `cloud/reports/clean-build.md`: this report.

Tovu:

- `packages/contracts/src/__tests__/admin-failure-copy.test.ts` → `apps/website/src/server/inbound/admin-http/__tests__/admin-failure-copy.test.ts`: move test and adjust its source-relative paths. The existing website test glob and `tsconfig.tests.json` include it.
- `cloud/reports/clean-build.md`: this report.

## Reproduction and clean verification

Toolchain: `source /workspace/.tovu-build/env.sh` (Node 24.22.1, pnpm 10.33.2). Original clean clones were created with `git clone --no-hardlinks --branch cloud/clean-build /workspace/<repo> /workspace/work/clean-build/<repo>` before the fixes. Independent corrected clones were created under `/workspace/work/clean-build/serial/` and `/workspace/work/clean-build/default/`; serialized npm verification used another fresh `foreground/Tovu` clone. No installed links, node_modules or dist output were copied. Only package download caches were seeded, with `npm_config_store_dir` and `npm_config_cache` pointing under `/workspace/work/clean-build/`. Registry access uses the configured proxy.

| Checkout | Exact command | Result | Wall time |
| --- | --- | --- | --- |
| Original Jini | `pnpm install --frozen-lockfile` | PASS after cache/network setup | 0m9.021s |
| Original Jini | `pnpm -r --workspace-concurrency=1 run build` | FAIL: commerce TS2307, cycle warning | 2m28.087s |
| Original Tovu | `npm ci` | FAIL: contracts TS2305 | 0m23.671s |
| Corrected Jini, serial | `pnpm install --frozen-lockfile` | PASS | 0m11.148s |
| Corrected Jini, serial | `pnpm -r --workspace-concurrency=1 run build` | PASS | 8m33.818s |
| Corrected Jini, default | `pnpm install --frozen-lockfile` | PASS | 0m12.377s |
| Corrected Jini, default | `pnpm -r run build` | PASS | 5m39.246s |
| Corrected Tovu, default | `npm ci` | PASS, including contracts prepare | 1m7.651s |
| Corrected Tovu, serial lifecycle scripts | `npm ci --foreground-scripts` | PASS, including contracts prepare | 0m28.232s |

npm's installed arborist implementation sets lifecycle queue concurrency to 1 for `foregroundScripts` (`lib/arborist/rebuild.js`). An exploratory `npm_config_jobs=1 npm ci` also passed, but npm ignores that unsupported setting; it is not serial evidence. The clean serial/default runs overlapped, so these are observed wall times, not performance benchmarks.

Early setup attempts encountered read-only default cache locations, intermittent registry 502s, and incomplete offline caches. Scratch-local writable caches plus the existing download cache resolved these without source or lockfile workarounds.

## Focused checks

All commands below passed. CWD is the corrected default Jini or Tovu checkout as appropriate.

- Jini lifecycle test: `pnpm --filter @jini-ai/agent-plugins exec vitest run tests/plugin-uninstall-message.unit.test.ts` — 2/2 cases.
- Jini affected packages: `pnpm --filter @jini-ai/agent-plugins --filter @jini-ai/commerce --filter @jini-ai/integrations run typecheck`.
- Jini moved test: `pnpm --filter @jini-ai/agent-plugins exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --esModuleInterop tests/plugin-uninstall-message.unit.test.ts`.
- Jini complexity: `pnpm exec eslint packages/agent-plugins/tests/plugin-uninstall-message.unit.test.ts`.
- Tovu contracts against registry dependencies, before linking: `./node_modules/.bin/tsc -p packages/contracts/tsconfig.json --noEmit`.
- Tovu relink after the completed Jini rebuild: `JINI_PACKAGES_DIR=/workspace/work/clean-build/default/Jini/packages npm run link:jini`.
- Tovu host test: `TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --test --test-isolation=none --experimental-test-module-mocks --test-reporter=tap apps/website/src/server/inbound/admin-http/__tests__/admin-failure-copy.test.ts` — 5/5 tests, zero skipped. Single-process execution verifies all named cases; the default isolated reporter exposed only the file-level result in this runtime.
- Tovu moved test typecheck: `./node_modules/.bin/tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck --strict apps/website/src/server/inbound/admin-http/__tests__/admin-failure-copy.test.ts`.
- Tovu complexity: `./node_modules/.bin/eslint apps/website/src/server/inbound/admin-http/__tests__/admin-failure-copy.test.ts`.
- Cycle regression probe: temporarily restore commerce's agent-plugins dev dependency in the completed default clone, then run `pnpm install --frozen-lockfile --lockfile-only --offline`. The committed configuration rejects it with `ERR_PNPM_DISALLOW_WORKSPACE_CYCLES`. Restore the original manifest; scratch Jini status is clean.
- Assertion-integrity comparison against the base: all 9 Jini assertion lines and all 11 Tovu assertion lines are unchanged. Test case counts remain 2 and 5.
- `git diff --check origin/cloud/combine..HEAD` in both original repositories.

An additional affected core request-failure suite (`pnpm --filter @jini-ai/core exec vitest run src/request-failure.test.ts`) passed 5/5. Full test suites were not run, as directed. Raw logs and timing files remain in `/workspace/work/clean-build/logs/`.

## Review and open items

Architecture audit: PASS. Tests live with their owning package/host; production package boundaries, optional peer requirements and public behavior are preserved. No new runtime logic, I/O, state writes, polling, abstractions or options beyond pnpm's existing build check. Function-quality/coverage assessment is not applicable to new production units: none were introduced. No tests, assertions, rules, coverage targets or compiler checks were weakened or deleted.

No blocking items remain for the requested clean build/install checks. A production Tovu server/app build and full test suites are outside these focused checks; local Jini linking is used only after the independent clean npm install proofs.

Minor finding: the original `/workspace/Jini` contains pre-existing `packages/plugin-ui-ux-design/` remnants from its prepared working tree. They were not staged or modified; all clean proofs use fresh clones without them.

## Branches and pushed SHAs

Jini: `cloud/clean-build`, base `origin/cloud/combine` at `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`.

- `e6d409fca076f33578326e505af6a0ca64612a2c` — docs: record clean build investigation
- `484b09d0d3a203481dea485079285bcce9ea132c` — fix: restore clean workspace build order
- `76b8e3f5829d6725747b017ad32f6d62a8d8ec2d` — fix: remove cyclic development dependencies
- `27f1161b2fd373cf9c671e179590d629d9e16f2f` — docs: record clean build verification progress

Tovu: `cloud/clean-build`, base `origin/cloud/combine` at `5358aa594fb6e8c0ca107b1106fbf9ae43871d50`.

- `7f2d07a3d96f0dc5c9f3d292cf0e8ccb732ff11d` — docs: record clean build investigation
- `43f804d54131501287e392d9c17ce0d56e87536c` — fix: keep host integration tests out of contract preparation
- `d4148b0f5b7c08575db3a1228b9061827abe49d1` — fix: preserve host test paths after relocation
- `0502b77309b71a711fd6999bf4248d79496e7bca` — docs: record clean build verification progress

The final report-only commit is the branch tip returned in the job completion message. Every push is preceded by a rebase pull; no force pushes.
