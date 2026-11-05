# TAG-A result — 2026-11-05

Implementation complete within the two-hour cap. Focused behavior tests, Jini builds, and native Chromium checks pass. Verification exceptions are disclosed below: unchanged Tovu TypeScript errors, unchanged complexity violations, and the scoped coverage branch threshold.

## Branches and commits

Only cloud/tag-a is pushed in either repository. No force push, main push, deployment, or npm publication.

Required pinned bases were used, rather than the subsequently advancing remote branch tips:

- Jini: 6f507852d (origin/integ/night-1105 base).
- Tovu: e327c07c8 (origin/night-1105 base).

Jini implementation commits, in order:

- 9019a1481 — suppress agent addressing on secret fields.
- 529898f9c — visible, direct-control page actions.
- 9033ecfe8 — authenticated runless requests and chat surfaces.
- f407c9729 — private readback and secret override regressions.
- 021177461 — confirmation bound to proposed view.
- 82e44e07f — private, unaddressable human decision controls.

Tovu implementation commits, in order:

- d35e4b541 — private secret reveal controls.
- 13984638e — protected actions through human chat cards.
- 51cae1893 — secret controls and starter-password privacy.
- d3a912801 — browser identity across normal and AG-UI transports.
- 7f5601761 — navigation invalidation and cold page-service activation.

This report is committed separately after those implementation commits. Final report-commit SHAs are provided in the final response.

Every checkpoint push was confirmed. After the initial branch creation, clean detached worktrees were used for pull --rebase immediately before pushes, avoiding interference with concurrent local edits. No remote changes required conflict resolution.

## Delivered scope

TAG-A only: plan step 1, step 5, and secret/decision-control stripping from step 6.

- Generic regions no longer adopt descendant buttons, links, or summaries. Direct controls, native details summaries, editable regions, and one unambiguous label-associated field remain supported.
- Discovery, state reads, and effects honor hidden/private/inert/CSS-inactive/closed-dialog boundaries. Disabled fields and inactive modal background controls refuse before effects. Visitor publication restrictions remain binding.
- Opaque clicks use the existing human chat-card exchange in both daemon and runless WebMCP paths. Reviewed directPageAction controls remain direct. The browser approval dialog/store/hooks/CSS and admin.respond_page_approval tool/metadata are removed.
- Runless requests derive the principal from the authenticated proxy, mint their own request/run identity, and bind through existing bindRequest to the private token and tab. Inputs are captured; there is no local fallback for an approved-looking agent reply.
- Normal and AG-UI transports preserve the tab identity. Cards enter the existing transcript renderer and use the authenticated, principal/tool-bound callback.
- One filtered page.find_elements read captures a browser navigation revision before an opaque-click card. The browser checks that revision at the exact effect boundary, including navigation away and back. Internal metadata is stripped before page input validation. Cold WebMCP requests reuse the existing activation/rebind helper.
- Secret inputs, textareas, reveal/copy/hide controls and starter-password text remain private through reveal, rerender, and portals. Explicit caller agent attributes cannot override semantic secrecy. Confirm/cancel/alternative approval buttons carry private markers and no agent addressing, while retaining the existing trusted-click and dwell checks.
- The existing 64 KiB frontend output cap and query filtering remain. No default-on tagging rollout, new table, schema migration, polling, registry, framework, approval engine, deployment, or package release was added.

## Setup and baseline

The requested git fetch ran successfully through supported network execution permissions. The checkout's remote fetch configuration tracks main only, so an additional explicit refspec populated origin/cloud-plans-1105 before the requested git show reads.

COMMON.md and tag-a.md were read with git show origin/cloud-plans-1105:<path>. The Software Architect, Programmer, and TDD personas were loaded. Repository-required helper agents were used.

COMMON's /workspace/shared scripts were absent. The already-prepared equivalents in /workspace/.tovu-build were used, then linked at the COMMON paths. These exact commands now work and PostgreSQL returned 1:

~~~sh
source /workspace/shared/dev-env.sh
/workspace/shared/start-postgres.sh
~~~

Untouched targeted baselines were green: driver 177 tests, ui-kit secret field 4 tests, and WebMCP/approval 40 tests. Frozen installation passed. The first recursive baseline build stopped without a UI diagnostic; direct UI build passed. The final complete Jini build passed, including daemon, chat, server, devops, and reference examples.

All commands below use the Node 24 environment from the setup script. No live site or owner data was used; HTTP/browser fixtures contain generated test identities and fixture actions.

## Validation commands and results

### Jini

Working directory /workspace/Jini unless an absolute --prefix is shown.

~~~sh
pnpm install --frozen-lockfile
pnpm -r build
npm --prefix packages/ui run build
~~~

PASS. The final explicit UI rebuild followed the private-decision markup change. Required relinking also passed:

~~~sh
JINI_PACKAGES_DIR=/workspace/Jini/packages npm --prefix /workspace/Tovu run link:jini
~~~

Driver: 11 suites, 273 tests pass (+25 over the existing complete DOM suites); real Chromium driver smoke also passes.

~~~sh
npm --prefix packages/agentic test -- src/core/dom/__tests__
npm --prefix packages/agentic run typecheck
~~~

Secret components: 7 ui-kit tests and 10 UI tests pass.

~~~sh
npm --prefix packages/ui-kit test -- src/attrs.test.ts src/react/__tests__/secret-field.test.ts
npm --prefix packages/ui test -- src/react/components/SecretInput.test.tsx
npm --prefix packages/ui-kit run typecheck
npm --prefix packages/ui run typecheck
~~~

Human decision markup: 99 tests pass (97 baseline plus 2 regressions).

~~~sh
npm --prefix packages/ui test -- src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts src/features/mcp-ui/__tests__/surfaces/document.test.ts
~~~

Core approval: 40 tests pass, including independent concurrent snapshots and post-approval preparation.

~~~sh
npm --prefix packages/core test -- src/__tests__/approval.characterization.test.ts --maxWorkers=1 --minWorkers=1 --pool=threads
~~~

Runless route: final 11 tests pass. Existing frontend-control/RPC integration also passed (61 combined tests at its earlier checkpoint).

~~~sh
pnpm --dir packages/daemon exec vitest run src/http/__tests__/frontend-request-route.test.ts
pnpm --dir packages/daemon exec vitest run src/http/__tests__/frontend-request-route.test.ts src/http/__tests__/frontend-control.test.ts src/http/__tests__/tool-execution-rpc.test.ts
~~~

Chat adapter/transcript: 62 tests pass. Navigation guard plus existing bridge: 83 tests pass. Normal/AG-UI client projection: 100 tests pass.

~~~sh
pnpm --dir packages/chat exec vitest run src/react/features/chat-pane/__tests__/frontend-request-caller.test.ts src/react/features/chat-pane/__tests__/hooks/useChatPane.surfaces.test.tsx src/react/features/chat-pane/__tests__/surface-recovery.test.ts src/react/features/chat-pane/__tests__/hooks/useChatPane.test.tsx
pnpm --dir packages/chat exec vitest run src/embed-widget/browser/__tests__/frontend-navigation-guard.test.ts src/embed-widget/browser/__tests__/frontend-session-bridge.test.ts
pnpm --dir packages/chat exec vitest run src/core/assistant-client/__tests__/transport.test.ts src/core/assistant-client/__tests__/ag-ui-transport.test.ts
pnpm --dir packages/core exec tsc -p tsconfig.json --noEmit
pnpm --dir packages/chat exec tsc -p tsconfig.json --noEmit
pnpm --dir packages/daemon exec tsc -p tsconfig.json --noEmit
~~~

Touched Jini package typechecks pass. The recursive build additionally compiled every package.

### Tovu

Working directory /workspace/Tovu:

~~~sh
npm --prefix packages/contracts run build
node --import tsx --test apps/website/src/assistant/__tests__/admin-frontend-owner.unit.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-force-exit --test-reporter=spec --experimental-test-module-mocks apps/website/src/server/__tests__/assistant-proxy-routes.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-force-exit --test-reporter=tap --experimental-test-module-mocks apps/website/src/server/__tests__/assistant-ag-ui-routes.test.ts apps/website/src/server/__tests__/assistant-ag-ui-translate.test.ts apps/website/src/server/runtime/composition/modules/__tests__/assistant-ag-ui.wire.unit.test.ts
~~~

PASS: contracts build and owner checks; proxy 30/30; AG-UI server 56/56. Stale generated dependency exports were resolved by rebuilding, without changing their source. Existing charts-recharts integrity warnings occurred in fixture startup without test failures.

Daemon/card/context/metadata/HTTP tests: 82/82 pass. This includes no effects before a human answer, one accepted effect, frozen arguments, decline/abort/wrong-principal/replay/typed/agent-answer refusal, direct actions without an extra read, missing revision refusal, and navigation-away/back invalidation.

~~~sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-force-exit --test-reporter=tap --experimental-test-module-mocks apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.page-confirmation.integration.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.page-navigate-error-rewrap.unit.test.ts apps/website/src/assistant/__tests__/frontend-control-capabilities.test.ts apps/website/src/assistant/__tests__/tool-approval-policy.test.ts apps/website/src/assistant/__tests__/mcp-ui-tool-calls.test.ts apps/website/src/assistant/__tests__/page-approval-context.test.ts
~~~

Working directory /workspace/Tovu/apps/admin:

~~~sh
npx vitest run src/features/webmcp/__tests__/admin-page-tools.unit.test.ts src/features/webmcp/__tests__/admin-page-approval.unit.test.tsx src/features/webmcp/__tests__/admin-page-approval-input.unit.test.ts src/features/webmcp/__tests__/admin-page-action-policy.unit.test.ts src/features/webmcp/__tests__/admin-page-human-gate.unit.test.ts --maxWorkers=1 --pool=threads
npx vitest run src/__tests__/unit/app-stream-wiring.unit.test.tsx src/__tests__/unit/app-hooks-admin-webmcp.unit.test.tsx --maxWorkers=1 --pool=threads
npx vitest run src/components/__tests__/AssistantDock.hooks.unit.test.tsx -t useRunContext
npx vitest run src/features/plugins/__tests__/AgentPlugins.unit.test.tsx -t 'assistant admin navigation regression'
npx vitest run src/lib/__tests__/assistant-transport.ag-ui.unit.test.ts
~~~

PASS: WebMCP 43/43; App wiring 25/25; run-context 7/7; affected plugin navigation 1/1; AG-UI client 51/51. Unrelated tests were filtered, not disabled.

Secret suites: initial affected six-file run passed 53 tests; final changed-path rerun after starter-password privacy passed 16.

~~~sh
npm test -- --run src/features/sites/__tests__/create-site-admin-password.unit.test.tsx src/features/security/__tests__/SiteKeyTab.agent-secrecy.unit.test.tsx src/features/sites/__tests__/SiteExportTab.secret.unit.test.tsx src/components/__tests__/SecretInput.unit.test.tsx
~~~

### Real Chromium

Generated local fixtures only:

~~~sh
/workspace/Tovu/node_modules/.bin/esbuild /workspace/Jini/packages/agentic/src/core/dom/dom-page-driver.ts --bundle --format=iife --global-name=TagADriver --platform=browser --outfile=/workspace/work/tag-a/driver-browser-bundle.js
node /workspace/work/tag-a/driver-browser-check.cjs
node /workspace/work/tag-a/confirmation-chromium-smoke.mjs
~~~

PASS in Chromium 155: region Reveal has zero effects; labelled checkbox/details work; real native modals block background controls and respect open order; disabled/hidden/private controls refuse or omit values. No page errors.

PASS: actual compiled confirmation surface script, private decision controls, 1500 ms dwell, synthetic clicks produce zero calls, a trusted native mouse click produces exactly one answer, repeated clicks cannot answer twice, and cancel produces one cancel answer. Zero browser errors.

Limitation: the confirmation browser fixture stubs window.jiniMcpUi.callTool and executes the emitted surface script. It does not boot the complete application or exercise callback authorization. Those boundaries are covered by the separate real HTTP/executor, App hook, and AG-UI integration tests.

## Verification exceptions — unchanged baseline, not hidden

1. Tovu root TypeScript still reports TS2322 at apps/website/src/features/deployments/publish-credentials/store.ts:410 (string | undefined assigned to string).
2. Admin TypeScript still reports TS2554 at src/features/security/Security.tsx:183 and TS18046 at src/lib/__tests__/api-user-facing-fallback.unit.test.ts:24 and :25.
3. Scoped coverage runs all 273 tests successfully but exits nonzero against the unchanged 98% branch threshold. Driver: 99.74% statements/lines, 97.70% branches, 100% functions. Untouched publication-filter: 85.71% branches; combined branches 95.11%. Native-modal behavior has real-browser evidence. No thresholds or exclusions were changed.
4. Whole touched-file complexity includes eight unchanged Jini chat violations (six in useChatPane, two in the existing browser bridge) and five unchanged Tovu violations in AdminShell, daemon-client helpers, and proxyMcpUiToolCall. New/changed logic units pass the requested ceiling of 10. Exact base/current message comparisons show no added violation.

Exact failing TypeScript and coverage commands:

~~~sh
# /workspace/Tovu
node_modules/.bin/tsc -p tsconfig.json --noEmit
# /workspace/Tovu/apps/admin
node_modules/.bin/tsc -p tsconfig.json --noEmit
# /workspace/Jini
npm --prefix packages/agentic test -- src/core/dom/__tests__ --coverage --coverage.include=src/core/dom/dom-page-driver.ts --coverage.include=src/core/dom/publication-filter.ts
~~~

Both Tovu TypeScript outputs were reproduced in a detached worktree at e327c07c8 using the same refreshed dependencies and compared byte-for-byte with the final outputs; they are identical. Untouched errors were listed rather than repaired, as instructed.

Complexity command form used for touched production paths:

~~~sh
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' <explicit touched production paths>
~~~

All final diffs pass git diff --check. No eslint-disable, TypeScript suppression, coverage-ignore, threshold, or exclusion was introduced.

## Architecture, quality, and cost

Architecture audit PASS: generic execution, approval, browser bridge and privacy logic stay in Jini; Tovu supplies CMS policy, authenticated principal/tab binding, router notifications, and chat wiring. No schema change or new service. Existing public positional APIs and React callback signatures were preserved; new public boundaries use required/optional objects. renderActions keeps its legacy array argument for compatibility.

Assessment: driver units 94–97; secret mapping 100; generic request/context adapters 100; WebMCP registration 98; renderActions 98 (legacy signature). No Critical/High findings, no score below 90. Perfect-score skepticism checked names, clone/snapshot semantics, missing/cancelled channels, output bounds, input mutation, concurrent requests, callback ownership, and cleanup. Adversarial tests cover ambiguous labels, modal order, repeated/replayed answers, wrong principals, caller mutation, concurrent snapshots, and navigation away/back.

Cost: secret filtering is O(prop count) per render. Driver checks are scoped O(nodes × ancestor depth), plus modal eligibility checks before effects. Each protected WebMCP action adds one authenticated request; cold startup reuses one activation POST. Each opaque click adds one existing filtered DOM read for the navigation revision, with no service/database read. Human waits use four 21-byte keepalives per minute. Cards use existing transcript/exchange persistence. No new database writes, polling, or tables were added.

## Open findings (listed only)

BUG — Medium, pre-existing: SiteExportTab index-based revoke handles can refer to a different export if rows reorder within the same view while approval waits. Navigation revision does not bind entity identity. Follow-up: stable share-id handles or a target version guard.

BUG — Pre-existing: selectOption can select an option inside a disabled optgroup; the existing characterization test records it.

BUG — Pre-existing TypeScript failures are listed in the verification exceptions above.

The pre-existing untracked packages/plugin-ui-ux-design directory in Jini was not staged, changed, or deleted.

## Evidence retained in the execution workspace

Raw logs/scripts are under /workspace/work/tag-a, including driver-handoff.md, secret-handles-handoff.md, webmcp-adapter-ledger.md, webmcp-tools-ledger.md, ui-confirmation-handoff.md, jini-final-build.log, proxy-final.log, daemon-cards-ag-ui-server-final.log, confirmation-chromium-smoke.json, both baseline/final TypeScript logs, and tovu-complexity-baseline-comparison.json.

No required TAG-A implementation remains open. Default-on tagging, forwarding, Composer/picker adoption, and broader stable-handle cleanup remain TAG-B.

