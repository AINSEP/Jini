# Review fixes — completed with listed stops

The owner-approved `review-fixes` job and its appended items were checked on `cloud/combine` in both repositories. Work stayed within the two-hour cap. The item descriptions below are deliberately general. Tests preceded bug fixes; the final checks use the restored branch dependencies and rebuilt Jini packages.

## Item dispositions

| Item | Disposition | Result or reason |
| --- | --- | --- |
| 1 | Fixed | Authoring guidance matches the current JSON declaration format. |
| 2 | Fixed | Failed preference snapshots recover on later requests, with a shared sixty-second retry window, including the public context route. Ordinary declarations remain available. |
| 3 | Fixed | Live contribution changes and settings writes refresh through the existing sixty-second boundary. |
| 4 | Fixed | Theme override rendering retains its preview exclusions; tested through the actual override. |
| 5 | Fixed | Rendering without the contribution hook conservatively handles declared optional assets. |
| 6 | Fixed | The existing preferences link uses existing style tokens and keyboard focus styling. |
| 7 | Fixed | Cached pages reload at most once for each page policy. |
| 8 | Stopped | The current server analytics contract requires receipt evidence and has no off-mode handoff. A contract decision is needed; a suppression-only change would not complete the behavior. |
| 9 | Fixed | Exported executable assets use the declaration owner; redundant live-element metadata was removed. |
| 10 | Fixed | Extension bytes are loaded once when routes mount. |
| 11 | Fixed | A later refresh failure no longer changes the successful publication outcome. |
| 12 | Finding wrong; fixture corrected | The old fixture omitted the production preference port and used an unmanaged static shell. The managed fixture retains the original banner assertion; all three tests pass. |
| 13 | Fixed | Public media uses sixty-second freshness and stored-source validators. Eligible unchanged responses avoid blob reads; reference evidence is bounded and shared. Private response behavior remains covered. |
| 14 | Fixed | Storefront readiness avoids operator attention scans; operator status keeps them. |
| 15 | Fixed | Inactive storefront paths fall through to site content. Existing order API and drain behavior remain covered. |
| 16 | Fixed | Stream recovery accepts a complete subsequent frame and retains multiline limits. |
| 17 | Checked / fixed | Custom/configured/empty-discovery cases already worked. Explicit settings in the alternate launch mode now receive the existing preflight validation. |
| 18 | Checked / fixed | A synthetic attachment-sized frame confirms the boundary. The existing eight-Mi-character limit stays, with plain failure copy and a next action. No live CLI account was used. |
| 19 | Fixed | Collection discovery returns metadata; individual definitions retain their markup. |
| 20 | Fixed | Retry responses carry the existing attempt identity; a real retry/double-submit test stores one result. |
| 21 | Fixed | Typed submission refusals keep their own reason labels. |
| 22 | Fixed | The existing discard decision precedes schema checking. |
| 23 | Fixed | Plans and preparation failures retain the step summary. |
| 24 | Fixed | Repeated inactive guidance is deduplicated while explicit content reads and later activation remain supported. |
| 25 | Stopped | The renderer has no existing export-mode context. Adding an option or rewriting output conflicts with this job's limits. |
| 26 | Fixed | At most two document text reads run per process; admission is released on success and failure. |
| 27 | Fixed | Embedded forms have responsive sizing and a plain preference placeholder. |
| 28 | Fixed | Provider inventory and distribution metadata agree. The required direct workspace development dependency is declared; an already-shipped omitted catalog entry was restored. |
| 29 | Stopped | The authoring service has no provider-plan validation dependency. Introducing that write-contract dependency needs an owner decision under this job's limit. |
| 30 | Fixed | Published form links with the supported Google-generated query values are accepted and normalized, with focused URL tests. |
| 31 | Fixed | Editor discovery shows loading while preserving the saved selection. |
| 32 | Fixed | Discovery failures retain their cause in readable copy. |
| 33 | Fixed | The existing activation callback reapplies the live provider host. Actual app wiring, retry and idempotence are covered. |
| 34 | Partial / stopped | Providers retired after attachment retain their name and an actionable explanation. A provider already disabled before boot is absent from the existing enabled-only inventory, which lacks its display metadata. Expanding that contract was stopped. |
| 35 | Fixed | Header sets are reused while provider origins remain unchanged, and rebuilt when those origins change. |
| 36 | Fixed | Domain publication forwards the existing header dependency. |
| 37 | Partial / stopped | Preference reads are bounded to 250 ms, and stable refreshes retain the last successful mode. A policy change during a render still needs a shared request-context contract; none was added. |
| A | Fixed | Connection choices persist through automatic reconciliation, with existing storage. Concurrent decisions are protected across all four adapters. A fresh connection request, including renewed sign-in, can finish the review. |
| B | Fixed / checked | Existing matching configurations reach the review card. Changed destinations retain their saved configuration and receive a concrete review action. |
| C | Fixed | Configuration and access entry paths apply consistent validation and current-person checks; configuration forms preserve the requested enabled state. |
| D | Fixed | Where a live listing is unavailable, the message names the real existing Settings and Tools action. |
| Additional result item | Fixed | Results distinguish completed portions and unanswered-card outcomes. |
| Additional settings item | Fixed | Capability metadata now matches supported update operations. |

## Cuts

Removed verified-unused reasoning helpers, the redundant access-surface wrapper, redundant preview details and callback, old dictionary controls and selectors, an unnecessary null fallback, a package-relative dependency lookup, unused collection options, redundant export attributes, redundant built-in form arguments and prose, unused inspection dependencies, duplicate header-reader composition, and the admin memory fixture's runtime CMS import. Four document-state maps became one.

Retained items with real behavior/callers: batched approval metadata; consent boot wrappers used by the browser entry; documented inert-content compatibility; provider description validation and its malformed-metadata regression; the site analytics contribution; off-mode reader behavior; independent lazy contribution caches; and the form-schema helper used by both native rendering modes. The last helper was restored after typechecking exposed its second caller.

The explicit legacy-helper cut removed fourteen obsolete helper-only tests (69 lines). Their API was removed as requested; provider behavior tests remain. The two wrapper behavior tests now exercise the existing builder with their assertions preserved. No test, guard or rule was disabled or weakened to manufacture a pass.

## Validation

All commands first source `/workspace/.tovu-build/env.sh`. Commands needing local listeners or child processes used the environment's network-enabled execution permission. The full repository test suites remain the next job.

### Setup and final checks

From `/workspace/Jini`:

- `CI=1 COREPACK_DEFAULT_TO_LATEST=0 XDG_STATE_HOME=/workspace/work/pnpm-state pnpm install --frozen-lockfile --ignore-scripts --store-dir /workspace/work/pnpm-store --cache-dir /workspace/work/pnpm-cache` — passed after restoring branch dependencies into a writable workspace store.
- `export COREPACK_DEFAULT_TO_LATEST=0 && pnpm -r --no-bail --if-present run build` — passed for the complete workspace after dependency restoration.
- `pnpm --filter @jini-ai/plugin-catalog run generate` — passed; changed digests committed.
- `pnpm --filter @jini-ai/plugin-catalog run test` — 65 passed. The first sandboxed attempt had a child-process permission failure; the permitted execution passed.
- `pnpm exec tsc -p scripts/tsconfig.json --noEmit` — passed.

From `/workspace/Tovu`:

- `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` — passed after the rebuilt packages.
- `node_modules/.bin/tsc -p tsconfig.json --noEmit` — final combined source check passed.
- `git diff --check` — passed in each repository.

### Focused Jini tests

| Command | Result |
| --- | --- |
| `pnpm --filter @jini-ai/agent-runtime exec vitest run src/agent-protocol/core/__tests__/json-line-stream.test.ts src/__tests__/stream-parser-bounds.unit.test.ts src/agent-protocol/acp/__tests__/session.test.ts src/agent-protocol/pi-rpc/__tests__/session.test.ts src/defs/__tests__/shared.test.ts src/defs/__tests__/codex.test.ts src/__tests__/model-discovery-policy.test.ts` | 501 passed |
| `pnpm --filter @jini-ai/agent-plugins exec vitest run src/lifecycle/__tests__/unit/automatic-use.unit.test.ts` | 51 passed |
| `pnpm --filter @jini-ai/core exec vitest run src/settings/__tests__/tool-registrations.set-value.test.ts` | 34 passed |
| `pnpm --filter @jini-ai/ui exec vitest run src/features/mcp-ui/__tests__/surfaces/access-approval.test.ts` | 2 passed |
| `pnpm --filter @jini-ai/daemon exec vitest run src/agent-executor/__tests__/starting-model.test.ts -t 'checks an explicit effort'` | Selected regression passed |
| `pnpm exec vitest run scripts/__tests__/publish-pending-summary.test.ts scripts/__tests__/plugin-release-prepare.test.ts scripts/__tests__/plugin-release-consistency.test.ts scripts/__tests__/plugin-package-gates.test.ts` | 26 passed |

From `/workspace/Jini/packages/admin`:

- `pnpm exec vitest run src/forms/react/__tests__/FormEditorFieldsBody.unit.test.tsx src/forms/react/__tests__/use-form-editor.unit.test.tsx src/forms/react/__tests__/use-form-editor.branches.unit.test.tsx src/forms/__tests__/memory-adapter.unit.test.ts` — 67 passed.
- `pnpm exec vitest run src/forms/react/__tests__/FormEditor.unit.test.tsx` — 14 passed.
- `pnpm run typecheck` — passed.

From `/workspace/Jini/packages/cms`:

- `pnpm exec vitest run src/media/__tests__/document-read-w2g.unit.test.ts src/media/__tests__/documents.test.ts src/media/__tests__/unit/document-text.unit.test.ts` — 19 passed.
- `pnpm exec tsc -p tsconfig.json --noEmit` — passed.

From `/workspace/Jini`:

- `pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/stale-form.test.ts src/forms/__tests__/submit-service.test.ts src/forms/__tests__/embed-consent.unit.test.ts src/forms/__tests__/html-render.test.ts src/widgets/__tests__/plugin-export.unit.test.ts src/widgets/__tests__/plugin-export-m1.unit.test.ts src/forms/__tests__/submission-attempts.test.ts src/forms/__tests__/submit-service.host-options.test.ts src/widgets/__tests__/unit/resolvers-contact-form.unit.test.ts` — 161 passed.
- `pnpm --filter @jini-ai/cms exec vitest run src/forms/express/__tests__/handler.test.ts -t 'direct retries|double clicking'` — two selected cases passed.
- `pnpm --filter @jini-ai/provider-plugins exec vitest run src/google-forms/__tests__/provider.test.ts` — 33 passed.

From `/workspace/Jini/packages/provider-plugins`: `pnpm exec vitest run src/__tests__/distribution-manifest.test.ts` — two passed.

From `/workspace/Jini/packages/cookie-consent`: `pnpm exec vitest run src/__tests__/context.unit.test.ts` — five passed; `pnpm run typecheck` passed.

### Focused Tovu tests

From `/workspace/Tovu`:

- `node --import tsx apps/website/src/features/agent-plugins/__tests__/unit/enable-access.regression.test.ts` — 27 passed, including repeated requests, renewed sign-in, interrupted multi-source work and later failures.
- `node --import tsx apps/website/src/features/agent-plugins/__tests__/unit/apply-connect-defaults.unit.test.ts` — 15 passed.
- `node --import tsx apps/website/src/features/agent-plugins/__tests__/unit/grant-signed-in-defaults.unit.test.ts` — 4 passed.
- `node --import tsx apps/website/src/features/agent-plugins/__tests__/unit/connect-tool.unit.test.ts` — 54 passed.
- `node --import tsx apps/website/src/features/agent-plugins/__tests__/unit/access-token-tool.unit.test.ts` — 31 passed.
- `node --import tsx apps/website/src/features/plugin-runtime/__tests__/unit/plugin-enable-access.regression.test.ts` — 2 passed.
- `node --import tsx --experimental-test-module-mocks apps/website/src/features/plugin-runtime/__tests__/unit/plugins-tool-registrations.unit.test.ts` — 23 passed.
- `node --import tsx apps/website/src/features/agent-plugins/__tests__/unit/plugin-enable-reload.unit.test.ts` — 1 passed.
- `TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/external-mcp/__tests__/access-grants.contract.test.ts apps/website/src/features/external-mcp/__tests__/access-choice.postgres.test.ts` — 40 passed across memory, SQLite, PGlite and real two-client Postgres, using disposable data.
- `node --import tsx apps/website/src/features/external-mcp/__tests__/access-save.integration.test.ts` — 19 passed.
- `node --import tsx apps/website/src/features/external-mcp/__tests__/unit/save-form.unit.test.ts` — 39 passed.
- `node --import tsx apps/website/src/features/external-mcp/__tests__/unit/static-token-setup.unit.test.ts` — 36 passed.
- `node --experimental-test-module-mocks --import tsx apps/website/src/assistant/__tests__/tool-registrations.external-mcp.test.ts` — 39 passed.
- `node --experimental-test-module-mocks --import tsx apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.external-mcp-save.integration.test.ts` — 3 passed.
- `node --experimental-test-module-mocks --import tsx apps/website/src/features/credential-safety/__tests__/probes-and-cards.test.ts` — 27 passed.
- `node --import tsx --test --test-concurrency=1 --experimental-test-module-mocks apps/website/src/server/inbound/public-http/routes/site/__tests__/integration/media-validation.integration.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/integration/media-replace-cache.integration.test.ts` — 7 passed.
- `node --import tsx --test --test-concurrency=1 --experimental-test-module-mocks apps/website/src/server/runtime/composition/__tests__/commerce-http.unit.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-composition.unit.test.ts` — 8 passed.
- `node --import tsx apps/website/src/features/forms/__tests__/tool-definition-view.unit.test.ts` — passed.
- `node --import tsx --test --experimental-test-module-mocks --test-name-pattern='form refusal analytics' apps/website/src/server/__tests__/routes/forms-submit.test.ts` — 2 selected cases passed.
- `node --import tsx apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts` — 48 passed.
- `node --import tsx apps/website/src/server/runtime/composition/__tests__/provider-live-enable.integration.test.ts` — passed through the actual activation callback.
- `node --import tsx apps/website/src/contracts/core/__tests__/unit/form-provider-security-headers.contract.test.ts` — 3 passed.
- `node --import tsx apps/website/src/features/deployments/static-publish/__tests__/domain-publish-tool.unit.test.ts` — 17 passed.
- `node --import tsx apps/website/src/features/deployments/static-publish/__tests__/inspection.unit.test.ts` — 9 passed.

- `node --import tsx apps/website/src/server/inbound/public-http/middleware/__tests__/public-page-security-headers.test.ts` — three passed.
- `node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-reporter=tap apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.regressions.unit.test.ts apps/website/src/server/inbound/public-http/http/site/__tests__/declared-assets.unit.test.ts apps/website/src/features/consent/__tests__/service.test.ts` — 93 passed before the final context follow-up.
- `node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-reporter=tap apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.regressions.unit.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-consent.test.ts` — final 66 passed after the context follow-up.
- `node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-reporter=tap apps/website/src/server/runtime/composition/__tests__/app.consent-capture.test.ts` — three passed.

Strict complexity checks used `eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'` on the changed production paths. New or materially changed functions pass. Unchanged violations in the existing daemon launcher, package checker, composition root, token resolver and document ownership helper were reproduced on the initial bases; their values were not hidden by rule changes. Touched package typechecks passed.

## Resource cost

- Media: before, each network request scanned the whole post/widget payload and loaded image bytes, including unchanged responses. After, one shared scan per asset per sixty seconds (at most 256 cached assets per repository), fresh source metadata per network request, and zero blob bytes for eligible unchanged responses. Cached evidence holds access settings, not post bodies or visitor entitlements.
- Documents: before, concurrent source allocations scaled with all simultaneous reads. After, two source reads × 50 MiB = 100 MiB maximum source allocation per process, plus bounded extraction/output and parser workspace. Responses remain at most 64 KiB; the source-size cap remains.
- Storefront: public readiness performs no operator attention scans; operator status retains its bounded scans.
- Preference documents: one mounted snapshot; ordinary requests share at most one refresh per sixty seconds, including failed-read retries. Explicit publication retains its refresh; extension bytes are read once. Existing independent lazy contribution readers remain separate.
- Connection work: at most one existing-row write per reviewed source, with fixed-size decision metadata; automatic checks use existing row reads. Configuration cards add point reads and current-person checks at both phases, with no new polling or remote probes.
- Headers: one cached header set per weak registry key; provider-origin metadata remains checked so withdrawal takes effect. No new I/O.

## Bugs found and validation limits

- The listed stops remain open: 8, 25, 29, the before-boot portion of 34, and the policy-changing-during-render portion of 37.
- An additional concurrent-choice case was found and fixed through the existing snapshot boundary, with four-adapter regression evidence.
- Full configuration-save coordination retains an existing concurrency limitation; completing that boundary needs separate repository contract work.
- A contribution loader that never resolves can still delay page construction independently of the now-bounded preference read.
- A reviewed host provider pin refers to an artifact build no longer shipped. Three existing parity checks fail and app tests warn, while the intended fallback remains. The trust pin was left unchanged.
- Existing in-memory media composition cannot generate some raster fixtures because an existing atomic adapter capability is absent. The original route reproduces the same 500; the SQLite replacement tests pass. The guard was retained.
- Existing complete form-route fixtures have an admission-budget discrepancy. The changed refusal cases pass; broad-suite repair was not added to this job.
- Three existing launch fixtures have outdated expectations or missing required setup. Their assertions were not weakened; the new targeted regression passes.
- One existing form-handler logging assertion expects an old error shape. Production already formats it differently; the retry and changed form tests pass.


## Branches, implementation SHAs and line totals

Both repositories use `cloud/combine`. Final implementation heads (the following documentation commit contains this report):

| Repository | Implementation SHA | Changed non-report files | Added lines | Removed lines |
| --- | --- | ---: | ---: | ---: |
| Jini | `c3932fa32353bb556d77f760c457c578bbab2371` | 50 | 402 | 184 |
| Tovu | `df0815403898ad7e1bf719702310dd54b757e553` | 56 | 1188 | 321 |

Total removed: **505 lines**, across source, tests, metadata and guidance, excluding this report. These are net branch diffs against the initial combined heads; they include the explicitly requested obsolete-helper test removal.

All implementation commits below are pushed only to `cloud/combine`; each push follows a pull/rebase. The final chat message records the report commit SHAs as well.

### Jini commit ledger

- `ec6b67a27` — fix: improve runtime recovery and tool guidance
- `2a937b482` — fix: clarify editor loading and failure states
- `a54df88f5` — fix: improve form delivery and bounded document reads
- `67bf20bb0` — fix: improve consent recovery and provider metadata
- `c594d1d0d` — fix: improve launch validation and task summaries
- `4811c70ba` — refactor: clarify plugin guidance deduplication
- `c3932fa32` — chore: refresh plugin catalog digests

### Tovu commit ledger

- `b62b78a4e` — fix: improve form summaries and failure reporting
- `f4a39a491` — fix: improve page asset recovery and preview behavior
- `d6d1fdbb0` — fix: preserve connection choices and report progress
- `866b82ceb` — fix: refresh provider behavior and simplify page wiring
- `9caf88a44` — fix: preserve current choices during concurrent updates
- `ec73a859a` — fix: align connection review and configuration outcomes
- `f2c7690ff` — fix: share page preference refreshes and preserve render state
- `ac3f70729` — fix: apply provider changes through live composition
- `120de2360` — fix: bound media validation and storefront admission work
- `5e9477e16` — fix: complete connection review after renewed sign-in
- `df0815403` — test: exercise reviewed connection changes through app wiring
