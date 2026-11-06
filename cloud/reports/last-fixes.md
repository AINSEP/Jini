# last-fixes

Completed 2026-11-06 11:43 PST, within the two-hour cap.

Branch in both repositories: `cloud/last-fixes`.

Inputs: `Jini origin/cloud-plans-1105` at `54ff434f3f3ae9e96a776c9629b53b2ee8ecaf70`, `cloud/jobs/COMMON.md` and `cloud/jobs/last-fixes.md`. Bases: Jini `01ff07e895d1f48a012f48b33ceb4ee5527c3358`, Tovu `542635a0ef1d904395a6ddc2aaa8d23808a14dcf`. Work began about 11:15 PST on 2026-11-06; the two-hour hard limit was 13:15 PST. No main push, force push, deployment, publication, live account or owner-data access.

Loaded the supplied Software Architect, Programmer and TDD personas. Existing owners and contracts were retained; no new architecture, table, option or framework was introduced. Independent code inspection covered the plugin, publishing, UI and tools changes. Review findings were corrected with regression evidence.

## Item dispositions

| Item | Result | Change or reason |
| --- | --- | --- |
| 1 | Fixed | CMS is a required agent-plugins dependency. Build emits two self-contained CMS helpers inside the existing Cloudflare payload; static local imports survive copying. Fresh composition has 33 plugins, all six targets, both Cloudflare targets and no refusals. Actual packed payload executes outside host dependencies. Parsed sweep of 34 plugin folders/96 JS modules found no remaining external package imports. |
| 2 | Fixed | Deployment Overview reads presence through startupSecretEnvironment. Consumed launch password is shown as set without revealing its value. Other moved-key readers already use the private environment; an explicitly scoped daemon environment remains scoped. |
| 3 | Fixed | Domain run rechecks consent before confirmation-token creation or publish effects. Changed readiness after the answer refuses publication. |
| 4 | Fixed | serveVirtualPage reuses withListingBatch's request assets. All four member paths are tested on/off with static and managed themes; managed themes had the same gap. |
| 5 | Requested value fixed | Only deployment_execute_static_publish's fixture confirmation changes from policy to plan, matching its owning contract and fixed-target approval. Full projection still fails on unrelated existing fixture drift listed below. |
| 6 | Fixed, test only | Export test requires the page's own loader tag or managed banner before evaluating the loader. |
| 7 | Fixed | Jini runner already records a referenced loader's 503 as a failed asset; regression retained. Tovu download export now consults existing firstExportFailure, returns ok:false, and preserves actionable failedAssets. The helper accepts the failure arrays it actually needs. |
| 8 | Fixed | Failed Stop restores the still-live owned child to supervision. Keep running replaces the revoked intent, restoring ordinary RSS limits and crash recovery while stale queued start intents stay revoked. |
| 9 | Fixed | Supported Vitest parseCLI distinguishes deliberately scoped coverage from a full run. Full test:cov retains all four 98 floors; scoped coverage exits successfully without whole-suite floors. scan.sh's unfiltered full-suite coverage invocation still receives those floors. |
| 10 | Fixed | Shared Jini batches retain all saved item results and expose at most four top-level images with a combined base64-data budget of 2,000,000 characters. Oversized previews are omitted; later small previews still fit. Nested item JSON has no image base64. |
| 11 | Fixed | Typed complete surface fixtures preserve the verifier and contextual parameter types; admin replay supplies required scope, revision and selection fields. Final test TypeScript check covers the fixtures. |
| 12 | Fixed | Split exportCredentialDetail's warning fallback and the desktop RSS fixture; the collected crash-safety row now has an exact assertion. No debt exceptions or cases removed. |
| 13 | Fixed, test only | Fixture awaits the real final job surface rather than 1,000 event-loop turns. Real export passes without increasing a timeout. |
| 14 | Fixed | Automatic choice owner emits safe stale-card refusal as rendered text_delta before callers catch it. Renderer regression proves it remains visible when the reply succeeds. Unexpected raw errors remain private. |
| 15 | Fixed | Up to three guarded cleanup attempts refresh settings and live provider ownership. Failed cleanup retains ownership for retry; restart recovery reads trusted inactive declarations without executing disabled code. Existing/new same-ID providers and newer lanes are preserved, including takeover during a CAS retry. |
| 16 | Fixed | Anonymous boundary copy says to report the error ID rather than offering unavailable Copy details. Authenticated copy envelopes remain. |
| 17 | Fixed | Approval policy and static publish reuse one localized presentation helper in the existing confirmation owner. Removed obsolete 256-index eviction and corrected its comment. |
| 18 | Fixed | Public DTO comment states bodyHtml is trusted author HTML with unresolved embed markers. |
| 19 | Fixed, test only | Fixture enables consent and exercises the shipped server-added loader, checking both its file and the actual exported page reference. |
| 20 | Fixed, separate commit | Static consent-off pages emit plain theme/plugin declared scripts with no consent runtime; empty declarations add nothing. Existing local export assets now agree with actual references. Final isolated commit `670bd898b1a8c071d3e0ee0dc61d00bbaf3e5126` includes its code/tests/refactor and was verified to revert cleanly by itself. The earlier implementation was consolidated into this final isolated unit without rewriting published history. |
| 21 | Fixed | Archive applies the authoritative selected bundled digest to every planned revision, including old copies that no longer index. Selected custom bytes remain in the export; old edited bytes remain on disk. No cleanup/deletion or manual repair. Missing/unrecorded selections still refuse ambiguity. |
| 22 | Investigated; local cause unverified | Server and context use the same cached policy and mode. Current shipped themes have no authored loader; newly constructed off-mode pages, including 404, have no tag. Older authored tags remain byte-for-byte and harmless when off. The exact observed site's old theme provenance cannot be established without owner data, which this job excludes. No pages rewritten. |
| 23 | Fixed | Cards show resource names and fixed before/after grants, with opaque IDs/revision removed from displayed rows. Frozen target, scope, revision validation, exchange and trusted-click/single-use binding remain exact. Integration test checks name/absence of internal fields and the exact principal/revision passed to the write. |
| 24 | Fixed | Canceled turns use neutral styling and plain generic cancellation. Known CLI diagnostic details remain saved but hidden from the notice; meaningful custom cancellation/recovery text remains visible. |
| 25 | Fixed | Missing/blank metadata lines are omitted; supplied IDs, versions and timestamps remain redacted and copyable. |
| 26 | Fixed | Next-turn queue label uses the existing status box. Both code paths serve distinct states: pending queue excludes liveMessageId entries; mid-run receipts represent already delivered inputs. They do not duplicate one input's label. |
| 27 | Already fixed at base | ui-kit is used only by the chat test and already declared as a workspace devDependency. Fresh baseline chat build succeeds. No dependency change made. |
| 28 | Fixed | Detail inline-size containment prevents table columns moving; desktop export actions stay together while phone cards retain wrapping. Real component/CSS Chromium probes show zero movement at 390/650/850px and same-line desktop Download/Revoke. |

## Verification

All commands below used `source /workspace/.tovu-build/env.sh`. Run Jini commands from `/workspace/Jini`, Tovu commands from `/workspace/Tovu`, and package-local commands from the stated package. Full suites are intentionally reserved for the subsequent full test job.

Baseline/setup:

- Jini: `pnpm install --frozen-lockfile`; `pnpm --no-bail -r build` — passed on the base. Initial install's read-only store failure was resolved with scoped filesystem access to the existing pnpm store/cache.
- Tovu: `npm --prefix packages/contracts run build`; `npm --prefix packages/sdk run build`; `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` — passed after the base switch.

Final builds/typechecks:

- Jini: `pnpm -r --filter @jini-ai/core --filter @jini-ai/ui --filter @jini-ai/devops --filter @jini-ai/agent-plugins run build`; `pnpm --filter @jini-ai/chat run build`; `pnpm --filter @jini-ai/agent-plugins run build` — passed, including touched-package TypeScript compilation. The last plugin build uses the final payload layout.
- Jini: `npm --prefix packages/core run typecheck`; `npm --prefix packages/ui run typecheck`; `npm --prefix packages/chat run typecheck`; `npm --prefix packages/devops run typecheck` — passed.
- Tovu: `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` — passed after final Jini builds.
- Tovu: `npx tsc -p tsconfig.json --noEmit`; `npm run typecheck:tests`; `npm --prefix apps/admin run typecheck`; `npm run typecheck -- --pretty false`; `npx tsc -p apps/desktop/tsconfig.main.json --noEmit` — all passed, including the final production and test TypeScript checks after the last source changes. The typecheck script includes E2E TypeScript, not an E2E execution.

Targeted tests:

- Jini: `pnpm exec vitest run scripts/__tests__/agent-plugin-subpaths.test.ts scripts/__tests__/check-plugin-isolation.test.ts scripts/__tests__/plugin-package-gates.test.ts` — 110 passed.
- Jini: `pnpm exec vitest run scripts/__tests__/standalone-agent-plugin.integration.test.ts -t 'subpath cloudflare|tarball passes'` — three selected packed-package cases passed; 100 unrelated cases filtered.
- Jini packages/agent-plugins: `node --test scripts/__tests__/build-cloudflare.test.mjs cloudflare/lib/__tests__/forms.test.mjs cloudflare/lib/__tests__/forms-edges.test.mjs cloudflare/worker/__tests__/forms-validation-parity.test.mjs cloudflare/targets/__tests__/forms-publish.test.mjs` — 30 passed.
- Jini packages/agent-plugins: `npm_config_cache=/workspace/work/last-fixes/npm-cache npm pack --dry-run --json --offline --ignore-scripts --workspaces=false` — includes both generated helpers. Independent actual npm pack/extraction and isolated receiver execution also passed valid/invalid submission behavior.
- Jini: `npm --prefix packages/core test -- src/__tests__/batch-tool-inputs.test.ts src/__tests__/batch-tool-outcomes.test.ts` — 56 passed.
- Jini: `npm --prefix packages/core test -- src/user-facing-error.test.ts` — 11 passed.
- Jini: `npm --prefix packages/ui test -- src/features/mcp-ui/__tests__/surfaces/access-approval.test.ts` — three passed.
- Jini: `npm --prefix packages/chat test -- src/core/__tests__/durable-projection.test.ts src/react/components/__tests__/MessageRow.test.tsx src/react/components/__tests__/MessageList.test.tsx` — 130 passed before the additional renderer regression; final MessageRow-only run `npm --prefix packages/chat test -- src/react/components/__tests__/MessageRow.test.tsx` passed 69.
- Jini: `npm --prefix packages/devops run test -- src/static-export/__tests__/runner.test.ts` — 25 passed.
- Tovu: `node --import tsx --test development/scripts/__tests__/admin-coverage-scope.test.ts` — 11 passed, including full floors and scoped selectors.
- Tovu: `npm --prefix apps/admin run test:cov -- src/lib/__tests__/version-conflict.unit.test.ts --coverage.reportsDirectory=/workspace/work/last-fixes/scoped-admin-coverage --coverage.reporter=json-summary` — seven passed, exit 0 despite 0.23% whole-source line coverage; full-run config retains 98 on every axis.
- Tovu: `npm --prefix apps/admin test -- src/lib/__tests__/agent-plugin-choice-replay.unit.test.ts` — four passed.
- Tovu: `npm --prefix apps/admin test -- --run src/features/sites/__tests__/site-transfer-tabs.unit.test.tsx src/features/sites/__tests__/SiteExportTab.static.unit.test.tsx src/features/sites/__tests__/SiteExportTab.history.unit.test.tsx` — 53 passed.
- Tovu apps/desktop: `node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test src/project-ipc.test.ts src/site-supervisor.test.ts` — 159 passed.
- Tovu consent adjacent: `node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/server/inbound/public-http/routes/site/__tests__/member-pages.route.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-consent-metadata.unit.test.ts` — 133 passed before final complexity-only extraction; final verification recorded below.
- Tovu approval policy: `node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/assistant/__tests__/tool-approval-policy.test.ts apps/website/src/assistant/__tests__/tool-approval-policy.tw3.test.ts apps/website/src/features/deployments/static-publish/__tests__/domain-publish-tool.unit.test.ts apps/website/src/features/deployments/__tests__/export-run.test.ts` — 56 passed.

Final rebuilt-consumer command (Tovu):

```sh
TOVU_G3_REAL_EXPORT=1 node --import tsx \
  --import ./development/test-support/composed-bundle-env.ts \
  --test --experimental-test-module-mocks --test-concurrency=2 \
  apps/website/src/assistant/__tests__/automatic-agent-plugins.integration.test.ts \
  apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.static-publish.integration.test.ts \
  apps/website/src/features/deployments/__tests__/export-run.test.ts \
  apps/website/src/features/deployments/__tests__/publish-agent-tools.unit.test.ts \
  apps/website/src/features/deployments/static-publish/__tests__/domain-publish-tool.unit.test.ts \
  apps/website/src/features/mail-status/__tests__/mail-status-tool.test.ts \
  apps/website/src/features/mail-status/__tests__/provider-tools.unit.test.ts \
  apps/website/src/features/site-backup/__tests__/unit/archive-extensions.unit.test.ts \
  apps/website/src/features/site-export/__tests__/site-exporter.test.ts \
  apps/website/src/server/inbound/admin-http/__tests__/dev-auth-failures.unit.test.ts \
  apps/website/src/server/inbound/admin-http/routes/system/__tests__/user-facing-failure.test.ts \
  apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts \
  apps/website/src/server/inbound/public-http/routes/site/__tests__/member-pages.route.test.ts \
  apps/website/src/server/runtime/boot/__tests__/startup-secrets.unit.test.ts \
  apps/website/src/server/runtime/composition/__tests__/site-mailer.unit.test.ts
```

**Final result: 328 passed, 0 failed, 0 canceled, 0 skipped.** Real export was enabled. The final consent refactor also separately passed 47/47 member/declaration tests. Final all-changed-production strict lint passed: Jini 10 files at 10; Tovu 18 files at 10; desktop one file at 9. Both cyclomatic and cognitive limits were checked.

Known remaining red check (Tovu): `node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-name-pattern='projected search' apps/website/src/assistant/__tests__/tool-metadata-projections.test.ts` — fails on the independent missing forms_list_providers fixture entry. The requested static-publish confirmation value matches its contract. Full mismatch inventory is under Bugs found.

Chromium component layout: `node /workspace/work/last-fixes/export-layout-probe.mjs green 650` and `node /workspace/work/last-fixes/export-layout-probe.mjs green 850` — zero column shift and same-line desktop actions. Independent 390px probe also passed. These use real React-rendered component markup and application CSS; they are not a full running-site Chrome walkthrough.

Rollback check in the disposable clean push checkout: `git revert --no-commit 670bd898b && git diff --cached --check` — passed, exactly the four item 20 code/test files; then reset only that disposable checkout to the unchanged source head before push.

All changed production TypeScript/MJS files were checked with ESLint `--no-inline-config` and explicit cyclomatic/cognitive ceilings: 9 for desktop, 10 elsewhere. No eslint-disable or debt entries. Existing unrelated style warnings remain. Required desktop metric runner was used first; its cognitive parser was unavailable, so strict ESLint supplied actual ceiling evidence. No coverage floors lowered, tests disabled/deleted, or assertions weakened to manufacture a pass. Display assertions changed to the requested human-readable contract while exact approval binding checks remain.

Red-before-fix evidence covered missing member assets (static and managed), static-off scripts, domain consent after answer, 503 asset completeness, batch previews, startup presence, failed Stop supervision, scoped coverage, stale-card visibility, disable cleanup conflicts/restart/ownership takeover, and cancellation/metadata display. A final rebuilt-consumer run initially passed 327/328; its old approval test expected removed internal IDs. It now requires the resource name and absence of internal fields while retaining exact principal/revision write assertions.

## State cost

- Domain publication adds one existing consent deploymentCheck after the human answers. No polling.
- Static construction combines theme scripts with an existing cached declaration promise; no new storage I/O, writes or refresh interval.
- Batch results add at most four previews and 2,000,000 base64 data characters; every saved item result remains.
- Plugin disable uses one ownership catalog read and at most three cleanup catalog/snapshot/guarded-write attempts. Inactive trusted metadata is read only for missing-provider retry recovery. Pending ownership is failure-only and removed on success/re-enable. No persisted schema/state or poller added.
- Archive selection remains a planned-file pass plus the existing ledger read. Old copies are never rewritten or deleted.
- Cloudflare generates two small helper bundles once per package build; no runtime dependency installation.

## Bugs found

- FIXED: copied Cloudflare payload lacked a portable CMS dependency closure (1).
- FIXED: Deployment Overview lost startup password presence (2).
- FIXED: custom-domain approval used stale consent readiness (3).
- FIXED: both static and managed member pages omitted consent assets (4).
- FIXED: static-publish metadata fixture used the old confirmation policy (5).
- FIXED: export test could pass without a consent reference on the page (6).
- FIXED: download export reported success despite a failed consent asset (7).
- FIXED: failed Stop removed the live child from supervision as well as revoking restart intent (8).
- FIXED: scoped admin coverage was judged against full-suite floors (9).
- FIXED: shared batch results lost inline previews (10).
- FIXED: approval fixture type contracts were stale (11).
- FIXED: identified export/desktop units exceeded the required complexity ceiling (12).
- FIXED: real export outlived the test's arbitrary event-loop count (13).
- FIXED: stale plugin choice errors were swallowed, and generic status messages were not visibly rendered (14).
- FIXED: partial disable/cleanup could strand lanes; retry recovery could clear newer same-ID ownership (15).
- FIXED: anonymous failures offered nonexistent details (16).
- FIXED: duplicated confirmation presentation and obsolete cache eviction remained (17).
- FIXED: public HTML trust/marker contract was incomplete (18).
- FIXED: test fixture reintroduced a retired authored loader tag (19).
- FIXED: consent-off static pages dropped declared scripts while export still copied local declarations (20).
- FIXED: unindexable retained bundled revisions blocked all exports (21).
- UNVERIFIED: exact provenance of the observed off-mode loader tag on the older local site (22); no current server mismatch reproduced, legacy tag harmlessness proved.
- FIXED: approval cards displayed opaque binding identifiers (23).
- FIXED: cancellation appeared as an error with process diagnostics (24); review also corrected overbroad suppression of meaningful recovery text.
- FIXED: absent error metadata printed Unavailable (25).
- FIXED: the second queue state lacked the selected status-box style (26).
- ALREADY FIXED: chat's test-only ui-kit dependency (27).
- FIXED: export file-list expansion shifted columns and wrapped Revoke (28).
- OPEN, unchanged: metadata fixture additionally lacks forms_list_providers in keywords/queries/approvals; newsletter_create_campaign query differs; approvals also lack commerce_get_status, commerce_create_product, commerce_create_price and commerce_resolve_unknown. Full projection test remains red on this pre-existing drift. Only the requested single value was refreshed; commerce is on hold.
- OPEN, unchanged: CLI `apps/website/src/cli/commands/export.ts` exits successfully for asset-only failures, though it prints them. Download export status is fixed; the separate CLI finding is outside this job's requested edit.
- OPEN, unchanged: v1 mail descriptor IDs permit hyphens but the shared provider registry only accepts lowercase alphanumeric/underscore IDs. Found while constructing an ownership fixture; final fixtures use valid IDs.
- Minor documentation finding, unchanged: the admin Vitest config example names absent format-timestamp.unit.test.ts.

## Remaining limits

Full suites and full-app Chrome review are the subsequent steps specified by the job. All tracked source changes are committed. An unrelated untracked packages/plugin-ui-ux-design compatibility/build remainder exposed after the base switch was excluded from commits. Bounded real Chromium component/CSS probes passed; no running owner-site walkthrough, deployment or native Windows execution is claimed. Current source uses file URLs and local module paths without separator-sensitive rewriting. Reports and code were pushed only to cloud/last-fixes; every push used a pull/rebase check first, from isolated clean push worktrees so active source edits were not stashed.

## Source commits pushed

Every commit below was pushed only to `cloud/last-fixes` in its named repository. The final report-only commit is identified in the final response.

### Jini

```text
3f61de62a docs: track final fixes in progress
4698d16f1 fix: clarify approval and chat status messages
adefd17fa fix: share export failure checks with partial reports
c533a4e56 fix: bundle declared Cloudflare payload dependencies
f3c446ab0 test: verify copied Cloudflare payloads are self contained
78566bd7f fix: preserve bounded image previews in batch results
4a30c09ff fix: preserve meaningful cancellation explanations
121566c88 test: verify plugin refusals remain visible in chat
03d1710af fix: keep portable helpers in the shipped plugin payload
```

### Tovu

```text
6dfb80fe6 docs: track final fixes in progress
8292007cd fix: include consent assets on member pages
1ea15bcb4 fix: read startup secrets in deployment status
e0f9abc0d fix: retain supervision after a failed site stop
306b0b542 fix: load declared scripts when consent is off
ed39a009a test: keep coverage config checks in node harness
fb419c89a fix: provide useful error details at admin boundaries
2eb49e1b8 fix: recheck domain publish consent and export failures
e8a0d9053 fix: export the selected bundled plugin revision
db666c012 test: verify exported consent pages and job completion
6f88e5db5 fix: keep export table layout stable
c728f9a56 test: type the member consent store fixture
c871ee362 fix: show stale plugin choice refusals
8876a7e3c test: align approval fixtures with current contracts
5c920ebf9 fix: recover mail selections safely after plugin disable
13fc71016 fix: recheck mail provider ownership during cleanup retries
87125c4f6 test: verify named approval resources and exact write binding
acfb8acbc refactor: keep consent document construction within complexity limits
fe3c87e15 refactor: isolate static declared script delivery
670bd898b fix: load declared scripts without consent
```
