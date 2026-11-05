# om-chat — completed item 0

Owner narrowed the scope during execution: finish ONLY item 0, retain other items only if already committed, run focused tests, push, report, end. No other item had been committed; all uncommitted items 1–4/8 work was removed. Items 5–7 were never started.

## Branches and pushed commits

Only `cloud/om-chat` was pushed in either repository. No main push, force push, deployment, or publication.

- Jini base: `origin/integ/night-1105` → `a9b1d949ffb0363ddaa3df2278e8a3fcf034add5`.
- Tovu base: `origin/night-1105` → `ce99e7eba807b91d12926fe5889a9958032bc398`.
- The named bases had advanced beyond COMMON's recorded hashes; the job explicitly named these branches.
- Jini `3c154a6c4`: initial in-progress report.
- Jini `e4badc800c6cd92cec943d55417fbbf9a0bf5be7`: host-owned Codex bridge approval plus regressions (push confirmed).
- Tovu `822cf73cf15ed1873774ac8db3fb65b9f9fbd6c1`: site/desktop adoption and human-confirmation invariants (push confirmed).
- Final report-only commits are the branch heads containing this report; their SHAs are returned in the final response.

## Changes

Added optional trusted-host `McpJsonInjectionOptions.toolApprovalOwner: 'host'`. Omission preserves current behavior. Codex staging emits `default_tools_approval_mode = "approve"` only in `[mcp_servers.jini]`, before nested env/header tables, for stdio and HTTP. Other MCP servers and target-tool authorization remain unchanged. Tovu site and desktop opt in at their existing compositions.

Behavioral tests exercise real MCP delegated calls into Tovu's approval wrapper: pending human answer means zero effects, confirm executes once, wrong principal/decline/cancellation/expiry/missing channel means zero effects, and duplicate/late answers cannot execute. This base keeps run-bound cards alive until cancellation; the expiry regression exercises the existing supported unleased bounded path. Desktop's destructive-tool exclusion remains covered by its existing catalog tests.

State cost: one existing staged config write per launch adds a 40-byte setting; no additional reads, database writes, polls, timers, or requests. Host cards retain existing costs.

## Focused verification

All commands use `source /workspace/.tovu-build/env.sh` first.

Jini (`/workspace/Jini`):

- RED: `npm --prefix packages/daemon test -- src/agent-executor/codex/__tests__/home-config.test.ts` → 2 new failures, 18 existing passes before implementation.
- `npm --prefix packages/daemon test -- src/agent-executor/codex/__tests__/home-config.test.ts src/agent-executor/codex/__tests__/home-http-staging.test.ts src/agent-executor/codex/__tests__/home-cleanup.test.ts src/agent-executor/__tests__/http-mcp-launch.integration.test.ts` → 40/40 passed. Covers omission/opt-in, both transports, unrelated server preservation, create/resume, read-only sandbox/native tools off, and cleanup.
- After correcting an exact-optional test-fixture type: `npm --prefix packages/daemon test -- src/agent-executor/__tests__/http-mcp-launch.integration.test.ts` → 12/12 passed.
- `pnpm --filter @jini-ai/daemon run build` → passed.
- `pnpm --filter @jini-ai/daemon run typecheck` → passed.
- `pnpm exec eslint packages/daemon/src/agent-executor/contracts.ts packages/daemon/src/agent-executor/codex/home-config.ts packages/daemon/src/agent-executor/codex/home-staging.ts` → zero errors; one existing nested-template warning.

Tovu (`/workspace/Tovu`):

- Site adoption assertion failed before the opt-in, then passed after it.
- `node --import tsx --experimental-test-module-mocks --test --test-isolation=none apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.typed-tools.integration.test.ts` → 13/13 passed.
- From `apps/desktop`, with loopback/network permission: `node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test --test-isolation=none --test-name-pattern='runtime registers the built tools' src/desktop-agent.test.ts` → 1/1 passed.
- From `apps/desktop`: `node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test --test-isolation=none src/desktop-agent-tools.test.ts` → 10/10 passed.
- `npx eslint apps/website/src/server/inbound/assistant/agent-daemon-scope.ts apps/desktop/src/desktop-agent.ts` → zero errors; seven existing site-composition warnings.
- `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` → passed, installed links refreshed.
- `npm --prefix packages/contracts run build` → passed; fixes stale installed declaration output exposed by initial type checking.
- `npx tsc -p tsconfig.json --noEmit` → passed after contracts rebuild.
- From `apps/desktop`: `npx tsc -p tsconfig.main.json --noEmit` → passed after contracts rebuild.
- `git diff --check` → clean in both repositories.

Before scope reduction the required setup rebuild `pnpm --no-bail -r build` returned 39 passes and failures in chat/provider-plugins/daemon, without compiler diagnostics in its aggregate log. That run overlapped in-flight worker edits and is not claimed as a green baseline. The final touched daemon rebuild/typecheck are green. Unrelated builds were not investigated after scope reduction.

The first Tovu push invoked the repository's full desktop pre-push gates. It was terminated to honor the owner's focused-only instruction; the push used a command-scoped `core.hooksPath=/dev/null`. No hook, test, rule, or threshold file was modified, and focused checks above passed.

## Installed Codex and remaining limitations

Installed `codex-cli 0.166.0-alpha.1` accepts the staged setting. `CODEX_HOME=<scratch> codex mcp get jini --json` succeeds with `approve`; overriding it to `invalid-om-chat-probe` fails with the schema's expected variants `auto`, `prompt`, `writes`, `approve` at `mcp_servers.jini.default_tools_approval_mode`.

UNVERIFIED: one bounded real Codex run was attempted using a synthetic no-data confirmation probe and read-only/native-tools-disabled configuration. Strict configuration validation succeeded, but the model endpoint at `chatgpt.com` was blocked by the environment proxy (HTTP CONNECT 403); no host call was observed. No network-policy bypass was attempted. Behavioral protection is verified by the container integration tests above, not by a live model run.

Published Jini versions and consumer lockfiles were not changed; source adoption was verified against rebuilt, locally linked Jini. Release/publication remains separate work.

Bug fixed: locked Codex runs lacked a bridge-scoped host-owned approval setting, preventing access before the host could apply its own tool authorization and human card.
Open verification: end-to-end model execution remains UNVERIFIED due to the proxy block.

Elapsed work remained below the two-hour cap (started 19:13 UTC). No further work planned in this job.
