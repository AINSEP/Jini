# review-fixes-2

Completed within the 90-minute cap. Final code and focused verification are recorded below.

Both repositories use `cloud/combine`. No other branch was pushed. No deployment or publication was performed. The normal Tovu pre-push hook ran and correctly scoped out desktop gates.

Starting commits: Jini `8b9cb0321d0f38cb5aa88001895815807087d0db`; Tovu `f9c27978595455f60cc2fca8aea4ef003906c43c`.

## Item dispositions

| Item | Disposition | General outcome |
| --- | --- | --- |
| 1 | Fixed | Successful preferences remain usable during refreshes and failures; initial readiness can finish later. The old test expected discarded preferences and was corrected to assert retention. |
| 2 | Fixed | Export and publish results, including the final tool result, carry a plain availability warning. |
| 3 | Fixed | Unavailable browser assets warn and disable their routes without stopping the application. |
| 4 | Fixed | Settings-link styling belongs to the banner stylesheet. |
| 5 | Fixed | Shipped static themes author the small loading tag; existing client/context delivery works live and in exports. Administration recognizes a valid loading slot and warns when absent. |
| 6 | Fixed | Selected provider configuration is checked before editor and tool saves. Rejected saves preserve stored state. |
| 7 | Fixed | Declared providers remain visible after unsuccessful initialization and can recover later. |
| 8 | Fixed | The explanatory comment now accompanies its intended constant. |
| 9 | Fixed | Stream recovery preserves both the error and the next complete frame. |
| 10 | Fixed | Explicit rejected-save and saved-record assertions are present. |
| 11 | Fixed | Removed the extra partial-result state/helper; ordinary errors retain accurate progress. |
| P | Fixed / stopped variant | Existing-record workflows share decision recording, including the requested startup scenario. The first-connection variant has no existing place to retain the decision and was stopped under the no-new-mechanism rule. |
| Q | Fixed | One review completes the expected handoff while retaining source checks. |
| R | Fixed | Configuration maintenance preserves access when the actual target is unchanged. |
| S | Fixed | Failure messages retain their correct category. |
| T | Fixed | Review outcomes accurately describe retained progress and retry guidance. |
| U | Fixed | Existing attribution remains intact using current storage. |
| V | Fixed within requested save paths | Content saves refresh derived evidence while preserving inexpensive conditional responses. A related lifecycle path is listed below, not extended in this round. |

No item was dismissed as an incorrect finding.

## Verification

All commands below ran after `source /workspace/.tovu-build/env.sh`. HTTP integration commands used loopback network permission. No full test suite was run.

Jini focused checks:

```sh
pnpm --filter @jini-ai/agent-runtime exec vitest run src/agent-protocol/core/__tests__/json-line-stream.test.ts
pnpm --filter @jini-ai/agent-runtime exec vitest run src/agent-protocol/acp/__tests__/session.test.ts src/agent-protocol/pi-rpc/__tests__/session.test.ts
pnpm --filter @jini-ai/agent-runtime run typecheck
pnpm --filter @jini-ai/cms exec vitest run src/forms/__tests__/write-service.test.ts src/forms/__tests__/write-service.host-options.test.ts src/forms/__tests__/provider.test.ts
pnpm --filter @jini-ai/cms run typecheck
pnpm --filter @jini-ai/cookie-consent exec vitest run src/__tests__/render.test.ts src/__tests__/css.test.ts
pnpm --filter @jini-ai/cookie-consent run typecheck
pnpm --filter @jini-ai/plugin-catalog run generate
npm_config_cache=/workspace/.tovu-build/npm-cache pnpm --filter @jini-ai/plugin-catalog run test
```

Passed: stream 140; adjacent sessions 191; forms/provider 53; banner/CSS 38; catalog 65. Touched Jini production files passed explicit complexity and cognitive-complexity ceilings of 10 with `--no-inline-config`.

Tovu focused checks:

```sh
node --import tsx --test --test-isolation=none apps/website/src/features/forms/__tests__/tool-registrations.model-facing-errors.test.ts apps/website/src/server/inbound/admin-http/routes/forms/__tests__/provider-save.unit.test.ts apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts apps/website/src/assistant/__tests__/tool-registrations.external-mcp.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts apps/website/src/features/external-mcp/__tests__/access-save.integration.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts apps/website/src/assistant/__tests__/mcp-ui-tool-calls-route.external-mcp-save.integration.test.ts
node --import tsx --test --test-isolation=none apps/website/src/features/agent-plugins/__tests__/unit/declined-access.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/enable-access.regression.test.ts apps/website/src/features/plugin-runtime/__tests__/unit/plugin-enable-access.regression.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none --test-name-pattern='signed-in connection receives|approved enable' apps/website/src/server/runtime/composition/__tests__/plugin-host.integration.test.ts
node --import tsx --test-isolation=none --test apps/website/src/server/inbound/public-http/routes/site/__tests__/integration/media-validation.integration.test.ts
node --import tsx --test-isolation=none --test apps/website/src/server/inbound/public-http/routes/site/__tests__/integration/media-replace-cache.integration.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/media-rendition.route.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none --experimental-test-module-mocks apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts apps/website/src/server/runtime/composition/__tests__/app.consent-capture.test.ts apps/website/src/features/site-export/__tests__/declared-assets.unit.test.ts apps/website/src/server/runtime/composition/__tests__/site-consent.ports.unit.test.ts apps/website/src/features/consent/__tests__/unit/declared-readiness.unit.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none --experimental-test-module-mocks --test-name-pattern='public publish status retains|carries the export cookie' apps/website/src/features/deployments/__tests__/publish-agent-tools.unit.test.ts apps/website/src/features/deployments/static-publish/__tests__/adapter.unit.test.ts
```

Passed: forms/provider 60; connection saves 42 + 21 + 3; connection review 39 + 4 selected host cases; media 9 + 15; consent/static/export 45; public warning results 3.

Adjacent connection checks:

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-isolation=none apps/website/src/features/agent-plugins/__tests__/unit/apply-connect-defaults.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/connect-tool.unit.test.ts apps/website/src/features/plugin-runtime/__tests__/unit/plugins-tool-registrations.unit.test.ts apps/website/src/features/plugin-runtime/__tests__/unit/plugins-set-enabled-consent.unit.test.ts apps/website/src/server/runtime/composition/__tests__/plugin-host.integration.test.ts
```

Result: 146/147; one unchanged package-identity expectation differs from the built dependency. It was listed rather than changed.

Aggregate checks:

```sh
npx tsc -p tsconfig.json --noEmit
NODE_OPTIONS=--max-old-space-size=6144 npx tsc -p tsconfig.tests.json --noEmit
npx eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/contracts/headless/plugin-host.ts apps/website/src/contracts/headless/site-cookie-consent.ts apps/website/src/features/agent-plugins/apply-connect-defaults.ts apps/website/src/features/agent-plugins/connect-tool.ts apps/website/src/features/agent-plugins/enable-access.ts apps/website/src/features/consent/readiness.ts apps/website/src/features/deployments/publish-agent-tools.ts apps/website/src/features/deployments/static-publish/adapter.ts apps/website/src/features/deployments/static-publish/types.ts apps/website/src/features/entries/repo.ts apps/website/src/features/entries/trash-aware-memory-repo.ts apps/website/src/features/external-mcp/tool-registrations.ts apps/website/src/features/forms/tool-registrations.ts apps/website/src/features/media/access-evidence.ts apps/website/src/features/plugin-runtime/tool-registrations.ts apps/website/src/features/post/repo.memory.ts apps/website/src/features/post/repo.ts apps/website/src/features/site-export/site-exporter.ts apps/website/src/server/inbound/admin-http/routes/forms/create.ts apps/website/src/server/inbound/admin-http/routes/forms/update.ts apps/website/src/server/inbound/public-http/middleware/site-cookie-consent.ts apps/website/src/server/inbound/public-http/routes/site/media-rendition.ts apps/website/src/server/runtime/composition/plugin-host.ts apps/website/src/server/runtime/composition/provider-plugins.ts apps/website/src/server/runtime/composition/site-consent.ts
git diff --check
```

Production typechecking and strict touched-file lint passed; five existing non-complexity lint warnings remain. The test-only compiler exits 2 with exactly the same 76 normalized diagnostics as the starting commit, verified in an isolated temporary checkout. No diagnostic was introduced by this job; changed fixtures retain their assertions.

Setup: locked Jini dependencies installed; `pnpm --no-bail -r build` completed; Tovu contracts and SDK built; `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` completed. Catalog generation and tests completed. `npm_config_cache=/workspace/.tovu-build/npm-cache npm run agent-plugins:compose` rebuilt the 33-component disposable bundle after guidance changes. Initial sandbox/cache and stale-output failures were resolved before relying on behavioral results.

## Change size and cost

Relative to the starting commits, excluding this report:

| Repository | Production added / removed | Tests added / removed | Guidance added / removed |
| --- | --- | --- | --- |
| Jini | 13 / 9 | 25 / 2 | 0 / 0 |
| Tovu | 290 / 148 | 639 / 34 | 4 / 0 |

No new persistence, polling, framework, or configuration option was added. Preference refreshes retain the existing request-driven one-minute interval. Static documents add one cacheable loader request and reuse existing browser assets. Provider validation adds one pure plan check per applicable save and one registry enumeration at startup. Media validation retains its bounded cache and cheap conditional path; writes clear bounded in-memory evidence, so the next access rebuilds it. Storage read payload on a miss remains the existing content/reference scan; repeated unchanged requests retain their previous cost.

## Bugs found — listed only

- The additional first-connection workflow needs an owner decision about retaining a prior choice.
- A separate content lifecycle path needs consistent derived-state refresh handling.
- Existing eviction behavior above 256 active assets remains unchanged, as requested.
- Document-read admission still lacks a timeout, as requested for listing only.
- Bundled-component startup integrity warnings appeared during passing integration checks.
- An adjacent package-identity expectation differs from the current built dependency.
- Existing test fixtures prevent a green repository-wide test-only typecheck.
- The unchanged cookie-client headroom assertion is stricter than the current generated bundle margin: 4,602 gzip bytes against a 4,608-byte budget, with a 32-byte headroom assertion.

Architecture review: existing ownership and approved interfaces retained. No page-response rewriting or scanning was introduced. Remaining variants were listed instead of extending the approved mechanisms.

## Pushed code commits

### Jini

Code head: `43117c247cc825b9283dc0fd8ff59dc9dea6b04a` on `cloud/combine`. All listed commits were pushed successfully.

- `4e681d7541e05e21533d24432539eb172a7cde16` — fix: preserve stream recovery diagnostics
- `80d54952e876795eb72272e6c4d72074f229da31` — fix: validate selected collection settings before saving
- `43117c247cc825b9283dc0fd8ff59dc9dea6b04a` — fix: keep consent link styling with banner assets

### Tovu

Code head: `68b555ca5862f32f2424fe0f6b9a435bef57587a` on `cloud/combine`. All listed commits were pushed successfully.

- `6b431f5e4c278fbf3a27683077de808b49773c2a` — fix: validate form settings and retain provider availability
- `d3d8e8a6c7dab67d4fd212f4554808e9efcfbecd` — fix: preserve connection settings and focused save checks
- `267ab42b26af5b69054715a218e78fa504fb2535` — fix: keep connection review outcomes consistent
- `2bcef4f6a9447d768ad2b406334a19af1d9a73d1` — fix: refresh derived media state after content saves
- `ce739455081e19285a67d1526c479b2a313e32b4` — fix: retain reviewed ownership through connection completion
- `a6582f7f570d1aae453d5601d0c508234cc5d149` — fix: complete consent delivery across authored themes
- `68b555ca5862f32f2424fe0f6b9a435bef57587a` — test: align focused fixtures with existing contracts

The completed report is committed after these code heads; the final response identifies those report-inclusive branch tips.
