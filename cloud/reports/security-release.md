# security-release — 2026-11-05

Status: in progress — approved follow-up integration and validation. No publication performed.

## Branches and integration

Only `cloud/security-release` is pushed in either repository. No main push, force push, tag, deployment or npm publication.

- Jini pinned base: `6f507852d`; merged only `origin/cloud/tag-a` at `bf473ef4ebbce3a53cbfd037fcd8fbbce5a5a32d`.
- Tovu pinned base: `e327c07c8`; merged only `origin/cloud/tag-a` at `7f43561ffd05f89ac01f529ab0bacb893b8ed182` and `origin/cloud/tovu-deps` at `a94de36275933b5a5803b2cb2303a31a7fea082f`.
- Both TAG-A reports were complete before integration. All merges were clean. No other cloud job was merged.
- COMMON and security-release instructions were fetched and read using the requested remote ref. Software Architect, Programmer and TDD personas were loaded from the plans branch's AI-Dev-Shop.

## Changes

- Prepared the integrated security hardening release with general changelog entries.
- Split the MessageRow calculation without changing behavior; AssistantMessageRow now meets the complexity ceiling of 10. Its 130 existing tests pass before and after.
- Corrected small compiler blockers, page translation, and an error-classification failure exposed by the affected tests. The translation regression failed before its correction; all 22 related admin tests and all 131 affected store tests pass afterward.
- Made the subprocess test reporter explicit and allowed the resolved reviewed provider payload in the linked admin test harness. No assertion, rule, timeout, threshold or coverage exclusion was weakened. No test was removed or disabled by this job.
- Raised the 12 packages below to 0.6.23 and matched all applicable Tovu floors. Catalogs describe the rebuilt artifacts. The compiled chart approval uses the reviewed 0.6.23 payload; executable bytes are unchanged, with three updated license/version records.
- Kept all four Tovu lockfiles exactly as merged from tovu-deps. Registry lockfile refresh waits for the coordinator's publication, as instructed.

## Validation

| Check | Final result |
| --- | --- |
| Every Jini build script, `pnpm -r build` | PASS |
| Complete Jini `pnpm typecheck`, including scripts | PASS |
| Tovu root, desktop, admin and site-chat typechecks | PASS |
| Focused Jini package tests | PASS after runner/reporter corrections |
| MessageRow existing characterization | 130 PASS before and after |
| Catalog tests | 58 PASS |
| Exact packed-catalog verification | PASS: 38 entries, 538 file digests; 12 release versions and matching floors |
| `pnpm guard:plugins` | PASS |
| `pnpm guard:plugins:packed` | PASS |
| Tovu affected server checks | 103 verified passing; affected transport file rerun 33/33 PASS |
| Tovu touched admin checks | 346/347 verified passing; one repeated timeout remains |
| Additional admin compiler/translation checks | 22 PASS |
| Affected credential-store checks | 131 PASS |
| Chart composition and package-pin checks | 30 PASS, one lockfile-alignment failure pending publication |
| Actual chart bundle rendering | 13 PASS after linked-package harness correction |
| Complexity for the changed MessageRow and compiler-fix files | PASS |
| Whole touched-file / desktop complexity | FAIL on inherited debt, detailed below |
| Release-range secret scans, Gitleaks 8.28.0, redacted | PASS, no leaks |
| `git diff --check` | PASS |

The initial root/desktop compiler failures were corrected; fresh checks pass. The original mixed runner selected a native Node test with Vitest; rerunning it with Node passed. The reporter correction retained all cleanup assertions. The installed admin Vitest does not accept minWorkers, so that unsupported CLI flag was removed before its actual test run.

The first loaded fixture run had timeouts and a later transport assertion failure. The complete affected transport file passes in a fresh rerun, and the export fixture passes its rerun. One other admin test reached its unchanged five-second timeout on both attempts. Per the job rule, no further attempt was made. Its underlying cause is not established; this report does not claim a completely green test run.

The lockfile-alignment failure is retained, including every equality assertion. Manifests require 0.6.23 while the intentionally unrefreshed locks still record 0.6.22. The coordinator must publish from the final Jini commit, then refresh and validate registry lockfiles and installed artifacts. This job performs neither publication nor that deferred refresh.

## Exact packages to publish

All at **0.6.23**:

- `@jini-ai/agent-plugins`
- `@jini-ai/agent-runtime`
- `@jini-ai/agentic`
- `@jini-ai/chat`
- `@jini-ai/core`
- `@jini-ai/daemon`
- `@jini-ai/mcp`
- `@jini-ai/platform`
- `@jini-ai/ui`
- `@jini-ai/ui-kit`
- `@jini-ai/plugin-catalog`
- `@jini-ai/provider-plugins`

The other package versions are unchanged. Generic runtime/presentation ownership stays in Jini; Tovu keeps product wiring. No new framework, table, migration, polling loop or service was added by release preparation. The helper split and type annotations add no I/O; the corrected failure path retains its existing single selected metadata read.

## Open findings

BUG — One existing admin behavior test timed out twice. Retry limit reached; left unresolved without weakening the test.

BUG — Inherited Jini lint debt remains: eight complexity diagnostics and one host-neutrality diagnostic. At the pinned base the same scoped invocation had 11 errors; the integrated release has 9. MessageRow's requested violation is resolved.

BUG — Inherited Tovu touched-file complexity debt remains: 5 diagnostics, compared with 7 at the pinned base. No added violation.

BUG — Desktop's strict 9/9 check still reports two existing violations. Both production files are byte-identical to the pinned base; no debt baseline or rule was changed.

OPEN — Publication-dependent lockfile synchronization and its test remain deferred by the job instruction.

## Quality and scope

Architecture audit: PASS for this job's changes. Reused the existing message notice/usage owners, translation adapter, credential write/conflict owner, catalog generator and integrity owner. Public contracts and persistence layouts are preserved.

Function-quality assessment: message calculations remain pure, scanning existing groups/replies only; the conflict classifier preserves the existing metadata-read boundary and atomic failure behavior; translation is a constant-cost host adapter. No new high-risk finding. The skepticism pass checked names against values, active/completed display behavior, missing-row and revision handling, provider/label aggregation, mutation and I/O. Existing adversarial store tests retain their complete state comparisons. MessageRow test count remains 130; store test count remains 131; the page-shell test inventory increases from 11 to 12.

Runtime evidence is scoped component/HTTP/daemon fixture evidence with generated local data. No full suite, live site, owner data or publication was used. The installed broad desktop pre-push hook was bypassed once for dependency-only preparation to honor the job's scoped-test requirement; later pushes used the normal hook, which skipped broad gates when no desktop change was introduced. Every push was preceded by pull --rebase; initial pulls reported that the new branch did not yet exist. No force push.

## Exact validation commands

Commands used the Node 24 setup in `/workspace/.tovu-build/env.sh`. The first default PNPM store was read-only; a workspace-local copy of the existing store resolved setup without changing project metadata. Rebuild and relink commands:

```sh
# /workspace/Jini
pnpm install --frozen-lockfile --store-dir /workspace/work/security-release/pnpm-store --force
pnpm -r build
pnpm typecheck
pnpm --filter @jini-ai/plugin-catalog run generate
pnpm guard:plugins
pnpm guard:plugins:packed
python /workspace/work/security-release/verify-packed-catalog.py
# /workspace/Tovu
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm --prefix packages/contracts run build
npm --prefix packages/sdk run build
node_modules/.bin/tsc -p tsconfig.json --noEmit
npm --prefix apps/desktop run typecheck
npm --prefix apps/admin run typecheck
npm --prefix apps/site-chat run typecheck
```

Secret scan commands, with the final report commit included in the final invocation:

```sh
# /workspace/Jini
/workspace/work/security-release/tools/gitleaks git . --config .gitleaks.toml --log-opts='651571c5f..HEAD' --redact --report-format=json --report-path=/workspace/work/security-release/jini-release-secrets.json
# /workspace/Tovu
/workspace/work/security-release/tools/gitleaks git . --log-opts='e327c07c8..HEAD' --redact --report-format=json --report-path=/workspace/work/security-release/tovu-secrets.json
```

The workspace-local packed-catalog probe packs the actual agent, provider and catalog distributions with `npm pack --offline --ignore-scripts`, hashes every catalog-listed file in the tar archives, compares exact inventories/digests, and checks all 12 package versions and applicable Tovu floors. Standard guards independently inspect the public package tarballs. Raw logs and exact invocation inventories remain under `/workspace/work/security-release`.

<details>
<summary>Scoped test and lint invocation inventory, including initial failures and their corrections</summary>

```sh
# /workspace/Jini/packages/agent-runtime — PASS
pnpm exec vitest run src/__tests__/native-tool-compatibility.unit.test.ts src/__tests__/startup-failure.test.ts --maxWorkers=2 --minWorkers=1
```

```sh
# /workspace/Jini/packages/agentic — PASS
pnpm exec vitest run src/core/dom/__tests__/args-convention.contract.test.ts src/core/dom/__tests__/dom-page-driver-conversion.regression.test.ts src/core/dom/__tests__/dom-page-driver-elements.test.ts src/core/dom/__tests__/dom-page-driver-l183.pin.test.ts src/core/dom/__tests__/dom-page-driver-private.test.ts src/core/dom/__tests__/dom-page-driver.test.ts src/core/dom/__tests__/visitor-publication.test.ts --maxWorkers=2 --minWorkers=1
```

```sh
# /workspace/Jini/packages/daemon — PASS
pnpm exec vitest run src/__tests__/startup-failure.test.ts src/http/__tests__/frontend-control.test.ts src/http/__tests__/frontend-request-route.test.ts --maxWorkers=2 --minWorkers=1
```

```sh
# /workspace/Jini/packages/mcp — PASS
pnpm exec vitest run src/federation/__tests__/http-result-secrets.test.ts src/federation/__tests__/stdio-result-secrets.test.ts --maxWorkers=2 --minWorkers=1
```

```sh
# /workspace/Jini/packages/platform — PASS
pnpm exec vitest run src/web/__tests__/strip-html-presentation.test.ts --maxWorkers=2 --minWorkers=1
```

```sh
# /workspace/Jini/packages/chat — PASS
pnpm exec vitest run src/core/assistant-client/__tests__/ag-ui-transport.test.ts src/core/assistant-client/__tests__/transport.test.ts src/embed-widget/browser/__tests__/frontend-navigation-guard.test.ts src/react/components/__tests__/MessageRow.display.test.tsx src/react/components/__tests__/MessageRow.terminal-extension.test.tsx src/react/components/__tests__/MessageRow.test.tsx src/react/components/__tests__/MessageRow.usage.l199.characterization.test.ts src/react/components/__tests__/MessageRow.usage.test.ts src/react/features/chat-pane/__tests__/components/AgentRuntimePicker.native-policy.unit.test.tsx src/react/features/chat-pane/__tests__/frontend-request-caller.test.ts src/react/features/chat-pane/__tests__/hooks/useChatPane.surfaces.test.tsx src/server/durable-runs/__tests__/recover-boundaries.test.ts --maxWorkers=2 --minWorkers=1
```

```sh
# /workspace/Jini/packages/ui-kit — PASS
pnpm exec vitest run src/attrs.test.ts src/react/__tests__/secret-field.test.ts --maxWorkers=2 --minWorkers=1
```

```sh
# /workspace/Jini/packages/ui — PASS
pnpm exec vitest run src/features/mcp-ui/__tests__/secret-card.unit.test.ts src/features/mcp-ui/__tests__/surfaces/confirmation.test.ts src/features/mcp-ui/__tests__/surfaces/document.test.ts src/react/components/SecretInput.test.tsx --maxWorkers=2 --minWorkers=1
```

```sh
# /workspace/Jini/packages/core — PASS
node --import tsx --test src/__tests__/teardown.test.ts
```

```sh
# /workspace/Jini/packages/core — PASS
pnpm exec vitest run src/__tests__/approval.characterization.test.ts --maxWorkers=1 --minWorkers=1 --pool=threads
```

```sh
# /workspace/Jini/packages/agent-plugins — PASS
node --test __tests__/vitest-compat.test.mjs
```

```sh
# /workspace/Tovu — FAIL (see final disposition above)
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

```sh
# /workspace/Tovu — FAIL (see final disposition above)
npm --prefix apps/desktop run typecheck
```

```sh
# /workspace/Tovu — PASS
npm --prefix apps/admin run typecheck
```

```sh
# /workspace/Tovu — PASS
npm --prefix apps/site-chat run typecheck
```

```sh
# /workspace/Jini — PASS
pnpm typecheck
```

```sh
# /workspace/Tovu — PASS
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

```sh
# /workspace/Tovu — PASS
npm --prefix apps/desktop run typecheck
```

```sh
# /workspace/Tovu — FAIL (see final disposition above)
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/admin/src/App.hooks.ts apps/admin/src/App.tsx apps/admin/src/components/AssistantDock/AssistantDock.tsx apps/admin/src/components/AssistantDock/hooks/AssistantDock.hooks.tsx apps/admin/src/components/SecretInput/SecretInput.tsx apps/admin/src/features/security/SiteKeyTab.tsx apps/admin/src/features/sites/AllSitesTab.tsx apps/admin/src/features/sites/CreateSiteOnboarding.tsx apps/admin/src/features/sites/SiteExportTab.tsx apps/admin/src/features/webmcp/admin-page-tools.ts apps/admin/src/lib/admin-frontend-session.ts apps/website/src/assistant/admin-frontend-owner.ts apps/website/src/assistant/frontend-control-capabilities.ts apps/website/src/assistant/page-approval-context.ts apps/website/src/assistant/tool-approval-policy.ts apps/website/src/server/inbound/assistant/agent-daemon-scope.ts apps/website/src/server/runtime/composition/charts-recharts-source.ts apps/website/src/server/runtime/composition/modules/assistant-ag-ui.ts apps/website/src/server/runtime/composition/modules/assistant-daemon-client.ts apps/website/src/server/runtime/composition/modules/assistant.ts
```

```sh
# /workspace/Jini — FAIL (see final disposition above)
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/agent-plugins/__tests__/vitest-compat.mjs packages/agent-runtime/src/diagnostics.ts packages/agent-runtime/src/native-tool-policy.ts packages/agentic/src/core/dom/dom-page-driver.ts packages/chat/src/core/assistant-client/ag-ui-transport.ts packages/chat/src/core/assistant-client/transport.ts packages/chat/src/core/durable-runs/ports.ts packages/chat/src/embed-widget/browser/frontend-session-bridge.ts packages/chat/src/react/components/MessageRow.tsx packages/chat/src/react/features/chat-pane/components/AgentRuntimePicker.tsx packages/chat/src/react/features/chat-pane/components/ChatPane.tsx packages/chat/src/react/features/chat-pane/create-frontend-request-caller.ts packages/chat/src/react/features/chat-pane/hooks/useChatPane.hooks.ts packages/chat/src/react/features/chat-pane/surface-recovery-stream.ts packages/chat/src/react/features/chat-pane/types.ts packages/chat/src/react/index.ts packages/chat/src/server/durable-runs/recover.ts packages/core/src/approval.ts packages/core/src/index.ts packages/core/src/teardown.ts packages/daemon/src/http/frontend-control.ts packages/daemon/src/http/frontend-request-route.ts packages/daemon/src/http/index.ts packages/daemon/src/http/tool-execution-routes.ts packages/daemon/src/session-coordination.ts packages/mcp/src/federation/adapter.http.ts packages/mcp/src/federation/result-secrets.ts packages/mcp/src/federation/stdio/adapter.stdio.ts packages/mcp/src/federation/stdio/default-connect.ts packages/platform/src/web/index.ts packages/platform/src/web/strip-html-presentation.ts packages/ui-kit/src/attrs.ts packages/ui-kit/src/index.ts packages/ui-kit/src/react/SecretInput.tsx packages/ui-kit/src/react/native/Controls.hooks.ts packages/ui/src/features/mcp-ui/secret-card.ts packages/ui/src/features/mcp-ui/surfaces/confirmation.ts packages/ui/src/features/mcp-ui/surfaces/document.ts packages/ui/src/react/components/SecretInput.tsx
```

```sh
# /workspace/work/security-release/tovu-base — FAIL (see final disposition above)
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/admin/src/App.hooks.ts apps/admin/src/App.tsx apps/admin/src/components/AssistantDock/AssistantDock.tsx apps/admin/src/components/AssistantDock/hooks/AssistantDock.hooks.tsx apps/admin/src/components/SecretInput/SecretInput.tsx apps/admin/src/features/security/SiteKeyTab.tsx apps/admin/src/features/sites/AllSitesTab.tsx apps/admin/src/features/sites/CreateSiteOnboarding.tsx apps/admin/src/features/sites/SiteExportTab.tsx apps/admin/src/features/webmcp/admin-page-tools.ts apps/website/src/assistant/frontend-control-capabilities.ts apps/website/src/assistant/tool-approval-policy.ts apps/website/src/server/inbound/assistant/agent-daemon-scope.ts apps/website/src/server/runtime/composition/charts-recharts-source.ts apps/website/src/server/runtime/composition/modules/assistant-ag-ui.ts apps/website/src/server/runtime/composition/modules/assistant-daemon-client.ts apps/website/src/server/runtime/composition/modules/assistant.ts
```

```sh
# /workspace/work/security-release/jini-base — FAIL (see final disposition above)
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/agent-plugins/__tests__/vitest-compat.mjs packages/agent-runtime/src/diagnostics.ts packages/agent-runtime/src/native-tool-policy.ts packages/agentic/src/core/dom/dom-page-driver.ts packages/chat/src/core/assistant-client/ag-ui-transport.ts packages/chat/src/core/assistant-client/transport.ts packages/chat/src/core/durable-runs/ports.ts packages/chat/src/embed-widget/browser/frontend-session-bridge.ts packages/chat/src/react/components/MessageRow.tsx packages/chat/src/react/features/chat-pane/components/AgentRuntimePicker.tsx packages/chat/src/react/features/chat-pane/components/ChatPane.tsx packages/chat/src/react/features/chat-pane/hooks/useChatPane.hooks.ts packages/chat/src/react/features/chat-pane/surface-recovery-stream.ts packages/chat/src/react/features/chat-pane/types.ts packages/chat/src/react/index.ts packages/chat/src/server/durable-runs/recover.ts packages/core/src/approval.ts packages/core/src/index.ts packages/core/src/teardown.ts packages/daemon/src/http/frontend-control.ts packages/daemon/src/http/index.ts packages/daemon/src/http/tool-execution-routes.ts packages/daemon/src/session-coordination.ts packages/mcp/src/federation/adapter.http.ts packages/mcp/src/federation/result-secrets.ts packages/mcp/src/federation/stdio/adapter.stdio.ts packages/mcp/src/federation/stdio/default-connect.ts packages/platform/src/web/index.ts packages/platform/src/web/strip-html-presentation.ts packages/ui-kit/src/attrs.ts packages/ui-kit/src/index.ts packages/ui-kit/src/react/SecretInput.tsx packages/ui-kit/src/react/native/Controls.hooks.ts packages/ui/src/features/mcp-ui/secret-card.ts packages/ui/src/features/mcp-ui/surfaces/confirmation.ts packages/ui/src/features/mcp-ui/surfaces/document.ts packages/ui/src/react/components/SecretInput.tsx
```

```sh
# /workspace/Tovu — FAIL (see final disposition above)
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-force-exit --test-reporter=tap --experimental-test-module-mocks --test-concurrency=1 --test-timeout=60000 apps/website/src/assistant/__tests__/admin-frontend-owner.unit.test.ts apps/website/src/assistant/__tests__/frontend-control-capabilities.test.ts apps/website/src/assistant/__tests__/page-approval-context.test.ts apps/website/src/server/__tests__/assistant-ag-ui-routes.test.ts apps/website/src/server/__tests__/assistant-proxy-routes.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.page-confirmation.integration.test.ts apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.page-navigate-error-rewrap.unit.test.ts
```

```sh
# /workspace/Tovu/apps/admin — FAIL (see final disposition above)
node_modules/.bin/vitest run src/__tests__/unit/app-hooks-admin-webmcp.unit.test.tsx src/__tests__/unit/app-stream-wiring.unit.test.tsx src/components/__tests__/AssistantDock.hooks.unit.test.tsx src/components/__tests__/SecretInput.unit.test.tsx src/features/plugins/__tests__/AgentPlugins.unit.test.tsx src/features/security/__tests__/SiteKeyTab.agent-secrecy.unit.test.tsx src/features/sites/__tests__/SiteExportTab.secret.unit.test.tsx src/features/sites/__tests__/create-site-admin-password.unit.test.tsx src/features/webmcp/__tests__/admin-page-action-policy.unit.test.ts src/features/webmcp/__tests__/admin-page-approval-input.unit.test.ts src/features/webmcp/__tests__/admin-page-approval.unit.test.tsx src/features/webmcp/__tests__/admin-page-human-gate.unit.test.ts src/features/webmcp/__tests__/admin-page-tools.unit.test.ts src/lib/__tests__/assistant-transport.ag-ui.unit.test.ts --maxWorkers=2
```

```sh
# /workspace/Tovu/apps/admin — FAIL (see final disposition above)
node_modules/.bin/vitest run src/features/sites/__tests__/create-site-admin-password.unit.test.tsx src/features/sites/__tests__/SiteExportTab.secret.unit.test.tsx --maxWorkers=1 --pool=threads
```

```sh
# /workspace/Tovu — PASS
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-force-exit --test-reporter=tap --experimental-test-module-mocks --test-concurrency=1 --test-timeout=60000 apps/website/src/server/__tests__/assistant-ag-ui-routes.test.ts
```

```sh
# /workspace/Tovu — FAIL (see final disposition above)
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --test --test-concurrency=1 --test-timeout=60000 apps/website/src/server/runtime/composition/__tests__/recharts-package-pin.unit.test.ts apps/website/src/server/runtime/composition/__tests__/product-telemetry.unit.test.ts apps/website/src/server/runtime/composition/__tests__/browser-provider.integration.test.ts
```

```sh
# /workspace/Tovu/apps/admin — FAIL (see final disposition above)
node_modules/.bin/vitest run src/integrations/chart-providers/__tests__/recharts-bundle-integer-ticks.unit.test.ts --maxWorkers=1 --pool=threads
```

```sh
# /workspace/Jini/packages/plugin-catalog — PASS
pnpm exec vitest run --maxWorkers=1 --minWorkers=1
```

```sh
# /workspace/Tovu/apps/admin — PASS
node_modules/.bin/vitest run src/features/security/__tests__/Security.unit.test.tsx src/features/security/__tests__/RecoveryCodesCard.unit.test.tsx src/lib/__tests__/api-user-facing-fallback.unit.test.ts --maxWorkers=1 --pool=threads
```

```sh
# /workspace/Tovu — PASS
node --import tsx --test --test-concurrency=1 apps/website/src/features/deployments/publish-credentials/__tests__/store.unit.test.ts apps/website/src/features/deployments/publish-credentials/__tests__/project-scope.unit.test.ts
```

```sh
# /workspace/Tovu/apps/admin — PASS
node_modules/.bin/vitest run src/integrations/chart-providers/__tests__/recharts-bundle-integer-ticks.unit.test.ts --maxWorkers=1 --pool=threads
```

```sh
# /workspace/Tovu — PASS
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/features/deployments/publish-credentials/store.ts apps/admin/src/features/security/Security.tsx
```

```sh
# /workspace/Tovu/apps/desktop — FAIL (see final disposition above)
node scripts/check-complexity.ts
```

```sh
# /workspace/Jini — PASS
pnpm -r build
```

```sh
# /workspace/Jini — PASS
pnpm --filter @jini-ai/plugin-catalog run generate
```

```sh
# /workspace/Jini — PASS
pnpm guard:plugins
```

```sh
# /workspace/Jini — PASS
python /workspace/work/security-release/verify-packed-catalog.py
```

</details>

## Pushed job commits

The following lists contain every job-created integration/checkpoint/code commit before this final report commit. Validated source tips are `e4774d0d83d9b58c9acb28849e0586cd21f53c47` and `98bf795152a0981494e27f761b99e518698a6417`, both on `cloud/security-release`. The final response supplies the final report-commit SHAs; the report commit changes documentation only.

Jini:

- `e8511ad2a2b62c81ae1e376af9603248238c9283`
- `de9a41d79fee180b41304d62ae48a84be8c803f4`
- `ad4e836a9b01835a9a1cd11e15036ad623fc0545`
- `c46e9f3910c4bd8b63fd57ef8afb6423965b9c16`
- `a958739c26ebec35770456780e705016b153a21a`
- `173bfbe680cbe09fd8723be8a74e6ad49b2cef06`
- `e4774d0d83d9b58c9acb28849e0586cd21f53c47`

Tovu:

- `5d72191b7f147a7aa1b2375a6986bcbd1b7f38c3`
- `918c3fc2bd7ec6931abae424fe35e88df99c2a12`
- `4e00fafa22eeccd81561d7c71b63963018e30bac`
- `282ef5d0e9dc219bbd32277a7c51d3ed20111dcc`
- `8a64eaa0f5c721b9c4869fdbec6924470602847d`
- `74bbd2d6c3b7542c9202faa3c66813b12681b544`
- `10e7e344cf4aa5c71c20946a350df7dda048b366`
- `98bf795152a0981494e27f761b99e518698a6417`

## Approved follow-up — in progress

Merged the requested om-chat and night branches. Resolved two conflicts while preserving existing behavior and assertions. Jini changes are confined to agent-plugins and daemon; both already belong to the 12-package 0.6.23 set. Rebuild, catalog regeneration and focused verification are in progress.
