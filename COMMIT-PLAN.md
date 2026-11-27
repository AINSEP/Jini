# Y5 pub round 2 — Jini handoff

No commits: Git metadata is read-only. G0 is satisfied by coordinator instruction; no tests, installs, builds, typechecks, linters or counters will run. Jini only; no agents or host edits.

## Ordered coordinator commits

1. Site backup — complete pending contributor binding and compare final storage boundary. Prior producer/shared-leaf/keep-off/projection work is in HEAD.
2. Public HTTP — complete consent owners, OIDC bindings, media/member pages, static tier, home/slug/404 and storefront dispatch. Prior gate/response/delivery helper work is in HEAD.

## Test-first seams and mutations

- `backup-recheck-parent`: remove planned-parent comparison in `pushPlannedBackup`; existing divergence test must reject with zero blob uploads.
- `slug-gate-before-template`: move template rendering ahead of member access; gated-post test must observe zero render calls.
- Characterization uses the existing co-located tests and required ports. Tests and mutations are authored but NOT executed, by dispatch.

## Boundaries

Only sheet-named files/entries and cases. No root exports, product strings, framework request/response types, devops↔cms imports, or diagnostics imports. Existing owners govern order and behavior. Final render repairs are conditional; retain merge-25 fixes where already present.

## Progress

- Startup: read required programmer skills and previous partial handoff. User's exact sheet and no-execution rules override generic skill priming/verification requests.


## Final per-sheet status

### Commit 1 — Site backup: Jini side authored, execution pending

- Completed the required-catalog/metadata/error/parser/service-binder contributor conversion; catalogModule is injected and definitions indexed once. The returned service bag is enriched in place rather than spread, preserving its lazy source/repo getters and existing plan/job owners. A characterization assertion pins the deferred source read.
- Compared the final host projection and kernel-erasure binding. The existing structural query-handle adapter remains the boundary; removed the projection's unnecessary schema witness claim (`Tables`). No kernel wrapper/reopen or transaction identity change. The existing bound four operations, trusted bootstrap, transform generic and two staging scopes remain.
- Earlier producer snapshots/shared leaf/keep-off/CMS content-store work and tests are already in HEAD; retained. Conditional host share-policy repair belongs to the host half, with merge-25 fixes retained.
- No anchor mismatch, rejected sheet, OPUS-only Jini step or G0 wait remains.

### Commit 2 — Public HTTP: Jini side authored, execution pending

1. Existing serving-gate dispatcher and characterization retained from HEAD.
2. Added consent HTTP factory (request normalization, asset/load/refusal sequencing, readiness and mount order, context/collector/receipt handlers, diagnostics gate), idempotent weak-map document owner with per-install clocks and injected scheduler, and live-only document plugin composition. Host supplies filesystem/server APIs, raw caps, limiter key checks, copy, wire names, failure reporters and the normalized diagnostics contribution.
3. Added callback/proof outcome assembly with ordered request-context/browser-binding reads and lazy cookie/announcement/member projection, plus all three binding factories exposing the shared header/observe/check/run preflight. Existing raw specs retain cookie cleanup/fixed failures. Existing user-management continuation refusal retained.
4. Added request-bound media handler factory with method/path data, one normalization owner, lazy cache/entitlement, structural reply mapping and required original-reply writers. Host owns Node hashing/byte conversion. Both original spellings share the same handler.
5. Added four independent member view builders under createMemberPages and reply dispatch. Paths, page IDs and all visible copy/label formatters are injected; member-script attributes remain in Jini.
6. Existing page sender/finalization tests retained from HEAD.
7. Added staticThemeScripts and static index title/head/chat/delivery. Passed the actual preview-access value to the preview port. Conditional menu/undefined-embed repairs were still needed in Jini and are propagated only through the named render boundaries. Existing chat selection union is retained. Marketing gets separate normal and explicit-title callbacks. No theme edits or admin template-preview edits.
8. Added 404/catch dispatch, home precedence, shared context/theme decisions, single-slug and nested dispatch. Home filters/sorts before rendering; denied roots behave like missing roots; slug gates precede both rendering branches. Portable why-comments moved with the pipeline.
9. Added storefront context/outcome/error dispatch around existing bounded-list and point-lookup specs; checkout remains after rendering, shared finalization after checkout.

The home subpath has types/import/default exports, universal runtime and presentation metadata. The subpath-isolation test audits all entries and does not enumerate handler paths, so no test-enumeration edit was needed. Internal page-route-context and oidc-shared have no new package entry. Both existing changesets were updated.

## Coordinator commit file lists

### Commit 1
- `.changeset/y5-site-backup.md`
- `packages/devops/src/backup/site/__tests__/tool-registrations.test.ts`
- `packages/devops/src/backup/site/share-database/projection.ts`
- `packages/devops/src/backup/site/tool-registrations.ts`

### Commit 2
- `.changeset/y5-public-http.md`
- `packages/cms/package.json`
- `packages/cms/src/public-http/http/site/render-site.ts`
- `packages/cms/src/public-http/routes/members/__tests__/oidc-verify-email.test.ts`
- `packages/cms/src/public-http/routes/members/__tests__/oidc.test.ts`
- `packages/cms/src/public-http/routes/members/__tests__/unlink-identity.test.ts`
- `packages/cms/src/public-http/routes/members/oidc-callback.ts`
- `packages/cms/src/public-http/routes/members/oidc-shared.ts`
- `packages/cms/src/public-http/routes/members/oidc-verify-email.ts`
- `packages/cms/src/public-http/routes/members/unlink-identity.ts`
- `packages/cms/src/public-http/routes/site/__tests__/integration/media-validation.integration.test.ts`
- `packages/cms/src/public-http/routes/site/__tests__/member-pages.test.ts`
- `packages/cms/src/public-http/routes/site/__tests__/products.test.ts`
- `packages/cms/src/public-http/routes/site/media-rendition.ts`
- `packages/cms/src/public-http/routes/site/member-pages.ts`
- `packages/cms/src/public-http/routes/site/pages/__tests__/static-tier.test.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/marketing.test.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/post-not-found.test.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/slug-routes.test.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/marketing.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/post-not-found.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/slug-routes.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/virtual-page.ts`
- `packages/cms/src/public-http/routes/site/pages/static-tier.ts`
- `packages/cms/src/public-http/routes/site/pages/template-render.ts`
- `packages/cms/src/public-http/routes/site/products.ts`
- `packages/cookie-consent/src/site/__tests__/http.test.ts`
- `packages/cookie-consent/src/site/document-assets.ts`
- `packages/cookie-consent/src/site/document-state.ts`
- `packages/cookie-consent/src/site/http.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/__tests__/home.test.ts`
- `packages/cms/src/public-http/routes/site/pages/handlers/home.ts`
- `packages/cms/src/public-http/routes/site/pages/page-route-context.ts`

## Export and host wiring handoff

Only one new package subpath: `@jini-ai/cms/public-http/routes/site/pages/handlers/home` → `serveHomePage`.

New exports on existing entries (in addition to the earlier-round exports already in HEAD):

| Entry | Exports / contract changes |
| --- | --- |
| `@jini-ai/devops/backup/site/tool-registrations` | `contributeSiteBackupTools({catalog,catalogModule,toolMetadata,modelFacingErrors,parseStaticExportInput,parseSiteImportInput,parseSiteImportListQuery,bindServiceDeps})`; metadata required/defined |
| `@jini-ai/devops/backup/site/share-database/projection` | Existing factory retained; kernel query view no longer claims host schema ownership |
| `@jini-ai/cookie-consent/site/http` | `createSiteConsentHttp` returning load/client, readiness, cookie, diagnostics, receipt, plugin/context/loader, proof and mounting operations |
| `@jini-ai/cookie-consent/site/document-state` | `createSiteConsentDocumentOwner`; scheduler/warning at construction, site clock at installation |
| `@jini-ai/cookie-consent/site/document-assets` | `documentPlugins` |
| `@jini-ai/cms/public-http/routes/members/oidc-callback` | `completeMemberOidcRouteOutcome`, `bindMemberOidcCallbackRoute` |
| `@jini-ai/cms/public-http/routes/members/oidc-verify-email` | `verifyMemberOidcRouteOutcome`, `bindMemberOidcVerifyEmailRoute` |
| `@jini-ai/cms/public-http/routes/members/unlink-identity` | `bindMemberUnlinkIdentityRoute` |
| `@jini-ai/cms/public-http/routes/site/media-rendition` | `createPublicMediaHandlers`; handler inputs carry request/response, facts and headers; factory supplies structural writer ports |
| `@jini-ai/cms/public-http/routes/site/member-pages` | `createMemberPages`, `serveMemberPage`; reportFault/sendFault are separate |
| `@jini-ai/cms/public-http/routes/site/pages/static-tier` | `staticThemeScripts`, `serveStaticThemeIndex`; generic menu/access values; preview port receives postPreviewsAccess |
| `@jini-ai/cms/public-http/routes/site/pages/handlers/post-not-found` | `handlePostNotFoundOnSlugRoute`, `handleSlugRouteError`; themed finish receives narrowed theme, fallbackHtml is injected |
| `@jini-ai/cms/public-http/routes/site/pages/handlers/slug-routes` | `serveSlugPage`, `serveNestedPage` |
| `@jini-ai/cms/public-http/routes/site/pages/handlers/marketing` | Required separate `resolveAuthoredSiteTitleForRender({preserveAuthoredFallback:true})` and zero-argument normal title reader |
| `@jini-ai/cms/public-http/routes/site/products` | `serveStorefrontProducts`, `serveStorefrontProduct` |

Earlier-round public additions retained: `createSiteBackupCatalog`, `createShareDatabaseProjection`, `dispatchSiteServingGate`, `sendPublicPage`, and `requireOidcContinuationDelivery` at the entries named by the sheets. No root exports.

Host work remains outside this dispatch: retarget every listed caller, delete import-keep-off/post-not-found, finish all 15 G3 bindings, add only qualifying keep lines/LOC rows in the dedicated host keep document, preserve live/deferred readers using bound callbacks/getters, and retain one service plan/job owner plus one consent document owner. Keep all whole-argument storage casts out of callers; bridge the query surface once at the existing SQLite/kernel boundary. Do not edit the other slice's template-preview-render. No count drop or host completion is claimed.

## Test integrity and mutation handoff
In the test files changed this round, static test declarations are 44 → 61 (+17); none deleted. These are source counts, not execution results. Prior-round cases remain in HEAD.

- Added cases: contributor binding/deferred source read; publication owner sharing/isolation, last-good declarations/policy and unpublished export; collector fallthrough/GET cache/path stripping; readiness/assets/store mounting and refusal ordering; callback/proof lazy outcomes and all three preflight guards; original-media URL parity/laziness; member reply/DOM/copy; static title/head/chat/send; marketing title overload; redirect/theme-off/missing/hidden/authored home; slug access gate; catch-path 404 failure; storefront render/checkout/finalization.
- `backup-recheck-parent`: existing HEAD divergence fixture has working upload collaborators. Removing planned-parent comparison must fail the refusal and zero-upload assertions. Not executed.
- `slug-gate-before-template`: new gated-post case asserts only the missing path was reached, with zero template/generic/send calls. Moving template before access must fail even if status stays 404. Not executed.

## Scope cleanup, audit and validation

- Removed the obsolete projection `Tables` alias, the contributor's hardcoded catalog-module string and old zero-input contribution shell, duplicate source parameter normalization, an unused password-label pad, duplicate new imports, and temporary eager spreads. No test or production files deleted in this Jini-only round. No exclusions, suppressions, thresholds, branches or assertions weakened.
- Architecture audit: source-reviewed; runtime/type integration unverified. Boundaries reviewed: no new dependencies, CMS↔devops imports, diagnostics runtime imports, framework request/response types, root/internal-helper public entries, product identity/path imports or theme edits. The query-kernel object and source service owners remain unchanged.
- Function review: new orchestrators are split at the specified request-context/render boundaries; no extra policy owners, caches or retry loops added. Existing caps, timers and ordering preserved. Named new files stay below 500 lines. Risk is host binding/type integration until coordinator verification.
- Reuse: extended the sheet-named owners; existing raw specs, rendition/original services, cache/finalizer, projection SQL, member lifecycle and rendering primitives remain the implementations.
- Cost: same per-site weak-map state and minute refresh/250 ms brief wait; no extra per-page store reads or eager entitlement lookup. Shared catalog indexed once per contribution. No new retained page HTML.
- Documentation: moved portable why-comments; no new filler comments. Server-specific comments belong to host bindings.
- Pre-completion/self-validation: source/diff review only. Tests, mutation runs, installs, builds, typechecks, linters, counters and runtime checks NOT RUN, per dispatch. No pass/coverage claim. No Git mutations, commits or pushes. Coordinator must execute verification and exclude this file from commits.
