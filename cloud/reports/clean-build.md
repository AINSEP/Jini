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
