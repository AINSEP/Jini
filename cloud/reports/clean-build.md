# Clean build — in progress

Branch: `cloud/clean-build` in Jini. Base: `origin/cloud/combine` at `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`.

Fresh reproductions are running under `/workspace/work/clean-build/{Jini,Tovu}`.
Toolchain: Node 24.22.1, pnpm 10.33.2. Caches are isolated under the scratch directory; no existing dist output or installed links copied.

Jini install reports a cycle among agent-plugins, commerce, ui and integrations.
The commerce dev dependency on agent-plugins has no imports. The integrations dev dependency exists for a lifecycle-only test.

Commands underway:
- Jini: `pnpm install --frozen-lockfile && pnpm -r --workspace-concurrency=1 run build`.
- Tovu: `npm ci`.

Initial sandbox cache write restrictions were resolved with scratch-local package caches. Network fetches currently have intermittent HTTP 502 responses; final build results pending.

Open: reproduce compiler failures, apply minimal fixes, verify fresh serial and default builds, run affected checks, record timings and pushed SHAs.

## Reproduced causes and implementation

Jini clean serial build fails with TS2307 at `packages/commerce/src/react/commerce-i18n.ts`: ui/panel-kit has no dist output yet. Cycles: `commerce → agent-plugins → commerce` and `commerce → ui → integrations → agent-plugins → commerce`. The commerce → agent-plugins dev dependency is unused; integrations uses agent-plugins only in a lifecycle test of agent-plugins itself.

Fix: remove those two dev dependencies, move the lifecycle test to `packages/agent-plugins/tests/`, update only their lockfile entries, and enable pnpm's existing `disallowWorkspaceCycles` check. Probe: `pnpm --config.disallow-workspace-cycles=true install --frozen-lockfile --lockfile-only --offline` rejects the original graph with ERR_PNPM_DISALLOW_WORKSPACE_CYCLES; `pnpm install --frozen-lockfile --lockfile-only --offline` passes the corrected graph in 1.3s.

Tovu `npm ci` fails in contracts prepare with TS2305: its admin-failure-copy test imports `describeRequestFailure`, an unreleased Jini core export absent from registry 0.6.23. Move this host integration test to website's admin-http tests. All assertions remain; the existing website test glob and test typecheck cover it. Contracts production source requires no unreleased core API, so package preparation can use registry dependencies as intended.

Clean serial/default verification and focused test results remain in progress.

## Verification update — in progress

Fresh corrected clones: `/workspace/work/clean-build/serial/{Jini,Tovu}`, `/workspace/work/clean-build/default/{Jini,Tovu}`. An additional untouched Tovu clone under `foreground/Tovu` verifies serialized npm lifecycle scripts. No dist output or installed links were copied; only download caches were seeded.

- Jini default: `pnpm install --frozen-lockfile` PASS (11.8s), then `pnpm -r run build` PASS (5m39.246s).
- Jini serial: installation PASS (10.9s); `pnpm -r --workspace-concurrency=1 run build` remains in progress.
- Tovu default: `npm ci` PASS (1m7.651s).
- Tovu serialized lifecycle scripts: `npm ci --foreground-scripts` PASS (28.232s). npm arborist's `foregroundScripts` sets its lifecycle queue limit to 1. A separate exploratory `npm_config_jobs=1 npm ci` also passed, but npm ignores that unsupported setting; it is not serial-build evidence.
- Jini: `pnpm --filter @jini-ai/agent-plugins exec vitest run tests/plugin-uninstall-message.unit.test.ts` PASS, 2/2 cases.
- Tovu: after `JINI_PACKAGES_DIR=/workspace/work/clean-build/default/Jini/packages npm run link:jini`, `TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --test --test-isolation=none --experimental-test-module-mocks --test-reporter=tap apps/website/src/server/inbound/admin-http/__tests__/admin-failure-copy.test.ts` PASS, 5/5 tests. Repeated after the full Jini build and relink: PASS.
- `pnpm --filter @jini-ai/agent-plugins --filter @jini-ai/commerce --filter @jini-ai/integrations run typecheck` PASS.
- Both relocated test files also pass standalone strict `tsc --noEmit` checks; contracts pass their package typecheck against registry dependencies.
- Targeted complexity lint passes in both repositories. All 9 Jini assertion lines and all 11 Tovu assertion lines match their original versions.
- Regression probe: temporarily restoring commerce's agent-plugins dependency in the completed default clone makes `pnpm install --frozen-lockfile --lockfile-only --offline` fail with `ERR_PNPM_DISALLOW_WORKSPACE_CYCLES` using the committed configuration. Original manifest restored; scratch Jini remains clean.

Pushed commits for this repository so far:
- `e6d409fca076f33578326e505af6a0ca64612a2c` — docs: record clean build investigation
- `484b09d0d3a203481dea485079285bcce9ea132c` — fix: restore clean workspace build order
- `76b8e3f5829d6725747b017ad32f6d62a8d8ec2d` — fix: remove cyclic development dependencies
