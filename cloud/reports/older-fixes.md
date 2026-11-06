# older-fixes — final report

Job checks completed within the two-hour cap. Delivery is partial for C21, C25 and C30, explicitly below. Only `cloud/older-fixes` is used in both repositories. No main push, force push, deployment, publication, live data or owner data. C01–C10 were skipped as instructed; no full suite was run. The fix-round exclusion list was read and its changes were not taken over.

Fetched and read `origin/cloud-plans-1105:cloud/jobs/COMMON.md`, `older-fixes.md` and `fix-round.md` using git show. Loaded the supplied Software Architect, Programmer and TDD personas. Exact-file searches used rg after checking local index availability; the available semantic index had no entries for the moved target paths.

## Branches and commits

Bases: Jini `f4e3b18a5ea67fc7531357aae05c4495dd593bea`; Tovu `c11d491f3cb2a695caa5d0f2e700581d747af735` (`origin/cloud/combine`). The final report-only commits follow the checkpoints below and are the branch heads reported in the final message.

### Jini — cloud/older-fixes

- `5b70b8bc3c998eed79b4f3bce5172c8b7ef42b1c` — docs: record older fixes job progress
- `4cbbc5a00b6452206153aaf3f04529c34a7f1b45` — fix(chat): show read offsets in collapsed tool targets
- `73be8a9b5ad835ba7e8cc7ab03144d05f1e3c750` — fix(chat): include offsets in specialized read cards
- `f1e03fbfb1b0e639ac42b39325c68dc288f8334b` — fix(cms): bound document reads and cancel PDF extraction
- `fbcb4ec9c49caf8de1fd6a37fc3108171dc36561` — fix(cms): reuse bounded document text across byte-offset pages
- `d1756821ae418c18da041a2b59b502b52922871d` — test: verify packed plugin digests and secret settings metadata
- `6c0526dfe52cd6abaf0aa2df5de218bcac3d0e10` — fix(chat): preserve file basenames when showing read offsets
- `a2245ce2e5e308e6f1002a0ce5838e544e2abd1f` — test: cover document cache bounds and read-target edge cases

### Tovu — cloud/older-fixes

- `d42c2ea71228ac54c6e861a1fb55719aa6afb882` — docs: record older fixes job progress
- `0651ec4ae62b092b831e8c41ece288edfa86377e` — fix: name export choices and distinguish export history
- `960c26ee71d20d91755f5d63a4d3a28ebd0ff44c` — fix: expose site identity and HTML content in public responses
- `c42c1c1167a5329a1a2ba3600a91e5654974a318` — fix: share media access evidence across distinct asset requests
- `f3ef03f2e0030ebdf8ec69ba8d68cba68f3bc27b` — test: trace remaining form, update, approval and preview claims
- `ba4fb6c10016b10a35bb59cc659fbdd755a2c04a` — docs: record composed plugin dependency and artifact gaps
- `821491ed3809101d136d942b78ccd9cb4422186b` — test: finalize failure-boundary probes and clock findings

## Item results

| Item | Result | Evidence / remaining work |
| --- | --- | --- |
| O01 | Fixed | Options use installed theme display titles; allocated archive paths remain unchanged. Picker already renders option names. |
| O02 | Fixed | History Type column distinguishes `.tovu.zip` backups from static ZIPs using the established filename contract. |
| O03 | Fixed | Collapsed generic and specialized Read cards include supplied integer offsets, including zero; invalid offsets and hex-looking filenames remain readable. |
| O04 | Fixed | llms.txt uses the shared site-title resolver and configured SEO description; no fabricated product summary when absent. |
| O05 | Fixed | Public HTML DTO includes bodyFormat/html and null bodyJson. Existing document payloads retain their shape; admin/private fields stay excluded. Existing body validation is reused. |
| O06 | Fixed with cancellation limit | Thirty-second read deadline, caller abort propagation, typed retry guidance, admission release and PDF teardown. Non-cooperative/custom or synchronous SDK work cannot be forcibly terminated on this thread. |
| O07 | Fixed | Subsequent offsets reuse prepared text keyed by host repositories/store/adapter, workspace, id and source hash; live ownership/status still checked each page. Two-entry/50-MiB/60-second bounds and late-completion protection tested. |
| O08 | Fixed | Distinct asset/alias misses query a shared reverse index instead of repeating the whole post scan. One cold/expired workspace rebuild still lists/scans posts once; writes/Trash invalidate it. No bodies or visitor decisions retained. |
| C11 | Not a bug in exercised contract | In-memory conditional rendition writes, replaced/missing/foreign/inactive refusals and update interleaving pass. |
| C12 | Not reproduced in individual fixtures | Durable notification jobs/retries, external/static form policy, receiver boundaries, file compensation/maintenance/purge and delayed cleanup pass. This is bounded to those fixtures, not a new broad audit. |
| C13 | Not a supported-marker bug | New fixture persists the complete page widget-marker → widget config.formDefinitionId → form chain and checks scoped reverse references. Legacy direct type:form is not supported renderer syntax. It does not certify every Trash purge policy. |
| C14 | Not reproduced | Two isolated SQLite sites publish video/poster and immediately replan unchanged; source hashes remain stable. |
| C15 | Not reproduced on recorded boundaries | 87 current scanner cases pass; no claim about unknown inputs. |
| C16 | Not reproduced | 36 retention, overwrite and restore cases pass, including empty generated-tree restore. This is not a claim that every empty parent directory is pruned. |
| C17 | Not reproduced | Failed first form-provider initialization remains listed and becomes available on reapplication. |
| C18 | Not reproduced with controlled inputs | Two native+hosted static form exports have identical extracted paths/content with clock and occurrence IDs controlled. Uncontrolled UUIDs naturally differ. |
| C19 | Not reproduced | Real Vite prebundling rebuilds after installed version/byte change with the same dependency range and retained cache. |
| C20 | Not reproduced | Two actual packed provider/agent release sets detect stale catalog digests; changed same-version agent bytes fail release checks. Update planning requires explicit replacement for equal-version/different-digest candidates. |
| C21 | Stopped: artifact unavailable | Scanner8/caller-root5 pass. This checkout has no current app.asar or complete staged production payload, so the real packaged graph cannot be certified. Produce that artifact and run apps/desktop/scripts/verify-staged-closure.ts with --asar. C25 independently exposes a real copied-payload edge. |
| C22 | Not reproduced at sampled public boundaries | Recovery authorization fault hides canaries in reply/log; manual-publish poll snapshot redacts token-shaped errors. Internal toRecoveryResult intentionally retains raw unexpected causes for its outer owner; arbitrary future consumers are not certified. |
| C23 | Not reproduced | Catalog marks secret targets/aliases unwritable and handlers refuse them. Real executor/card rejects another principal, commits only after bound caller approval and attributes revision.actor to that caller. Source trace: delegated resolvePrincipal → executor ctx.principal → exchange binding → settings writer. |
| C24 | Not reproduced in replacement implementation | Current policy context guards repeated stale-page reloads; declared scripts/frames start once and withdraw together. Publication refresh and disabled-page zero-read fixtures pass. Raw authored embeds remain explicitly unmanaged, rather than rewritten. |
| C25 | Stopped: confirmed dependency gap | Standalone provider build/artifacts pass; fresh composition yields33 manifests. Both Cloudflare targets disappear because copied lib/forms.mjs cannot resolve @jini-ai/cms/forms. Direct discovery and existing composed-root fixture reproduce the same miss. Requires a portable staged/bundled CMS evidence/validation closure; a package-version-only edit is insufficient. No retry after second identical boundary. |
| C26 | Not reproduced with deterministic ports | 85 boundary cases plus4 injected monotonic/sleep/liveness cases pass. Finite waits time out; simulated225-second live owners remain held; wall-clock aging and wait budgets are separate. Arbitrary scheduler-load conditions are not exhaustively proved. |
| C27 | Not reproduced | Throwing hooks still execute remaining reverse-order cleanup; real host/helper fixtures close resources and aggregate failures. |
| C28 | Not reproduced | 46 controller/TipTap/bus and state/version/draft-routing cases pass; this is controller evidence, not a Chrome visual review. |
| C29 | Not reproduced | 13 two-site grant/adoption/copy/guard cases pass without rewriting owner vault entries. |
| C30 | Stopped: confirmed batch preview gap | All six individual producers return previews. Production batch wrapper strips per-item image blocks while preserving two saved-media results. Fix needs a bounded top-level image envelope through shared batch/MCP/chat contracts, beyond a small ten-minute fix. Diagnostic trace does not certify omission as desired UX. |

## State and I/O cost

- O06 before: up to2 admitted reads ×50MiB of source plus extraction workspace, with an indefinite wait. After: at most2 *admitted* reads, one timer/listener per read, and a caller deadline of30 seconds. The extractor receives cancellation and PDF teardown interrupts pending parser work. A custom/SDK operation that ignores cancellation can remain pending outside admission; no hard total-memory bound is claimed for such detached work (each could retain its source). Synchronous parser work also cannot be preempted by a timer on the same thread.
- O07 before: P pages × up to50MiB source reads and P extractions. After: one source read/extraction per resident document, P small live-document metadata reads, and P × at most64KiB response text. Cache expires/evicts and can rebuild. Prepared cache adds at most50MiB total across at most2 documents for60 seconds; binary source is not cached. Cooperative transient source admission remains at most100MiB, excluding adapter workspace. No new polling.
- O08 before: A distinct asset misses × all post bodies/scan work per60 seconds. After: one snapshot refresh × all post bodies plus O(aliases + matching refs + opaque gates) per asset. Cache stores O(authored refs + opaque gates) access metadata, not bodies/session decisions; at most256 workspace indexes per repository. Cold/expired snapshot rebuild is still one listing/scan. Existing post/widget/Trash writes invalidate it.
- O04 adds two small settings/title resolutions per llms request. O01/O02/O03 add no persistent reads, writes or polling. O05 adds the actual HTML body to HTML-page response bytes without a second content-store read.

## Verification and commands

Source `/workspace/.tovu-build/env.sh` first. Jini commands ran in `/workspace/Jini`; Tovu commands in `/workspace/Tovu`. Node name filters select the requested case; cases outside those filters were not executed or modified.

Real bugs O01–O08 have failing-test evidence before implementation; no existing test, rule or check was disabled, skipped, deleted or weakened to pass. O01's old backend expectation was changed from archive folder labels to the installed display titles because that is the requested behavior. New C22/C23 probes were corrected to their real fixture contracts (polled safe error and revision.actor); existing assertions were preserved.

### Setup, types and lint

- Initial unmodified-tree builds were blocked by stale/missing installed dependencies. `CI=true pnpm install --frozen-lockfile --store-dir /workspace/.tovu-build/pnpm-store` succeeded after the default read-only cache failed. The locked install fixed setup without manifest/lockfile edits. `pnpm -r build` then completed; touched CMS/chat builds and Tovu relinking were repeated after runtime changes. The initial provider build issue belongs to fix-round and was not patched here.
- `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` refreshed Tovu's local links.
- Jini `pnpm --filter @jini-ai/cms --filter @jini-ai/chat --filter @jini-ai/core exec tsc -p tsconfig.json --noEmit --pretty false` — pass. `pnpm exec tsc -p scripts/tsconfig.json --noEmit --pretty false` — pass.
- Tovu `node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false` — pass.
- Tovu `npm --prefix apps/admin run typecheck` — two existing errors in `src/lib/__tests__/agent-plugin-choice-replay.unit.test.ts:16,52`, missing workspaceId/conversationId/preferenceRevisionSeq/selected. Unchanged by this job.
- In each repo: `git diff --name-only -z origin/cloud/combine -- '*.ts' '*.tsx' | xargs -0 -r node_modules/.bin/eslint` (Jini invoked the same binary through `pnpm exec eslint`) — Jini passes. Tovu's only error is existing `exportCredentialDetail` complexity13 in SiteExportTab.tsx; exact base via `git show origin/cloud/combine:apps/admin/src/features/sites/SiteExportTab.tsx | node_modules/.bin/eslint --stdin --stdin-filename apps/admin/src/features/sites/SiteExportTab.tsx --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'` reproduces it. No debt or suppression was added. Remaining warnings are unchanged fixture code; new canary warnings were removed by using token-shaped canaries.

### O01 — Tovu

```sh
node --import tsx --test --experimental-test-module-mocks apps/website/src/features/site-backup/__tests__/share-backend.unit.test.ts
```

Result: 12 pass.

### O02 / export UI — Tovu

```sh
npm --prefix apps/admin run test -- src/features/sites/__tests__/SiteExportTab.history.unit.test.tsx src/features/sites/__tests__/SiteExportTab.static.unit.test.tsx src/features/sites/__tests__/SiteExportTab.secret.unit.test.tsx src/features/sites/__tests__/site-transfer-credential-warnings.unit.test.tsx
```

Result: 26 pass, 1 existing failure: shows static-export scope notes and omission notices while downloading (assigned to fix-round). The new history/picker file has 2 passing tests..

### O03 — Jini

```sh
pnpm --filter @jini-ai/chat exec vitest run src/react/components/__tests__/ToolCard.batch-target.test.tsx src/react/components/__tests__/ToolCard.test.tsx
```

Result: 155 pass before six additional invalid-offset cases; batch-target alone then passed all 19. ToolCard.test.tsx is unchanged since its 142 passing cases..

### O04 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/server/inbound/public-http/routes/site/__tests__/llms.route.test.ts
```

Result: 10 pass.

### O05 — Tovu

```sh
node --import tsx --test apps/website/src/server/inbound/public-http/http/shared/__tests__/post.test.ts apps/website/src/server/http/__tests__/headless-contracts.test.ts
```

Result: 9 pass.

### O06 / O07 — Jini

```sh
pnpm --filter @jini-ai/cms exec vitest run src/media/__tests__/unit/document-text.unit.test.ts src/media/__tests__/document-read-w2g.unit.test.ts src/media/__tests__/unit/document-text-adapters.unit.test.ts src/media/__tests__/unit/unpdf-boundaries.unit.test.ts src/media/__tests__/unit/document-read-paging.unit.test.ts
```

Result: 29 pass before three additional cache-boundary cases; document-read-paging alone then passed all 10. The other four files are unchanged since their 22 passing cases..

### O08 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/server/inbound/public-http/routes/site/__tests__/media-rendition.route.test.ts apps/website/src/features/trash/__tests__/post-trash-media-evidence.integration.test.ts
```

Result: 13 pass.

### O08 affected gating — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/server/__tests__/media-rendition-gating-bypass.test.ts apps/website/src/server/__tests__/media-rendition-route.test.ts apps/website/src/server/__tests__/media-original-video-route.test.ts
```

Result: 62 pass.

### C11 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/media/__tests__/versioned-rendition.unit.test.ts
```

Result: 3 pass.

### C12 notification / cleanup — Jini

```sh
pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/notify-subscriber.test.ts src/forms/__tests__/notify-durable.test.ts src/forms/__tests__/attachment-cleanup.test.ts
```

Result: 31 pass.

### C12 storage / export — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/forms/__tests__/form-file-storage.test.ts apps/website/src/features/forms/__tests__/form-file-maintenance.test.ts apps/website/src/features/forms/__tests__/form-file-purge.test.ts apps/website/src/features/site-export/__tests__/download-forms-privacy.test.ts
```

Result: 25 pass.

### C12 receiver — Jini

```sh
node --test packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver.test.mjs packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver-edges.test.mjs
```

Result: 23 pass.

### C13 / C18 — Tovu

```sh
node --import tsx --test --experimental-test-module-mocks apps/website/src/contracts/core/entry-refs/__tests__/form-reference-chain.unit.test.ts apps/website/src/features/site-export/__tests__/hosted-forms-static.unit.test.ts
```

Result: 4 pass.

### C14 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-name-pattern='bug 44: video and poster' apps/website/src/features/media/__tests__/publish-content.apply.test.ts
```

Result: 1 selected case passes; other cases outside this focused selection were not run.

### C15 — Jini

```sh
pnpm --filter @jini-ai/chat exec vitest run src/core/__tests__/user-text-redaction.path-boundaries.test.ts src/core/__tests__/user-text-redaction.gaps.test.ts
```

Result: 87 pass.

### C16 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/theme/__tests__/theme-file-safety.test.ts apps/website/src/features/theme/__tests__/theme-restore-generated-tree.test.ts apps/website/src/features/theme/__tests__/theme-write-file-overwrite-confirmation.test.ts
```

Result: 36 pass.

### C17 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-name-pattern='form provider stays listed after its first initialization fails' apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts
```

Result: 1 selected case passes.

### C19 — Tovu

```sh
npm --prefix apps/admin run test -- __tests__/dev-jini-deps.unit.test.ts __tests__/dev-jini-prebundle.integration.test.ts
```

Result: 6 pass; actual Vite server restarted without clearing its cache.

### C20 — Jini

```sh
pnpm exec vitest run scripts/__tests__/plugin-release-consistency.test.ts
```

Result: 9 pass, including npm-packed provider and agent release sets.

### C21 — Jini

```sh
pnpm --filter @jini-ai/devops exec vitest run src/packaging/electron/__tests__/staged-closure.test.ts
```

Result: 8 pass; synthetic staged graphs, not a complete current distributable.

### C21 caller roots — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/server/__tests__/unit/bundled-agent-plugins-dir-callers.unit.test.ts
```

Result: 5 pass.

### C22 / C23 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-name-pattern='executor binds protected|unexpected manual publish|throwing instance-authorization' apps/website/src/features/settings/__tests__/settings-write-tools.test.ts apps/website/src/features/deployments/static-publish/__tests__/publish-run.unit.test.ts apps/website/src/server/__tests__/routes/recovery-restore-routes.test.ts
```

Result: 3 selected cases pass; after switching password canaries to token canaries, the two disclosure cases passed again with the narrower unexpected manual publish|throwing instance-authorization pattern.

### C23 — Jini

```sh
pnpm --filter @jini-ai/core exec vitest run src/settings/__tests__/unit/catalog-contracts.unit.test.ts src/settings/__tests__/tool-registrations.set-value.test.ts src/settings/__tests__/write-service.principal-check.test.ts
```

Result: 43 pass.

### C24 client — Jini

```sh
pnpm --filter @jini-ai/cookie-consent exec vitest run src/__tests__/context.unit.test.ts src/__tests__/frames.unit.test.ts src/__tests__/scripts.unit.test.ts
```

Result: 11 pass.

### C24 host — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/consent/__tests__/unit/declared-readiness.unit.test.ts apps/website/src/features/consent/__tests__/service.pins.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts apps/website/src/server/runtime/composition/__tests__/site-consent.ports.unit.test.ts
```

Result: 47 pass.

### C25 package build — Jini

```sh
pnpm --filter @jini-ai/provider-plugins run build
```

Result: pass from the installed locked dependency graph, without relying on a root recursive build for this invocation.

### C25 artifacts — Jini

```sh
pnpm --filter @jini-ai/provider-plugins exec vitest run src/__tests__/artifact.integration.test.ts src/__tests__/build-script.test.ts
```

Result: 33 pass, including standalone packed install/load with both host SDK ABIs.

### C25 test support — Jini

```sh
node --test packages/agent-plugins/__tests__/vitest-compat.test.mjs
```

Result: 2 pass.

### C25 composition / discovery — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks development/scripts/__tests__/compose-bundled-agent-plugins.test.ts development/scripts/__tests__/stage-selected-agent-plugin-assets.test.ts apps/website/src/features/deployments/deploy-targets/__tests__/registry.unit.test.ts
```

Result: 44 pass, 1 fail: a fresh composed root cannot resolve @jini-ai/cms from cloudflare/lib/forms.mjs; both Cloudflare targets are refused.

### C26 boundaries — Jini

```sh
pnpm --filter @jini-ai/platform exec vitest run src/fs/__tests__/file-lock.boundaries.test.ts src/fs/__tests__/file-lock.no-age-steal.test.ts src/fs/__tests__/file-lock.incomplete-holder.test.ts src/fs/__tests__/file-lock.hostname-variants.test.ts
```

Result: 85 pass.

### C26 clock — Jini

```sh
pnpm --filter @jini-ai/platform exec vitest run src/fs/__tests__/file-lock.test.ts -t 'Infinity|monotonicMs'
```

Result: 1 selected monotonic clock case passes (other case names do not contain Infinity).

### C26 liveness — Jini

```sh
pnpm --filter @jini-ai/platform exec vitest run src/fs/__tests__/file-lock.test.ts -t 'beyond 125 seconds|finite waiters'
```

Result: 3 selected cases pass using injected time/sleep, including 225 seconds of simulated live-owner wait.

### C27 core — Jini

```sh
pnpm --filter @jini-ai/core exec vitest run src/__tests__/teardown.test.ts
```

Result: 2 pass.

### C27 host — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/server/__tests__/resource-teardown.unit.test.ts apps/website/src/server/__tests__/helper-teardown.unit.test.ts apps/website/src/server/__tests__/helper-teardown.integration.test.ts
```

Result: 19 pass.

### C28 — Tovu

```sh
npm --prefix apps/admin run test -- src/features/posts/__tests__/post-editor-external-refresh.unit.test.tsx src/features/posts/__tests__/post-editor-state.rules.unit.test.ts src/features/posts/__tests__/post-editor-save.rules.unit.test.ts src/features/posts/__tests__/post-editor-new-posts-navigation.unit.test.tsx src/features/posts/__tests__/post-editor-route-key.unit.test.ts
```

Result: 46 pass.

### C29 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/project-keys/__tests__/reference-only.unit.test.ts apps/website/src/features/custom-credentials/__tests__/credential-copy-tool.test.ts
```

Result: 13 pass.

### C30 — Tovu

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/media/__tests__/media-producing-previews.test.ts
```

Result: 9 pass; diagnostic trace confirms 1 image block per single call and 0 per actual two-item batch for all six producers, while both saved-media results survive.

### C25 direct fresh-bundle trace

Ran the following from Tovu with `npm_config_cache=/workspace/work/older-fixes/npm-cache node --import tsx --input-type=module` (no vendor API calls):

```js
import { composeBundledAgentPluginRoot } from './development/scripts/compose-bundled-agent-plugins.mjs';
const { outputRoot, pluginIds } = composeBundledAgentPluginRoot({
  repoRoot: '/workspace/Tovu', outputRoot: '/workspace/work/older-fixes/composed-agent-plugins',
}, { npmCli: '/workspace/.tovu-build/node/lib/node_modules/npm/bin/npm-cli.js' });
// 33 manifests present.
import { loadBundledDeployTargetRegistry } from './apps/website/src/features/deployments/deploy-targets/registry.ts';
const registry = await loadBundledDeployTargetRegistry({ sourceRoot: outputRoot });
console.log(registry.list().map(row => row.descriptor.id), registry.refusals);
```

Both Cloudflare targets are refused at the bare CMS import. The existing registry fixture independently reproduces that exact missing edge in a fresh temporary composed root. This is not repaired by an installed workspace package being available elsewhere in the source checkout.

## Architecture and function review

Architecture audit: PASS for the implemented fixes. Generic chat formatting and document lifecycle stay in Jini; Tovu retains site identity, public DTO/wiring and its access-index derivation. Existing body validation, export job ownership, repository invalidation, parser ports and common approval/executor owners are reused. No new framework, schema, table, provider option or vendor code in core. C25/C30 require further shared-boundary work and remain stopped.

| Changed unit | Assessment | Cost / meaningful limit |
| --- | --- | --- |
| export option/history presentation | Reviewed | Existing roster/filename contracts; no extra storage state. Chrome review pending. |
| toolRowTarget / targetAtOffset / FileReadCard | Reviewed | O(argument keys) plus constant formatting; invalid offsets and literal filenames tested. |
| llms renderer/route | Reviewed | Existing O(entries log entries) sort; two small per-request settings resolutions. |
| public content DTO | Reviewed | Fixed public projection; reuses existing HTML integrity check, keeps private fields out. |
| bounded document read / parser cancellation | Reviewed with recorded limit | Two admission slots; 30-second wait; cooperative cancellation. Non-cooperative/synchronous parser caveat above remains. |
| prepared-text cache | Reviewed | At most2 entries/50MiB/60 seconds; live ownership and source identity checked; eviction/expiry/late completion tested. |
| media reverse index | Reviewed | O(posts+refs) refresh, alias/ref/opaque lookup thereafter; existing writes invalidate. Cold refresh and authored-reference memory cost disclosed. |

Function-quality skepticism checked variable meanings, expiry/invalidation races, namespace/host isolation, alias duplication, opaque gating, restored admission and delayed parser completion. The review caught and fixed the specialized-read hex-filename regression; no clean full-suite or exhaustive scale/browser claim is made. Scoped changed-function complexity passes; the unchanged admin helper remains listed.

## Chrome follow-up

- O01: open the static export picker; verify theme display titles, keyboard/mixed selection, and unchanged exported folder paths.
- O02: verify Type column labels/width and mobile export cards with backup and static rows sharing date/size.
- O03: compare collapsed generic/specialized file reads at zero/different offsets, including a hex-looking basename.

These are follow-up notes requested by the job, not a claim that Chrome visual checks ran.

## Bugs found

- O01: static choices showed allocated archive folder labels instead of theme display names — fixed.
- O02: export history lacked backup/static distinction — fixed.
- O03: collapsed read targets omitted offsets — fixed.
- O03 verification regression: literal hex-looking basenames were hidden by the first specialized-card reuse — fixed before completion.
- O04: site llms.txt advertised platform identity — fixed.
- O05: public HTML DTO omitted the HTML body — fixed.
- O06: stalled document reads could retain both admission slots indefinitely; PDF cancellation did not trigger teardown — fixed with the non-cooperative/synchronous limit recorded above.
- O07: following byte offsets reloaded/re-extracted complete source bytes — fixed.
- O08: distinct asset cache misses repeated the complete post scan — fixed for per-asset misses; one cold workspace refresh still scans once.
- C25: copied Cloudflare payload cannot resolve its CMS dependency, hiding both Cloudflare targets — open, stopped with reproducible evidence.
- C30: generic batching removes every inline media preview block while preserving saved-media results — open, requires shared envelope work.
- Existing admin test inputs omit four required approval-helper fields — listed, not fixed.
- Existing exportCredentialDetail complexity13 — listed, not fixed or suppressed.
- Existing static-export scope-notes test fails — assigned to fix-round, not changed here.

C21 is a missing verification artifact, not a new implementation-defect claim. All other unsettled conclusions are limited to the recorded fixtures/traces.

## Completion checks

Requirements re-read; changed paths reviewed; no test weakening or suppression; exact focused results recorded. Commits were pushed in logical units with pull/rebase before existing-branch pushes. The initial branch creation used an absent-branch check, then a normal push. Only cloud/older-fixes was pushed. The setup emitted an untracked legacy compatibility payload directory in Jini; it was not included in any commit. Reports are complete; C21/C25/C30 remain open as described.
