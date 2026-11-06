# small-fixes — completed

Implementation complete for the five assigned items. Focused validation has the baseline failures listed below; this is not an all-green test claim. All new behavior regressions pass. No tests were disabled, skipped, deleted, or weakened. Existing expected limits/cache assertions were updated to the requested contracts, with boundary and security checks retained.

Started 2026-11-06 02:55 UTC; completed within the two-hour cap. Branch in both repositories: `cloud/small-fixes`. Only that branch was pushed. No main/combine push, force-push, deployment, tag, or publication.

## Bases and implementation commits

- Jini base: current fetched `origin/cloud/combine`, `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`.
- Tovu base: current fetched `origin/cloud/combine`, `5358aa594fb6e8c0ca107b1106fbf9ae43871d50`.
- Jini implementation head: `ec8871171975ad4937be9171c3da91d22198d897`.
- Tovu implementation head: `254f9b7d91ef4a0f0e004f4a70389b70a57c0833`.
- The final report-only commit is the final branch HEAD; its SHA is provided in the completion message, avoiding a self-referential report hash.

Use these paired branches together. Jini was rebuilt and Tovu relinked to `/workspace/Jini/packages`; no package versions were published.

## Assigned outcomes

1. **Large choice answers — fixed.** `selectedAnswerText` appends labels iteratively rather than spreading a caller-sized array into `push`. A 200,000-selection test reproduces the prior stack overflow and verifies exact order/text after the fix. No truncation was introduced.
2. **DeepSeek auth classification — fixed.** `DEEPSEEK_API_KEY` no longer matches the problem pattern merely through its own `API_KEY` substring. Bare/loaded key mentions, including rate-limit and upstream messages, do not imply missing auth. Actual missing/invalid/auth-required messages still match.
3. **Upload/extraction limits — fixed.** Jini's `MAX_DOCUMENT_BYTES` is the shared inclusive 50 MiB policy. Tovu's upload constant aliases it; admission, source reads, PDF/Word extraction and host validation agree. Oversize errors name the limit, and PDF oversize refuses before loading the optional parser. Local Library and media attachment reads reuse the existing guarded streaming reader, including growth-after-stat protection. Library copy batches now admit one maximum-size document (50 MiB/file and batch); other copy destinations retain their 25 MiB batch cap. Image/video defaults for other Jini consumers remain 10 MiB. Archive expansion/entry/ratio safeguards remain independently bounded at 40 MiB/2048 entries/100:1.
4. **Disabled plugin guidance — fixed.** Off plugins retain searchable skill/capability/MCP-identity metadata and an explicit guidance pointer, marked off. The host requests read-only guidance through the existing resolver with `allowInactiveGuidance`; default pinned-run resolution still refuses off plugins. Trust, unreadable-activation, chat exclusion and Ask-consent checks remain enforced. Off guidance returns `installed-but-inactive`, never records the plugin as in use, and never enables its tools. Existing execution/revocation security tests pass.
5. **Replaced media — fixed prospectively.** Public rendition URLs always revalidate (`public, no-cache`), including matching/stale version queries, stable ids and current/retired slugs. Existing ETags return replacement bytes for old validators and 304 for current validators. Authored original URLs and gated media retain `private, no-store`. Already-stored immutable browser responses cannot be evicted retroactively by changing server headers.

## Verification commands and results

All commands run from the named repository after `source /workspace/.tovu-build/env.sh`. Tovu HTTP tests require the executor's additional loopback network permission. Logs are local scratch evidence under `/workspace/work/small-fixes`, not committed source or portable report dependencies. Full suites were not run, as directed by the job.

- Jini focused groups: **284 passed**.
- Tovu focused groups: **253 passed, 22 baseline failures**, zero skipped. The 22 failures form two unrelated clusters below.

**Jini: 22 passed**

```bash
pnpm --filter @jini-ai/chat exec vitest run src/core/__tests__/question-answer.test.ts
```

**Jini: 75 passed**

```bash
pnpm --filter @jini-ai/agent-runtime exec vitest run src/__tests__/auth.test.ts
```

**Jini: 37 passed**

```bash
pnpm --filter @jini-ai/cms exec vitest run src/media/__tests__/document-ingress.test.ts src/media/__tests__/documents.test.ts src/media/__tests__/unit/document-text.unit.test.ts src/media/__tests__/unit/unpdf-boundaries.unit.test.ts src/media/__tests__/unit/document-text-adapters.unit.test.ts
```

**Jini: 1 passed**

```bash
pnpm --filter @jini-ai/cms exec vitest run src/media/__tests__/document-read-w2g.unit.test.ts
```

**Jini: 149 passed**

```bash
pnpm --filter @jini-ai/agent-plugins exec vitest run src/lifecycle/__tests__/unit/search-projection.unit.test.ts src/lifecycle/__tests__/unit/search.unit.test.ts src/lifecycle/__tests__/unit/automatic-search.unit.test.ts src/lifecycle/__tests__/unit/automatic-use.unit.test.ts src/lifecycle/__tests__/unit/resolve-agent-plugin-refs.unit.test.ts src/lifecycle/tools/__tests__/capability-gate.security.unit.test.ts src/lifecycle/tools/__tests__/agent-plugin-tools.security.unit.test.ts
```

**Tovu: 86 passed, 1 baseline failure**

```bash
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=1 apps/website/src/server/inbound/admin-http/routes/media/__tests__/upload-route.unit.test.ts apps/website/src/features/media/__tests__/library-save-text.test.ts apps/website/src/features/site-backup/__tests__/share-preparation.unit.test.ts apps/website/src/features/site-backup/__tests__/share-preparation-gaps.unit.test.ts apps/website/src/features/site-backup/__tests__/library-share.integration.test.ts
```

**Tovu: 18 passed**

```bash
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-reporter=tap apps/website/src/features/fs-files/__tests__/copy-library.test.ts apps/website/src/features/fs-files/__tests__/copy-tool.test.ts
```

**Tovu: 68 passed**

```bash
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=1 apps/website/src/features/agent-plugins/__tests__/unit/lifecycle-binding.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/host-plugin-guidance.unit.test.ts apps/website/src/assistant/__tests__/automatic-agent-plugins.integration.test.ts
```

**Tovu: 25 passed**

```bash
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=1 apps/website/src/features/media/__tests__/library-tools.test.ts apps/website/src/features/media/__tests__/promote-chat-attachment.test.ts apps/website/src/server/runtime/composition/__tests__/process-root-parity.test.ts
```

**Tovu: 56 passed, 21 baseline generation failures**

```bash
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-reporter=tap apps/website/src/server/inbound/public-http/routes/site/__tests__/integration/media-replace-cache.integration.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/media-rendition.route.test.ts apps/website/src/server/__tests__/media-rendition-route.test.ts apps/website/src/server/__tests__/media-rendition-gating-bypass.test.ts apps/website/src/server/__tests__/media-original-video-route.test.ts
```

TypeScript:

```bash
# Jini — passed for all four touched packages
pnpm --filter @jini-ai/chat --filter @jini-ai/agent-runtime --filter @jini-ai/cms --filter @jini-ai/agent-plugins exec tsc -p tsconfig.json --noEmit --pretty false
# Final agent-plugins build also reran tsc after the last implementation edit.
pnpm --filter @jini-ai/agent-plugins build
# Tovu — passed after final source edits
NODE_OPTIONS=--max-old-space-size=6144 node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false
```

Complexity was checked on every changed production source file with the explicit ceiling of 10 (no desktop source changed):

```bash
# Jini — one pre-existing untouched-function violation, confirmed on base input
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/chat/src/core/question-answer.ts packages/agent-runtime/src/auth.ts packages/cms/src/media/document-ingress.ts packages/cms/src/media/document-read.ts packages/cms/src/media/plugins/document-text/unpdf.ts packages/agent-plugins/src/lifecycle/search-projection.ts packages/agent-plugins/src/lifecycle/search.ts packages/agent-plugins/src/lifecycle/automatic-use.ts packages/agent-plugins/src/lifecycle/resolve-agent-plugin-refs.ts
# Tovu — exit 0, three existing warnings in untouched host-guidance lines
node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/contracts/core/upload-limits.ts apps/website/src/features/asset-transfer/copy-tool.ts apps/website/src/features/media/library-save-attachment.ts apps/website/src/features/site-backup/share-preparation-steps.ts apps/website/src/server/inbound/admin-http/routes/media/upload.ts apps/website/src/server/runtime/composition/modules/assistant-tool-exec.ts apps/website/src/features/agent-plugins/host-plugin-guidance.ts apps/website/src/features/agent-plugins/automatic-agent-plugins.ts apps/website/src/server/inbound/public-http/routes/site/media-rendition.ts
# Both repositories — passed
git diff --check origin/cloud/combine
```

Initial setup completed: frozen pnpm install using a workspace-local store/cache, core build and `pnpm --no-bail -r build`; Tovu contracts/SDK builds; `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini`. Jini CMS and agent-plugins were rebuilt after their changes, and Tovu relinked again.

## Failing-test-first evidence

- `chat-red.log`: stack overflow on 200,000 selections before the implementation; all 22 cases green afterward.
- `auth-red.log`: four false-auth regressions before the implementation; all 75 cases green afterward.
- `uploads-red.log`: shared-limit and PDF admission/error regressions; `host-upload-red-network.log`: 11 MiB document returned 400 instead of 201 before rebuilt shared policy; `library-copy-red.log`: a maximum document rejected by the old batch cap. Corrected groups pass except the unrelated backup warning below.
- `plugin-red.log`, `plugin-read-red.log`, `host-plugin-red.log`: stripped metadata, refused off-plugin file reads and missing host guidance before implementation. Final unit/integration/security groups pass, including Ask consent, trust failures, unreadable activation, exclusions and disabled-tool revocation.
- `media-cache-red.log`: new authored-URL regression failed the immutable header while the original three cache cases passed. All four cache integration cases pass afterward.

## Open findings and limits

BUG FOUND: Existing rendition generation returns 500 in 21 affected route tests. The default in-memory versioned adapter exposes `replaceFileIfVersion` but lacks `saveRenditionIfSource`, required by the existing rendition guard. A representative resized-PNG case also fails with the exact `origin/cloud/combine` route restored temporarily. The modified route was restored and hash-verified. No unrelated fix. Evidence: `media-cache-green.log`, `media-generation-base-route.log`, `media-cache-baseline-source-hashes.log`.

BUG FOUND: Existing `L3 isolated guard: secret-sentinel` fails because the pending warning does not include `media/`. Exact base Tovu limits/share-step/test files reproduce it; all three current files were restored and hash-verified. Compiled Jini retained the 50 MiB cap for this probe; the 58-byte fixture is unaffected by either cap. No unrelated warning/test adjustment. Evidence: `host-upload-green.log`, `host-upload-secret-baseline.log`, `host-upload-baseline-source-hashes.log`.

DEBT FOUND: Unchanged `isDocumentOnlyBlob` in Jini `packages/cms/src/media/document-read.ts` has cyclomatic complexity 11. The strict check fails identically when fed exact base source through ESLint stdin. Changed functions comply with the ceiling. The existing OOXML HTTP namespace warning and three existing Tovu host-guidance warnings are retained; no suppressions were added. Evidence: `jini-complexity-base.log`, `jini-complexity-final.log`, `tovu-complexity-final.log`.

LIMIT: New cache headers cannot retroactively purge a previously stored immutable client response. New responses and subsequent revalidations use the new policy.

## Cost, boundaries and review

- Choice formatting/auth classification add no I/O. Choice formatting retains O(selections) output space and the existing option-label lookup cost; it removes argument-stack growth.
- Upload/import cost is per explicit operation, with an accepted source cap of 50 MiB. Local files stream with an independent cap and cleanup; APIs/parsers requiring byte arrays still buffer bounded accepted inputs, and PDF.js retains its existing defensive options. Blob-store adapters without streaming/range reads retain their existing full-buffer API and metadata/post-read checks. Document response pages remain 64 KiB; extraction output/page limits remain enforced.
- Off-plugin discovery reuses the existing catalog and bounded skill reader (256 KiB/file, 4096 entries, depth 32). Reads happen on explicit load; no activation writes, new polls, registry permissions or executable contribution paths were added. Ask decisions use the existing chat-state owner.
- Cache header selection adds **zero** reads per origin request. Existing stored-id rendition requests perform six repository calls plus one blob read, with optional widget/session work. Revalidation increases origin frequency. The existing access gate scans workspace posts/body references and conditional 304 responses still load/hash bytes; they save transfer, not those reads. Original-media cost/frequency is unchanged.
- Architecture audit: PASS for this change. Generic admission, auth, choice and plugin-read policy remain in Jini; Tovu keeps host policy/wiring. No new tables/frameworks or cross-plugin imports. Existing public signatures are preserved; the read-only resolver option is scoped to the requested discovery behavior.
- Function review: NO_RECORDED_FINDINGS in changed units after local corrections. Existing consent/admission helpers were reused to keep changed units within complexity 10. Time/space/I/O bounds are described above. The second review checked exact cap boundaries, combined totals, Unicode, false classifier collisions, trust/activation races at the execution guard, cache validators and denied viewers. Security tests assert disabled tools remain withdrawn and retained capabilities are revoked. No new Critical/High finding was left open in the change itself.
- Coverage percentages were not collected: this job explicitly scopes testing to touched/affected code rather than full package coverage gates. Direct behavior, integration and execution-security checks supply the evidence. No coverage thresholds/configuration changed.
- Pre-completion: five requirements rechecked, focused evidence recorded, diff/TypeScript checks passed, pre-existing failures disclosed, no test/rule suppressions introduced. Runtime verification is PASS for the assigned new behavior and PARTIAL for the broader affected suites due to the baseline failures above.
- Jini's pre-existing untracked `packages/plugin-ui-ux-design/` remainder was preserved and not committed. Tracked implementation changes are committed.

Measured non-comment/nonblank function lines (descriptive, not a size gate):

| Unit | NLOC |
| --- | ---: |
| Jini: selectedAnswerText | 12 |
| Jini: isDeepSeekAuthFailureText | 8 |
| Jini: validateDocumentIngress | 11 |
| Jini: loadDocumentBytes | 9 |
| Jini: createUnpdfDocumentTextExtractor | 16 |
| Jini: extract | 13 |
| Jini: agentVisiblePluginCandidate | 7 |
| Jini: automaticScore | 16 |
| Jini: offPluginNote | 6 |
| Jini: load | 8 |
| Jini: loadPermitted | 17 |
| Jini: resolveAgentPluginSelection | 19 |
| Jini: activationRefusal | 16 |
| Tovu: readLocal | 22 |
| Tovu: appendFiles | 6 |
| Tovu: generatedDocument | 7 |
| Tovu: decodeUploadPayload | 11 |
| Tovu: buildDaemonAttachmentTools | 18 |
| Tovu: readAttachmentFile | 2 |
| Tovu: createEntry | 34 |
| Tovu: renditionCacheControl | 4 |

## Exact changed files — Jini

- `cloud/reports/small-fixes.md`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/automatic-search.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/automatic-use.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/resolve-agent-plugin-refs.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/__tests__/unit/search-projection.unit.test.ts`
- `packages/agent-plugins/src/lifecycle/automatic-use.ts`
- `packages/agent-plugins/src/lifecycle/resolve-agent-plugin-refs.ts`
- `packages/agent-plugins/src/lifecycle/search-projection.ts`
- `packages/agent-plugins/src/lifecycle/search.ts`
- `packages/agent-runtime/src/__tests__/auth.test.ts`
- `packages/agent-runtime/src/auth.ts`
- `packages/chat/src/core/__tests__/question-answer.test.ts`
- `packages/chat/src/core/question-answer.ts`
- `packages/cms/src/media/__tests__/document-ingress.test.ts`
- `packages/cms/src/media/__tests__/documents.test.ts`
- `packages/cms/src/media/__tests__/unit/document-text.unit.test.ts`
- `packages/cms/src/media/__tests__/unit/unpdf-boundaries.unit.test.ts`
- `packages/cms/src/media/document-ingress.ts`
- `packages/cms/src/media/document-read.ts`
- `packages/cms/src/media/plugins/document-text/unpdf.ts`

## Exact changed files — Tovu

- `apps/website/src/assistant/__tests__/automatic-agent-plugins.integration.test.ts`
- `apps/website/src/contracts/core/upload-limits.ts`
- `apps/website/src/features/agent-plugins/__tests__/unit/lifecycle-binding.unit.test.ts`
- `apps/website/src/features/agent-plugins/automatic-agent-plugins.ts`
- `apps/website/src/features/agent-plugins/host-plugin-guidance.ts`
- `apps/website/src/features/asset-transfer/copy-tool.ts`
- `apps/website/src/features/fs-files/__tests__/copy-library.test.ts`
- `apps/website/src/features/media/__tests__/library-save-text.test.ts`
- `apps/website/src/features/media/library-save-attachment.ts`
- `apps/website/src/features/site-backup/__tests__/library-share.integration.test.ts`
- `apps/website/src/features/site-backup/__tests__/share-preparation-gaps.unit.test.ts`
- `apps/website/src/features/site-backup/__tests__/share-preparation.unit.test.ts`
- `apps/website/src/features/site-backup/share-preparation-steps.ts`
- `apps/website/src/server/__tests__/media-rendition-gating-bypass.test.ts`
- `apps/website/src/server/__tests__/media-rendition-route.test.ts`
- `apps/website/src/server/inbound/admin-http/routes/media/__tests__/upload-route.unit.test.ts`
- `apps/website/src/server/inbound/admin-http/routes/media/upload.ts`
- `apps/website/src/server/inbound/public-http/routes/site/__tests__/integration/media-replace-cache.integration.test.ts`
- `apps/website/src/server/inbound/public-http/routes/site/__tests__/media-rendition.route.test.ts`
- `apps/website/src/server/inbound/public-http/routes/site/media-rendition.ts`
- `apps/website/src/server/runtime/composition/modules/assistant-tool-exec.ts`
- `cloud/reports/small-fixes.md`

## Pushed commits — Jini, cloud/small-fixes

- `dd7c3a2d75de60951f2210fe0580858b148ae8bf` — docs: record small fixes work in progress
- `b8153eba7c711e35d989299ab1412e2fdfbdcc74` — fix: handle large choices and classify key failures accurately
- `9e3fd59ea4043f37fe3c63cf46186ae4c7d0feab` — docs: record verified answer and authentication fixes
- `4165a61b3fa88289d227c6714ccbdd1e7d12dd7d` — fix: align document admission and extraction size limits
- `b2424591e4fb870b95d686f99fd8061a77b07462` — docs: record document and cache verification progress
- `382abd1137abaa17302c64d89115db202e979299` — fix: expose off plugin setup guidance without enabling tools
- `48c8c68560e00fe428e88b1a536f648ee7f90cf2` — fix: preserve guidance consent and complexity limits
- `ec8871171975ad4937be9171c3da91d22198d897` — fix: classify inactive guidance at the consent boundary

## Pushed commits — Tovu, cloud/small-fixes

- `088281c639eac6f2ef506dba4b9e06513a922df0` — fix: revalidate replaceable media URLs before cache reuse
- `0e3724fb6fc264db285827dda6fdbafcda07fa8d` — fix: share upload limits and bound local attachment reads
- `3e17cc09995fd12ecac08d1de97414cf8c9d9ad9` — fix: wire read-only setup guidance for off plugins
- `254f9b7d91ef4a0f0e004f4a70389b70a57c0833` — fix: bound attachment promotion and verify read-only guidance
