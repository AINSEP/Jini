# card — connection-card extraction

Implemented CARD steps 2–4 and the trimmed packed neutral-consumer check from `cloud/plans/CARD-plan-result.md` and `TRIM.md`, fetched from `origin/cloud-plans-1105` (`c4a27563b7a69474d5a5ade6209217c3819ce5b1`). Software Architect, Programmer, and TDD personas were loaded. Work began November 5, 2026, at approximately 10:38 AM Pacific, within the two-hour cap.

## Branches and pushed implementation commits

Only `cloud/card` was pushed in either repository. Initial pushes created that remote branch; subsequent pushes followed `git pull --rebase origin cloud/card`. No force-push, deployment, or publication occurred.

| Repository | Exact base | Pushed implementation commits, oldest first |
| --- | --- | --- |
| Jini | `6f507852d` | `cea8756ae363ba5a69e649d305dd2382cc996b67`, `60d1a395df47880db1969de96a7c35a5632e6b74`, `433a9b06906d86db4c90dfb0a10bd6a2b43bb5ba` |
| Tovu | `e327c07c8` | `79136409ccdc91067a7cb4ecdb21f82ada14503e`, `03b0683be080a8f8e4077c175966b614e55f5250` |

Report-only commits follow these implementation heads. The final response records their SHAs.

## Changes

- Jini daemon HTTP exports `deliverSurfaceCallback`, `isSurfaceCallbackPermitted`, and shared typed-answer refusal copy. Delivery retains restoration streaming, explicit-restore and late-answer handling, the existing 409 bodies, and the answer-free 202 acknowledgment. It cannot execute arbitrary tools. Typed answers require explicit admission.
- Tovu retains tool membership, namespace checks, authenticated request parsing, typed-target resolution, legacy execution, and proxy forwarding. The proxy's local-miss restoration/forwarding path was not replaced. Both HTTP hops use the same host policy, which opts in only choice cards to typed answers.
- Jini UI adds the universal `@jini-ai/ui/mcp-ui/sign-in-card` entry with `buildSignInCard` and `waitAtSignInCard`. Identity, copy, result projection, and connection behavior are injected. It imports the exchange ABI from core, not the daemon. Tovu supplies its original URI, app identity, copy, theme/link behavior, errors, and skipped result.
- Jini integrations exports `waitForHostedSignIn` and `createSignInHandoffs` through the existing API-connections entry. Connected status and a strictly newer generation are still both required. Polling order, baseline read placement, errors, timeout/abort behavior, expiry/capacity, entropy, replay refusal, and consume-before-actor-check ordering are preserved. Tovu retains routes, cookies, link construction, loopback behavior, and MCP-specific waiting.
- The neutral packed consumer reuses `scripts/testing/packed-fixture.ts`. Daemon, UI, and integrations are packed offline and extracted into a disposable consumer without workspace links; runtime dependencies and the HTTP entry's declared Express peer are copied. Different Atlas IDs/copy render and deliver a real Skip through the exchange store, abort the watcher, and replace the same URI.

Added production I/O: **zero reads, writes, polls, or provider requests**. Existing effects were relocated. No schema, table, persistence layer, framework, package, or plugin dependency was added. Existing tests were not deleted, weakened, or excluded.

## Setup and baseline

The named `/workspace/shared/dev-env.sh` and `/workspace/shared/start-postgres.sh` were absent. The preinstalled equivalents under `/workspace/.tovu-build/` were used. Node was `v24.22.1`. Network-enabled execution was necessary for the configured proxy and PostgreSQL socket. The original checkout had stale build outputs; no source workaround was added.

```sh
source /workspace/.tovu-build/env.sh
/workspace/.tovu-build/start-postgres.sh
cd /workspace/Jini
pnpm install --frozen-lockfile
pnpm -r build
cd /workspace/Tovu
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm --prefix packages/contracts run build
```

Full recursive Jini build passed. All local linking/build artifacts remain uncommitted; release manifests and lockfiles were not rewritten.

A detached Tovu checkout at `e327c07c8`, using the rebuilt dependencies, passed **101/101** baseline tests. Command from `/workspace/work/card-baseline-tovu`:

```sh
source /workspace/.tovu-build/env.sh
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --experimental-test-module-mocks \
  apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.secret-forms.test.ts \
  apps/website/src/features/agent-plugins/__tests__/unit/connect-skip.unit.test.ts \
  apps/website/src/features/api-connections/__tests__/connect.unit.test.ts \
  apps/website/src/features/api-connections/__tests__/browser-binding.unit.test.ts \
  apps/website/src/features/external-mcp/__tests__/external-mcp-oauth.test.ts
```

## Verification

All commands below used `source /workspace/.tovu-build/env.sh` first. Network-enabled execution was used for HTTP, PostgreSQL, and packed subprocess checks. Only affected test families were run.

From `/workspace/Jini`:

```sh
npm --prefix packages/daemon test -- src/http/__tests__/surface-callback.test.ts src/__tests__/surface-exchanges.test.ts
npm --prefix packages/ui test -- src/features/mcp-ui/__tests__/sign-in-card.unit.test.ts
npm --prefix packages/integrations test -- src/api-connections/__tests__/hosted-sign-in.unit.test.ts
node_modules/.bin/vitest run scripts/__tests__/connection-card.packed.test.ts
npm --prefix packages/daemon run typecheck
pnpm --filter @jini-ai/ui typecheck
(cd packages/integrations && pnpm run typecheck)
node_modules/.bin/tsc -p scripts/tsconfig.json --noEmit
node_modules/.bin/eslint --no-inline-config --rule 'complexity:[error,10]' --rule 'sonarjs/cognitive-complexity:[error,10]' packages/daemon/src/http/surface-callback.ts packages/integrations/src/api-connections/hosted-sign-in.ts packages/ui/src/features/mcp-ui/sign-in-card.ts
```

Results: daemon **56/56**, UI **7/7**, integrations **10/10**, packed consumer **1/1**; all three package typechecks, scripts typecheck, and strict complexity lint passed. New callback and hosted-helper suites were observed failing for missing modules before implementation. Hosted-helper focused V8 coverage was 100% statements, branches, functions, and lines, using:

```sh
cd /workspace/Jini/packages/integrations
pnpm exec vitest run src/api-connections/__tests__/hosted-sign-in.unit.test.ts --coverage --coverage.include=src/api-connections/hosted-sign-in.ts
```

Tovu commands below use this exact prefix from `/workspace/Tovu`:

```sh
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --experimental-test-module-mocks
```

Append these paths for the hosted/security regression batch (**118/118**):

```text
apps/website/src/features/api-connections/__tests__/browser-binding.unit.test.ts
apps/website/src/features/api-connections/__tests__/connect.unit.test.ts
apps/website/src/features/api-connections/__tests__/surface-adapters.security.test.ts
apps/website/src/features/external-mcp/__tests__/external-mcp-oauth.test.ts
```

Append these paths for the final card/HTTP compatibility batch (**47/47**):

```text
apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.external-mcp-save.integration.test.ts
apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.media-trash-asset.integration.test.ts
apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.static-publish.integration.test.ts
apps/website/src/server/__tests__/admin-mcp-ui-tool-calls-route.test.ts
apps/website/src/server/inbound/admin-http/routes/agent-plugins/__tests__/integration/connection-sign-in.security.integration.test.ts
apps/website/src/features/agent-plugins/__tests__/unit/connect-skip.unit.test.ts
apps/website/src/features/agent-plugins/__tests__/unit/connect-card-state.unit.test.ts
apps/website/src/features/agent-plugins/__tests__/unit/connect-card-theme.unit.test.ts
apps/website/src/features/agent-plugins/__tests__/unit/connect-card-open-link.unit.test.ts
apps/website/src/features/agent-plugins/__tests__/unit/plugin-credential-cards.unit.test.ts
```

Append `apps/website/src/platform/db/__tests__/parity/vault-read-parity.postgres.test.ts` for real PostgreSQL vault parity: **19/19**, no skips or TODOs. This verifies storage parity, not a full browser sign-in journey.

The broader callback run added `--test-concurrency=2` to the prefix and used:

```text
"apps/website/src/assistant/__tests__/mcp-ui-tool-calls*.test.ts"
apps/website/src/server/__tests__/admin-mcp-ui-tool-calls-route.test.ts
apps/website/src/server/inbound/admin-http/routes/agent-plugins/__tests__/integration/connection-sign-in.security.integration.test.ts
```

Result: **112 passed, 1 failed**. Static publish failed exporting a local font asset because its local HTTP fetch failed. Its approval/delivery path was reached. One isolated rerun with `--test-concurrency=1` and only `mcp-ui-tool-calls-route.static-publish.integration.test.ts` passed **4/4**, as that file also did in the earlier 47-test batch. This intermittent export finding remains listed below.

Additional Tovu checks:

```sh
node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/eslint --no-inline-config --rule 'complexity:[error,10]' --rule 'sonarjs/cognitive-complexity:[error,10]' apps/website/src/features/agent-plugins/connect-sign-in-wait.ts apps/website/src/features/agent-plugins/connect-card-ui.ts apps/website/src/features/api-connections/connect.ts apps/website/src/features/api-connections/browser-binding.ts apps/website/src/features/api-connections/host.ts apps/website/src/assistant/mcp-ui-tool-calls.ts apps/website/src/assistant/mcp-ui-tool-calls-route.ts
```

Tovu TypeScript reports one pre-existing error in the untouched publish-credentials store. Strict lint reports only the unchanged parser complexity; the same lint command on the pinned baseline reproduces it. All changed logic-bearing functions meet the ceiling.

`pnpm guard` did not complete after more than six minutes and was terminated. `timeout 120s pnpm guard` with network enabled also timed out (124). A bounded boundary/neutrality/layer probe stalled with a child in `git check-ignore --stdin` and was stopped; it is not recorded as a pass. No guard or policy was disabled or changed.

## Architecture and pre-completion audit

Manual audit: PASS for the new production modules and Tovu adapters. Generic behavior belongs to existing Jini packages; host membership, auth, routes, cookies, copy and result projection stay in Tovu. UI uses core ABI types and has no daemon import. New public Jini APIs use required and optional objects. Existing Tovu positional policy signatures remain for compatibility. No cross-plugin imports or vendor code were introduced. Automated repository-wide guard status remains incomplete as above.

Function assessment: callback admission/delivery and hosted wait/handoff functions 100, no Critical/High findings; UI rendering/lifecycle/final emission 99, Low: host copy and connection abort cooperation remain host contracts, and final transport updates are intentionally best effort. Tests directly cover binding, wrong actor/replay, stale generation, exact expiry, capacity eviction, cancellation ordering, cleanup, and final-update failure. Names and effect ordering were checked against the original source; no locally fixable production finding was retained in the extraction.

Self-validation: PASS for the scoped exchange/card/hosted HTTP paths and packed neutral consumer; broader export regression is intermittent. Original tests were preserved. No browser-harness expansion or new database harness was introduced. Tests use synthetic actors, connections and credentials only. Final diffs were reviewed for scope and checked with `git diff --check`.

## Open findings — listed, not fixed

BUG (baseline): `apps/website/src/features/deployments/publish-credentials/store.ts:410` passes `string | undefined` where `string` is required (TS2322). The pinned baseline reports the same error and this file is unchanged.

FINDING (baseline): `parseMcpUiToolCallRequest` at `apps/website/src/assistant/mcp-ui-tool-calls-route.ts:184` has cyclomatic complexity 11. This function is unchanged; the pinned baseline reports the same violation.

BUG (intermittent regression): the broad static-publish test once failed fetching local `/theme-assets/tovu-starter/assets/fonts/geist-mono-var.woff2`; the isolated rerun and earlier compatibility run passed. No deployment was created by that failed synthetic export.

FINDING: integration boots log `charts-recharts` `INTEGRITY_FAILED`; assertions still pass. Plugin artifacts and initialization were outside CARD scope.

OPEN: full repository guard/boundary automation did not finish; `git check-ignore --stdin` was observed stalled during the boundary probe. No clean full-guard claim is made.

OPEN: normal coordinated Jini release and consumer dependency update remain outside this job. Verification used rebuilt local links and packed artifacts; nothing was published. Open Marketing wiring was not attempted because its repository was not supplied.

The untracked `packages/plugin-ui-ux-design/` directory in Jini was left out of commits. Suggested next assignee: integration reviewer for the two `cloud/card` branches; route the listed baseline/tooling/export findings separately.
