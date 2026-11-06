# full-tests — stopped at the hard cap

Both repositories use `cloud/combine`. No main, force, deployment or publication action was performed; `cloud/ui-fixes` was not fetched, merged or cherry-picked. Started around 06:54 UTC; tests are stopped by 08:52 UTC to finish reporting and pushes within the two-hour cap. Report snapshot: 2026-11-06 08:52:53 UTC.

**Full validation is incomplete. No final all-green suite result is claimed.** The initial Jini recursive command finished with failures; discovered fixes were verified with fresh affected checks. Tovu's full root run is interrupted at the cap, so later sequential suites have not been reached.

Implementation heads before this report commit:

| Repository | Branch | SHA |
|---|---|---|
| Jini | cloud/combine | `7c7552493de563e2202bc80d4e6b453b78b66f46` |
| Tovu | cloud/combine | `4cda8591798dae4f7e0eaaebea881bb5406bbefc` |

The final chat gives the report-inclusive pushed branch tips. Starting combined source heads: Jini `95dd3f8ae`, Tovu `8f0232b9d`.

## Full-suite results and exact commands

All commands source `/workspace/.tovu-build/env.sh`. Network/loopback permission was enabled. Worker bounds protect the container; no product budget or test timeout changed.

| Suite / command | Outcome |
|---|---|
| Jini: `pnpm -r --workspace-concurrency=1 --no-bail --if-present run test --maxWorkers=2 --minWorkers=1` | Exit1, 3,428.39s; **51,235 Vitest passed, 75 failed, 3 existing skipped**; separate Node Commerce stage **52 passed**. Also collection/worker/command errors described below. |
| Tovu root, including website, packages, site-chat and development tests: `TEST_CONCURRENCY=2 npm run test:ci` | Cap interruption; partial top-level TAP outcomes: **5991 ok / 80 not-ok**, 7 explicit skips among those ok records. These are partial reported outcomes, not a completed suite total. |
| `npm --prefix apps/admin run test:cov -- --maxWorkers=2 --minWorkers=1` | Not reached before cap |
| `TEST_CONCURRENCY=2 npm --prefix apps/site-chat test` | Full standalone suite not reached; 39 affected recovery tests and site-chat typecheck passed separately |
| `npm --prefix apps/desktop run gates` | Not reached before cap; tests/typecheck/coverage/complexity gates are not claimed |
| `npm run typecheck` | Full script including e2e not reached; direct production compiler passed separately |
| `npm --prefix apps/admin run typecheck` | Not reached before cap |
| `npm --prefix apps/site-chat run typecheck` | Passed as an affected check |
| `npm run complexity` | Full scan not reached; strict touched-production checks passed |
| `TEST_CONCURRENCY=2 npm run test:cov` | Not reached before cap |
| `npm run typecheck:tests` | Direct equivalent measured76 existing diagnostics; normalized comparison after boundary work added0/removed0. Final follow-up status below. |

Website has no separate package.json: the root script supplies its complete test glob. Full suites were scheduled one at a time. Affected regression checks and compilation ran during repair work.

Initial command limitations: global worker arguments duplicated flags already in Commerce and Search scripts. Corrected commands, without changing tests: `pnpm --filter @jini-ai/commerce exec vitest run -c vitest.kernel.config.ts --maxWorkers=2 --minWorkers=1` — **1,406 passed / one existing skipped**; `VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 pnpm --filter @jini-ai/search run test` — **320 passed**. Future recursive runs should use these environment bounds without appending duplicate arguments.

The diagnostics worker was terminated after more than five minutes in the unchanged1MiB regression. Its initial attempt was incomplete; the repaired **full diagnostics retry passed58 files/956 tests**: `pnpm --filter @jini-ai/diagnostics exec vitest run --maxWorkers=2 --minWorkers=1`.

A Tovu visitor-confirmation child also stalled more than five minutes and was terminated so the run could proceed. Its repaired complete file passes9 tests, and adjacent confirmation consumers pass50 tests. The root run retains the original interruption/failures; no retrospective green result is substituted.

## Requested findings

| Finding | Cause and repair | Fresh evidence |
|---|---|---|
| Provider pin/build no longer shipped | Recharts0.6.23 was absent; pinned reviewed0.6.24. All68 digests verified; executable JS/CSS/server hashes unchanged, only2 attribution hashes changed. Trust checks retained. |37 focused passes |
| In-memory raster media | Versioned memory adapter lacked atomic `saveRenditionIfSource`; implemented source CAS and shared rendition-store wiring. Production SQLite already had it. |8 memory/admission units,63 media route tests |
| Form admission budgets | Source admission counts bot requests; domain allowance does not. Native refusal wrongly returned JSON instead of safe PRG. Both budgets retained; redirect fixed, exact JSON preserved; fixture independently verifies both budgets. |40 form-route passes |
| Outdated launch fixtures | Independent personal-MCP decisions were missing. Fixtures now state them. Simulated Claude fixtures reuse the existing test-only isolation attestation; no real CLI support is invented. Codex grants personal MCP independently. |62 initial launch passes; later84 daemon +15 unchanged policy controls |
| Form-handler log assertion | Production intentionally logs formatted/redacted strings. Exact expected formatted error replaces stale raw Error expectation. |24 handler passes |
| Package identity | Reviewed manifests add five Jini publisher identities; explicit expected map corrected. | Included in37 provider passes |
| Bundled integrity warnings | Obsolete reviewed pin caused Recharts integrity warnings. Separate copied Cloudflare fixture lived outside actual bundled dependency ancestry; staging under host node_modules/.cache fixes peer resolution without hooks/symlinks/trust weakening. | Full static-publish4/4, all6 provider assertions retained |
| Cookie client headroom | Necessary stale-page guard consumed size margin. Removed redundant wrapper overhead while retaining guard, size budget and complexity ceilings. |4,563 gzip bytes,45B headroom under4,608B and unchanged32B assertion;52 passes/typecheck/lint |

## Additional fixes and validation

- Commerce status/catalog tools lacked approval classifications and could stop app boot. Added explicit policies; unknown tools remain fail-closed. Added missing theme disclosure copy.40 focused approval/boot tests and10 composition tests pass.
- Split createRouteDeps/createApp/composeSiteRouteDeps within existing composition ownership. Strict complexity/cognitive limits pass; no debt entry or suppression.
- CMS Widgets imported Forms runtime implementations. Moved shared pure collection/schema projection into existing CMS core; Forms public reexports and submission-write ownership remain.132 isolation/provider/schema checks +22 resolver checks pass. Corrected schema/log/changelog fixtures.
- Diagnostics URL matching rescanned dashed runs quadratically. Delimiter-first discovery retains original scheme grammar/output/counts/idempotence;33,770 old/new comparisons match. Original1MiB test retained; full956-test package passes. PEM snapshot now matches existing whole-body redaction with complete/truncated body checks.
- Confirmed queued input receipts were lost while a carrier was pending. Retained confirmed receipts while excluding drafts/optimistic receipts. Original ChatPane case unchanged. Collapsed ToolCard summary was HTML-hidden from the real public reader; reused existing accessible styling outside the panel, with caps/redaction intact.124 main +154 adjacent passes.
- Passkey browser types crossed into server declarations. Shared neutral type moved to existing core with old server reexport; boundary unchanged.26 passes/typecheck/build.
- Feature modules imported assistant effects and sibling persistence implementations. Existing conditional writer now arrives through an injected MCP port; pure access projections/error identity have shared contract ownership. Existing roster notifier carries lowering decisions.45 affected files include required fixture bindings.11 guard/Stop +71 access +300 adapter/store +13 source-runtime checks pass; production typecheck passes.
- Gemini projection emitted unsupported boolean/number literal enums. Kept native scalar types, explicit Allowed-values guidance, and original host schema validation; no grant policy change.140 Jini and43 Tovu schema/provider/grant checks pass.
- Restore approval class remains unchanged. Batch guard recognizes explicit direct policy while pinning complete-plan mode; conditionally activating duplication is single-call. Theme-import fixture matches owner commits20871ad239/27ba3c762: retain completed effects, stop on execution refusal, safe retry.77 batching/peer/approval checks pass. Active-site provider inventory remains available; unsupported peer live-registry reads are classified honestly.
- Inventory fixtures now install fake Claude on PATH; keyword fixtures use the composed bundle; default Anthropic URL is observed through the existing discovery seam without DNS/guard bypass.42 passes under unchanged timeouts.
- Browser recovery fixture restores missing DOM Text. Confirmation fixtures await actual emission notifications rather than assuming synchronous emission.39 recovery and50 confirmation passes; publication/identity/capacity/replay/expiry checks retained.
- Other corrections preserve exact current sanitized diagnostics, package surfaces, private secret-control markers, default opaque controls, frozen migration history and full CLI asset/command inventories. Platform93, DB38, UI112+35, Admin50+7, MCP177, Server35, plugin116+2, mirrored federation50, persistence4+1, CLI3 and theme/search28 focused passes.

## Setup, limits and remaining work

Frozen Jini dependencies restored; clean complete recursive build passed. Tovu contracts/SDK builds and Jini relink passed. Changed Jini packages rebuilt and relinked after source changes. PostgreSQL used disposable tests only. No owner/live data was used.

- The full suites are not all green. Tovu root remains incomplete, its current failed outcomes are preserved, and later full suites/gates were not reached. Fresh affected checks do not replace a final full run.
- Reference-web Vitest collects two node:test browser files and reports no suite. Correct `node --test examples/reference-web/e2e/chat-layout.test.mjs examples/reference-web/e2e/composer-hit-targets.test.mjs` executes3 cases, all failing because Playwright is unavailable. No browser check was disabled or excluded.
- Scratch cases require explicit `/var/tmp` write permission. Unchanged6 agent-runtime scratch cases pass with that permission. Two PGlite socket timeouts passed unchanged isolated retries in4,948ms/4,777ms, under the original30,000ms limit. No full socket retry is claimed.
- Test-only compiler retains76 fixture diagnostics. It is not green. The normalized before/after boundary comparison is exact. No assertion, guard, budget, coverage exclusion, lint rule or timeout was weakened to manufacture passing results.
- Minor listed only: SourceConfigField and ConfirmDialog production JSDoc describe old secret/omitted-handle behavior. Pre-existing untracked Jini packages/plugin-ui-ux-design leftovers remain untouched.
- Automatic review rejected a restore-class downgrade before execution; final class is unchanged. A stale fresh-card assertion was accepted only after direct existing-policy evidence and now asserts the fresh owner-bound card.

Raw logs and exact focused commands/causes are in `/workspace/work/full-tests/`, including boundaries-handoff.txt, interactions-handoff.md and investigation notes. They remain in this execution workspace. Initial per-package counts follow; these are not final green claims.

## Initial Jini per-package reported results

| Initial script | Passed | Failed | Existing skipped | Failed files |
|---|---:|---:|---:|---:|
| @jini-app/nlweb-demo@0.0.0 | 18 | 0 | 0 | 0 |
| @jini-ai/cookie-consent@0.6.19 | 173 | 1 | 0 | 1 |
| @jini-ai/core@0.6.23 | 1851 | 0 | 0 | 1 |
| @jini-ai/memory@0.6.19 | 332 | 0 | 0 | 0 |
| @jini-ai/plugin-catalog@0.6.24 | 65 | 0 | 0 | 0 |
| @jini-ai/protocol@0.6.19 | 106 | 0 | 0 | 0 |
| @jini-ai/sandbox@0.6.19 | 132 | 0 | 0 | 0 |
| @jini-ai/ui-kit@0.6.23 | 224 | 0 | 0 | 0 |
| @jini-ai/agentic@0.6.23 | 1555 | 0 | 0 | 0 |
| @jini-ai/artifacts@0.6.19 | 204 | 0 | 0 | 0 |
| @jini-ai/desktop-host@0.6.19 | 688 | 0 | 1 | 0 |
| @jini-ai/platform@0.6.23 | 3069 | 5 | 0 | 5 |
| @jini-app/reference-desktop@0.0.6 | 4 | 0 | 0 | 0 |
| @jini-ai/capability-providers@0.6.19 | 198 | 0 | 0 | 0 |
| @jini-ai/db@0.6.19 | 733 | 2 | 0 | 2 |
| @jini-ai/http-kit@0.6.22 | 579 | 0 | 0 | 0 |
| @jini-ai/oauth@0.6.19 | 714 | 0 | 0 | 0 |
| @jini-ai/sidecar@0.6.22 | 247 | 0 | 0 | 0 |
| @jini-ai/vibecoding@0.6.19 | 360 | 0 | 0 | 0 |
| @jini-ai/cli@0.6.19 | 575 | 0 | 0 | 0 |
| @jini-ai/cms@0.6.22 | 3948 | 5 | 0 | 5 |
| @jini-ai/infra@0.6.19 | 144 | 0 | 0 | 0 |
| @jini-ai/integrations@0.6.19 | 1981 | 0 | 0 | 0 |
| @jini-ai/plugins@0.6.22 | 776 | 0 | 0 | 0 |
| @jini-ai/registry@0.6.19 | 355 | 0 | 0 | 0 |
| @jini-ai/agent-runtime@0.6.23 | 4283 | 6 | 0 | 2 |
| @jini-ai/cms-forms@0.6.19 | 156 | 1 | 0 | 1 |
| @jini-ai/plugin-fixture-provider@0.6.19 | 2 | 0 | 0 | 0 |
| @jini-ai/analytics@0.6.22 | 197 | 0 | 0 | 0 |
| @jini-ai/ui@0.6.23 | 8852 | 12 | 0 | 7 |
| @jini-ai/commerce@0.6.19 | 10 | 0 | 0 | 0 |
| @jini-ai/diagnostics@0.6.22 | 916 | 1 | 0 | 1 |
| @jini-ai/agent-plugins@0.6.24 | 1577 | 4 | 0 | 4 |
| @jini-ai/chat@0.6.23 | 4203 | 5 | 1 | 4 |
| @jini-ai/provider-plugins@0.6.24 | 806 | 0 | 0 | 0 |
| @jini-ai/admin@0.6.22 | 2841 | 3 | 0 | 3 |
| @jini-ai/daemon@0.6.23 | 4032 | 20 | 1 | 4 |
| @jini-ai/search@0.6.19 | 0 | 0 | 0 | 0 |
| @jini-ai/devops@0.6.22 | 1084 | 0 | 0 | 0 |
| @jini-ai/mcp@0.6.23 | 1549 | 6 | 0 | 4 |
| @jini-ai/server@0.6.19 | 471 | 1 | 0 | 1 |
| @jini-ai/sqlite@0.6.19 | 7 | 2 | 0 | 2 |
| @jini-ai/user-management@0.6.22 | 1161 | 1 | 0 | 1 |
| @jini-example/minimal-host@0.0.6 | 3 | 0 | 0 | 0 |
| @jini-app/reference-web@0.0.6 | 54 | 0 | 0 | 2 |

## Commit ledger

### Jini

```text
ff678e576 docs: record full test work in progress
980d5a6f6 fix: restore consent bundle margin and teardown test discovery
11af92376 fix: retain consent quality limits and align launch fixtures
9477344f3 docs: record full test checkpoint
58ec48b5d test: establish file modes and refresh platform export contracts
8ded65a7d test: align database adapter isolation and redacted diagnostics
d42c0b517 test: align form resolver and formatted comment diagnostics
4dc688296 test: verify formatted OAuth callback diagnostics
1a44395a0 fix: preserve CMS runtime boundaries for form rendering
e53485858 docs: record recursive suite repairs in progress
1026380e6 test: align secret controls with private addressing policy
28bac3358 test: refresh UI entry and diagnostic expectations
82d1d8878 docs: record UI and test runner verification progress
07b54b045 test: verify full PEM redaction across diagnostics APIs
5dbb5630a fix: bound URL credential scanning on long diagnostic text
d0f9d734c test: align plugin discovery and frozen fixture contracts
b0b056a28 docs: record redaction performance repair and suite progress
452b68dde fix: retain accepted queue recall and readable tool summaries
bc5c68649 docs: record chat fixes and remaining suite progress
7a240f816 test: align dialog and root key privacy expectations
106d65d8a test: align MCP parsing and sanitized lifecycle diagnostics
1f9596eb4 fix: keep passkey browser types in shared core
5de1a695d fix: align compatibility package release metadata
8fb9c5dfa test: declare independent launch capabilities in filesystem fixtures
0800f8700 fix: project literal constraints into valid Gemini schemas
7c7552493 docs: record initial full suite and focused repairs
```

### Tovu

```text
74a9c9848 docs: record full test work in progress
462891e2e refactor: keep application composition within complexity limits
4a05e1659 fix: align reviewed provider artifact and package identities
4ad3c2fcc fix: complete tool approval metadata and align startup fixtures
9b078105c docs: record full test checkpoint
b032c1b82 fix: complete memory renditions and native form refusal responses
31a46e64d docs: record recursive suite repairs in progress
d69f966e8 docs: record UI and test runner verification progress
f75e565b8 docs: record redaction performance repair and suite progress
d0de01d25 docs: record chat fixes and remaining suite progress
9d000b80a test: align inventory and browser fixtures with current ports
5d8a7b2a3 test: exercise published consent and current MCP recovery
ddbaf67ae docs: record full run outcomes and remaining validation
49a3f1233 fix: align provider schemas and tool execution contracts
cfd7e662b test: await actual visitor confirmation emissions
9859ff3d8 fix: inject plugin access effects through existing host ports
a95aa5333 test: stage bundled plugin fixtures within host dependency layout
9863cc2a5 fix: clarify announcement discovery and containment expectations
4cda85917 test: align shipped CLI and persistence fixture contracts
```


### Final compiler follow-up

- `final-production-typecheck.log`: 0 emitted diagnostics; process completion is recorded separately, empty output alone is not a pass claim.
- `final-test-typecheck.log`: 76 emitted diagnostics; process completion is recorded separately, empty output alone is not a pass claim.

Final compiler commands: `node_modules/.bin/tsc -p tsconfig.json --noEmit` — exit0; `NODE_OPTIONS=--max-old-space-size=6144 node_modules/.bin/tsc -p tsconfig.tests.json --noEmit` — exit2,76 diagnostics, normalized Added0 against the76-diagnostic earlier snapshot. No final green test-typecheck claim.

## Recorded incomplete-root failures

These remain recorded failures from the interrupted run, including cases subsequently fixed and verified in focused checks. Newly reached failures not covered above are untriaged at the cap. Exact names/locations are in tovu-recorded-failures.json in the execution workspace.

- apps/site-chat/src/__tests__/visitor-page-control.recovery.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/_tmp-full-sweep.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/agents.test.ts: 5 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/approval-single-path.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/automatic-agent-plugins.integration.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/batch-tool-inputs.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/byok-google-catalog.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/cross-site-read-catalog.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/declared-tool-keywords-lazy.contract.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/declared-tool-keywords.contract.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/domain-no-direct-tool-registration.boundary.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/external-mcp-federation-runtime.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/live-model-cache.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/mcp-federation.bootstrap.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/mcp-ui-allowlist-completeness.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.static-publish.integration.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/mcp-ui-tool-calls.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/newsletter-delivery-search-discoverability.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/newsletter-draft-discovery.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/tool-catalog-audit.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/tool-contribution-registry.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/tool-metadata-projections.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/tool-registrations.contracts.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/tool-registrations.forms.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/tool-registrations.themes-reset-copy.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/__tests__/tool-search-keywords.operator-requests.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/mcp-federation/__tests__/registrations.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/persistence/__tests__/ddl-parity.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/persistence/__tests__/release-manifests.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/assistant/site/__tests__/visitor-confirmations.unit.test.ts: 6 recorded not-ok outcomes.
- apps/website/src/cli/__tests__/integration/export-command.integration.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/cli/__tests__/integration/introspect-command.integration.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/cli/__tests__/integration/serve-command-boot-lifecycle.integration.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/cli/__tests__/integration/serve-command.integration.test.ts: 5 recorded not-ok outcomes.
- apps/website/src/contracts/core/__tests__/unit/secret-patterns.boundaries.unit.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/features/agent-plugins/__tests__/manifest.default-tools-read.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/features/agent-plugins/__tests__/unit/bundled-deploy-package.unit.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/features/agent-plugins/__tests__/unit/bundled-higgsfield-video-docs.unit.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/features/agent-plugins/__tests__/unit/bundled-ui-ux-design-package.unit.test.ts: 4 recorded not-ok outcomes.
- apps/website/src/features/agent-plugins/__tests__/unit/connect-tool.api-connections.unit.test.ts: 12 recorded not-ok outcomes.
- apps/website/src/features/agent-plugins/__tests__/unit/plugin-embed-render.test.ts: 2 recorded not-ok outcomes.
- apps/website/src/features/agent-plugins/__tests__/unit/tool-registrations.unit.test.ts: 1 recorded not-ok outcomes.
- apps/website/src/features/api-connections/__tests__/vendor-neutrality.test.ts: 1 recorded not-ok outcomes.

Hard cap honored: remaining work is reported, not continued. END.
