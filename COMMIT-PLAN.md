# X4 rest Jini fix pass

Base: `2e5984c66` on `codex/x4f-restj`. Working-tree delivery only; no commits.
No installs, builds, tests, mutations, typechecks, linters, or package intake run.
The dispatch overrides the missing local AI-Dev-Shop bootstrap and forbids delegation.
The supplied design is the approved pattern; no additional pattern approval is needed.

## Constraints and sequence

Core prerequisites first, then independent admin/public corrections. Reuse existing owners;
no new runtime dependency edges, no undeclared-package type imports, no theme changes.
Tests are written before their corresponding production edits; mutation names below are
targets for the coordinator, never claims of executed mutation results.
Only Jini is writable scope. Tovu G3 residual LOC, exact keeps, source deletion, and
counter reconstruction belong to the Tovu coordinator. Appendix B is absent from the
dispatch, so K0 cannot be reconstructed here without inventing keep paths.

## Completed logical commits

### X4-02, X4-03, X4-10 prerequisite corrections
- Files: core/src/registration-kit.ts; daemon/src/surface-exchanges/__tests__/human-confirm.lifecycle.test.ts; infra/package.json; cms/src/html/site/{safe-url.ts,__tests__/safe-url.test.ts}.
- Added positional refuseUnexpectedKeysPort without changing existing ports; infra now classifies all four exports; internal URL origin is jini-safehref.invalid.
- Witnesses first: first unexpected key and unchanged allowed-input behavior; relative output excludes internal origin. Required mutations retained: report-expiry-as-user-cancel and skip-post-click-grant-read (host grant witness); apply-private-path-policy-before-url-normalization. The positional-port assertions pin the listed first-unexpected-key case.

### X4-11, X4-26, X4-27, X4-41 first-pass blockers
- Files: user-management/src/admin-http/owner/__tests__/owner-passkey-routes.unit.test.ts; cms/src/public-http/http/site/{render-site.ts,__tests__/render.golden.characterization.test.ts}; cookie-consent/src/site/{http.ts,__tests__/site-cookie-consent.regressions.unit.test.ts}; commerce/src/http/{purchase.ts,__tests__/purchase.test.ts}.
- Passkey RP name was already required/injected. Added admission-before-origin and 8K/16K cap witnesses before production work. Mutations: admit-before-origin-check, raise-passkey-body-cap.
- Template resolver inputs now accept the host's null no-match result. Existing render-order witness uses those actual results. Mutation: collect-assets-before-body-transform.
- analyticsProof now defers cookie getter until full consent; added non-full proof and retired receipt witnesses. Mutations: read-proof-cookie-before-level, skip-active-receipt-read.
- Purchase limiter contract accepts success without retryAfterSeconds; existing invalid-input/origin/read-only witness uses that actual shape. Mutations: activate-before-origin, allocate-write-snapshot-for-return.

### X4-16 — external MCP shared route helpers
- Created `packages/cms/src/admin-http/routes/external-mcp/route-helpers.ts` and `__tests__/external-mcp-route-failures.unit.test.ts`; changed `packages/cms/package.json`; created `.changeset/x4-16.md`.
- Exported `withinRateLimit({ deps })` (check, Retry-After writer, JSON writer, per-family copy) and `externalMcpErrorStatus({ error, deps })` (injected error constructors; known reply or undefined). The host must keep separate limiter instances and its OAuth gate order.
- Tests first: probe limiter refusal and typed/unknown external error projection. Mutations: skip-rate-limit-on-probe (requires the host binding witness too), apply-one-gate-order-to-all-oauth-routes (host witness retained).

### X4-18 — deferred ZIP and install failure mapping
- Changed `packages/cms/src/admin-http/routes/plugins/install.ts`; created `__tests__/unit/install-route.unit.test.ts` and `.changeset/x4-18.md`.
- Exported `readZipUpload({ deps })` and `respondInstallFailure({ error, deps })`. ZIP body reads remain after parser completion, with both original body accesses retained.
- Test first: valid apply input plus denied authorization never invokes the ZIP parser. Mutation: mount-zip-parser-before-auth. Removing duplicate host telemetry is still a Tovu binding edit; no telemetry was added here.

### X4-19 — overwrite selection
- Changed `packages/cms/src/admin-http/routes/publish-content/{peer-transport.ts,__tests__/peer-transport.routes.pins.test.ts}`; existing `.changeset/x4-19.md` already covers the entry.
- Moved `acceptOverwriteEntityKeys`, `OVERWRITE_REFUSED`, and `OverwriteRule` into the peer-transport entry. Express is an existing peer; its Response import is type-only. Existing positional ports are unchanged.
- Test first: session refusal prevents the deferred openPeer call. Mutation: read-peer-secret-before-route-gate. Existing typed/unknown transport-code witness remains.

### X4-20 — SSE headers, admission and namespace cache
- Changed `packages/cms/src/admin-http/routes/settings/events.ts`; created `.changeset/x4-20.md`; retained existing `__tests__/events.test.ts` characterization.
- Exported `sseWriteHeadHeaders({ httpVersionMajor })`, `admitSubscriber({ deps })`, and `createNamespaceResolver({ deps })`. Existing feed loop and timers are unchanged.
- Characterization precedes this move: existing `events.test.ts` pins the safe head-read failure after headers and before scheduling. Mutation: read-head-before-write-head. No added header/cache/admission test cases remain beyond the sheet.

### X4-21 — credential list operation and public preview helpers (partial)
- Changed `packages/cms/src/admin-http/routes/system/publish-credentials/{list.ts,__tests__/publish-credentials-route.test.ts}` and `packages/devops/src/deploy/site/static-publish/admin-publish-read.ts`; existing `.changeset/x4-21.md` covers both packages.
- Exported `listPublishCredentialsReply({ deps })`: list -> JSON write -> unawaited healing. `PublishCredentialSummary` is declared structurally in the target, as G1 requires; CMS imports no devops type or value. Direct principal rejection remains in the host admission binding.
- Exposed already-moved `credentialChoice`, `httpPublishPreview`, and `readPreviewTarget`; `publicCredentialSpec` stays private beside them.
- Test first: list response precedes healing. Mutation: heal-before-list-response. Existing devops preview/descriptor witnesses predate this pass and retain inspect-unconfigured-target and spread-target-descriptor.
- STOP only `startAdminPublish`: WAL-13c prerequisite is absent (`packages/devops/src/deploy/site/static-publish/publish-run.ts` and its runtime are not present). No replacement publish runtime or new neutral contract was invented. The Tovu file is not counted as a completed binding yet.

### X4-24 — saved-key gate and failure projection
- Changed `packages/cms/src/admin-http/routes/system/site-share-password.ts`; created `__tests__/site-share-failures.test.ts` and `.changeset/x4-24.md`.
- Exported `requireSavedKeysOwnerSession({ deps })` and `sendSiteShareFailure({ error, deps }, options)`. Error classes, owner copy, owner/session/origin facts and response/report effects are injected. Original refusal, upload and export-stage projections and their why-comments moved together.
- Tests first: publish-trust refusal before owner/origin reads or reveal; password error redaction and export failure metadata. Mutation: skip-publish-trust-check. The host retains call-reveal-before-origin-check on the actual reveal binding.

### X4-25 — shared member auth writer and unlink security witness
- Changed `packages/user-management/src/members/public-member-auth-response.ts` and `src/member-login/__tests__/unlink-identity.test.ts`; existing `.changeset/x4-25.md` covers this package.
- Exported `sendMemberAuthError({ error, deps }, options)` for both host writers. The selected refusal mapper, report, response writer and host copy are required injected members.
- Existing auth-response characterizations are retained. Added last-method unlink refusal before identity/session/member writes. Mutation: unlink-last-sign-in-method. The transaction itself is unchanged.

### X4-30, X4-41 — live plugin contributions and shared member admission
- Changed `packages/cms/src/public-http/routes/plugin-contributions.ts`, `packages/user-management/src/members/{access-resolver.ts,__tests__/access-resolver.test.ts}`; created CMS `public-http/routes/__tests__/integration/plugin-contributions.auth.integration.test.ts`; created `.changeset/x4-30.md` and `.changeset/x4-41.md`.
- Moved router construction, durable activation middleware, error mapper, response writer and auth assembly into the existing CMS entry. `registerPluginContributionRoutes({ app, deps, auth, kit })` requires Router, parsers, oversized-body handler and host error sink; the Router is rebuilt per request, with activation before auth/parsers.
- `createPluginRouteAuthPorts({ deps })` requires the operator/session/permission binding and the shared active-member binding; CMS imports no user-management type or value.
- Exported `activeMemberFromSession({ deps })` from user-management's existing access-resolver entry. It owns cookie refusal handling, member status, credential cutoff and session lookup, preserving buyer's read order.
- Tests first: inactive activation gate does not advance to parsing; revoked member session is refused and an older cutoff admits the same session. Mutations: parse-plugin-body-before-activation, accept-revoked-member. Existing live-generation test covers skip-post-handler-generation-check. Original commerce order/origin/return witnesses now use the real core success limiter shape.

### X4-31 — comment lazy wrapper
- Changed `packages/cms/src/public-http/routes/site/{comments-submit.ts,__tests__/comments-submit.test.ts}`; created `.changeset/x4-31.md`.
- Exported `registerCommentsSubmitRoute({ app, deps })`. Existing same-origin decision is reused; the host passes a one-expression binding to it. The existing submit factory, form parser, client-IP policy and accepted-event callback are required dependencies; there is no analytics import or new runtime package edge. Factory import is type-only, keeping this existing entry universal.
- Test first: foreign-origin request cannot enumerate the provider. Mutation: enumerate-provider-before-origin-admission. Salt validation and the caught preparation Promise preserve their existing why-comments.

### X4-33 — CSP host merge
- Changed `packages/cms/src/public-http/routes/site/pages/response.ts`; created `.changeset/x4-33.md`; retained the existing response and host Vary witnesses.
- Exported `addPluginExportHostsToResponse({ response, hosts })` beside the finalizer. The host's existing addPluginHosts callback becomes one expression calling it; conditional policy extension now lives in CMS.
- Existing finalization/consent response characterization precedes this move. Mutation: overwrite-vary-on-consent still belongs to the actual host response writer; no new host Vary writer or additional test cases are introduced here.

## Full sheet disposition

| Sheets | Jini disposition |
| --- | --- |
| X4-01, 04, 06, 07, 09, 17 | First-pass sources and entries retained; this pass did not reimplement them. Desktop still needs its Tovu-side cutover. X4-17 host cutover stays ordered after WMZ04. |
| X4-02, 03, 10 | Reviewed prerequisite fixes implemented above. |
| X4-11 | RP name already injected; added the two requested security witnesses. |
| X4-05, 08, 12, 13, 15, 22, 29, 38, 39, 40, 42, 43 | Reuse/keep-only Jini portions remain unchanged; host work is still owned by the Tovu lane. |
| X4-14 | Existing `user-management/src/admin-http/routes/api-keys/__tests__/api-key-routes.test.ts` already executes real create/revoke services with a grantless viewer and requires 403 for every route. It also asserts that the key remains unrevoked. Mutations to run: revoke-without-grant and create-principal-without-grant; no duplicate tests or service implementation added. |
| X4-16, 18, 19, 20, 24, 25, 30, 31, 33 | Jini corrections implemented above; host bindings and G3 checks remain. |
| X4-21 | List and read helpers built; startAdminPublish stopped on missing WAL-13c prerequisite. |
| X4-23 | Existing Jini operations import only core; no devops/http-kit edge added. Session credential gate, origin refusal copy at host :170, busy slot and timers are host admission/transport work. Mutation skip-session-credential-gate must run on that host witness. |
| X4-26 | Null template-resolver result mismatch fixed. Consent assets remain injected; no cookie-consent import added. |
| X4-27 | Eager proof-cookie read fixed. Default http-mounts move is stopped at G1's 15-member limit; see below. |
| X4-28 | Existing `core/src/contracts/site/__tests__/site-serving-gate.test.ts` compares `/admin/settings` with `/admin-news`, asserting no exempt-arm status read. This already rejects both read-site-status-before-exemption and exempt-admin-prefix-without-trailing-slash. No second serving policy added. |
| X4-32 | Existing Jini rendition-access owner is retained; deletion of the 74–352 duplicate is Tovu-only. CMS route entry uses same-package media owners and no new forbidden package edge. |
| X4-34, 35 | STOP individual operations: required CRP witness paths are absent. See exact paths below. |
| X4-36 | Existing marketing, post-not-found, bare-before-theme/template-selection and nested-path operations retained. Home/slug cuts and generic/bare/virtual rendering are still partial; no empty exports or forwarders created to conceal the missing bodies. |
| X4-37 | First-pass video projector retained; render cut stopped on the absent named witness. |

## Exact stopped work

- X4-27 default target `cookie-consent/site/http-mounts`: a direct move needs more than 15 injected host collaborators before adding route/asset copy. The source reads createRateLimiter, resolveClientIp, CONSENT_SAVE_PROFILE, clock, siteReceiptStore, readSiteConsentPolicy, toWebRequest, siteConsentPlugins, resolveSiteConsentOrigin, readSiteVisitorConsent, siteConsentDocumentAssets, resolveActiveTheme, resolveActiveThemeId, NO_THEME_ID, isStaticExportRequest, reportServerFailure, and the transport parser/mounts. cookie-consent has no Express peer and cannot import CMS or platform. Per G1, STOP the file; no intake, new dependency, split file, helper or wrapper was invented. Its Tovu residual remains **not counted**.
- X4-34 required witnesses missing: `packages/cms/src/public-http/routes/site/pages/render-context/__tests__/media-metadata.test.ts` and `post-previews.test.ts`.
- X4-35 required witnesses missing: `packages/cms/src/public-http/routes/site/pages/__tests__/static-tier.test.ts` and `template-render.test.ts`.
- X4-36 home and slug orchestration still read more than 15 bound theme/member/routing/render collaborators. Their dependent render operations have no existing neutral theme/request contract in this checkout. The first-pass contracts were explicitly partial; completing them requires an approved structural contract/cut rather than adding undocumented generics, a new shared contract module, or a theme import. No whole-sheet stop: the independent existing operations remain available. Do not count these Tovu residuals.
- X4-37 required witness missing: `packages/cms/src/admin-http/routes/posts/__tests__/template-preview-render.test.ts`. No replacement characterization was invented for an explicitly required existing witness.
- K0: Appendix B's 177 paths, planner/scanner and host keep reports are not supplied in this Jini checkout. No keep entries, counter movement, residual LOC or Tovu deletion is claimed. No OPUS/REJECT sheet outside rest was implemented.

## Tovu integration contract

New subpath: `@jini-ai/cms/admin-http/routes/external-mcp/route-helpers` (types/import/default and universal/admin-http classification). CMS does not use typesVersions, so none was added.
All other changes extend existing published entries. Named additions are listed per sheet above.
Core root already exports registration-kit; callers can import refuseUnexpectedKeysPort directly from `@jini-ai/core`. Existing positional validation ports must keep their signatures.
Pass request-bound closures for JSON, session/origin, error reporting and getters. Preserve the stored copy/headers/keys from the dispatch in the Tovu binding. `listPublishCredentialsReply` receives a JSON callback that must still call `res.status(200).json(body)`.
Share `activeMemberFromSession` across plugin contributions, purchase and media entitlement bindings; keep cookie parsing in its injected sessionToken callback and nowIso lazy.
No MOVE file is marked end-to-end done here: the coordinator must delete it or check its actual residual against G3, record residual LOC, and only then add its exact keep.

## Architecture and pre-completion review

Status: **WARNING / PARTIAL**, with stopped prerequisite/contract work above.
Checked in the diff: no new runtime @jini-ai dependency edge, no undeclared cross-package type import, no new forwarding shell, no theme mutation, no production validation or branch removal. Reused core RateLimitResult rather than a second commerce limiter contract. Moved why-comments remain with moved behavior; no new explanatory comments were added.
Public callbacks/error constructors are declared in their target files. Core's requested positional adapter and the moved requireActivatedPlugin(deps, snapshot) retain their specified/original positional signatures. Existing registration-kit already exceeds 500 lines and the sheet explicitly requires extending it; it was not split or reformatted.
Functions reviewed by direct source/diff inspection; metric tooling was prohibited, so no measured complexity claim is made.

| Assessment units | Disposition | Finding / local action |
| --- | --- | --- |
| refuseUnexpectedKeysPort, safeImageSrc, template/limiter contracts | INCONCLUSIVE | Direct witnesses written/updated; execution prohibited. Kept root exports and positional port compatibility. |
| withinRateLimit, externalMcpErrorStatus, readZipUpload, respondInstallFailure, acceptOverwriteEntityKeys | INCONCLUSIVE | Maintained decision/effect order and per-family copy; preserved both deferred ZIP body reads. |
| admitSubscriber, headers, namespace resolver, saved-key gate/failure projections | INCONCLUSIVE | Required facts/reporters injected; publication trust short-circuit and safe failure projection have direct pins. |
| listPublishCredentialsReply, preview helper exposure, sendMemberAuthError | INCONCLUSIVE | Response-before-heal pin and retained auth-response characterizations; no new list mount or credential backend. |
| plugin router/auth/activation, comment lazy wrapper, CSP merge, activeMemberFromSession | INCONCLUSIVE | Activation/provider/credential-cutoff pins; no runtime user-management/analytics edge into CMS. |
| analyticsProof | INCONCLUSIVE | Cookie getter is deferred past non-full refusal, with an observable getter pin. |
| Missing render/consent/publish cuts | REQUIRED | G1/prerequisite/contract blockers reported above; no speculative implementation added. |

Fresh evidence: `git diff --check` passes (whitespace only). No test suite, mutation, build, install, typecheck, linter, API-baseline update, package intake, runtime harness, commit or push ran. No pre-existing test was deleted or assertion weakened. No coverage percentage or runtime-readiness claim is made.

Diff cleanup deletions: removed accidental JSON Unicode-escape reformatting; removed an intermediate duplicate commerce limiter result shape in favor of core RateLimitResult; removed the unnecessary comments-entry runtime reclassification by making the existing handler factory required injection with a type-only import. Removed only this pass's unrequested SSE header/cache/admission tests, the extra member error-writer test, and the extra CSP test; all pre-existing tests remain unchanged or strengthened. No pre-existing source file or test was deleted.

## Final working-tree inventory

- `M` `packages/cms/package.json`
- `M` `packages/cms/src/admin-http/routes/plugins/install.ts`
- `M` `packages/cms/src/admin-http/routes/publish-content/__tests__/peer-transport.routes.pins.test.ts`
- `M` `packages/cms/src/admin-http/routes/publish-content/peer-transport.ts`
- `M` `packages/cms/src/admin-http/routes/settings/events.ts`
- `M` `packages/cms/src/admin-http/routes/system/publish-credentials/__tests__/publish-credentials-route.test.ts`
- `M` `packages/cms/src/admin-http/routes/system/publish-credentials/list.ts`
- `M` `packages/cms/src/admin-http/routes/system/site-share-password.ts`
- `M` `packages/cms/src/html/site/__tests__/safe-url.test.ts`
- `M` `packages/cms/src/html/site/safe-url.ts`
- `M` `packages/cms/src/public-http/http/site/__tests__/render.golden.characterization.test.ts`
- `M` `packages/cms/src/public-http/http/site/render-site.ts`
- `M` `packages/cms/src/public-http/routes/plugin-contributions.ts`
- `M` `packages/cms/src/public-http/routes/site/__tests__/comments-submit.test.ts`
- `M` `packages/cms/src/public-http/routes/site/comments-submit.ts`
- `M` `packages/cms/src/public-http/routes/site/pages/response.ts`
- `M` `packages/commerce/src/http/__tests__/purchase.test.ts`
- `M` `packages/commerce/src/http/purchase.ts`
- `M` `packages/cookie-consent/src/site/__tests__/site-cookie-consent.regressions.unit.test.ts`
- `M` `packages/cookie-consent/src/site/http.ts`
- `M` `packages/core/src/registration-kit.ts`
- `M` `packages/daemon/src/surface-exchanges/__tests__/human-confirm.lifecycle.test.ts`
- `M` `packages/devops/src/deploy/site/static-publish/admin-publish-read.ts`
- `M` `packages/infra/package.json`
- `M` `packages/user-management/src/admin-http/owner/__tests__/owner-passkey-routes.unit.test.ts`
- `M` `packages/user-management/src/member-login/__tests__/unlink-identity.test.ts`
- `M` `packages/user-management/src/members/__tests__/access-resolver.test.ts`
- `M` `packages/user-management/src/members/access-resolver.ts`
- `M` `packages/user-management/src/members/public-member-auth-response.ts`
- `??` `.changeset/x4-16.md`
- `??` `.changeset/x4-18.md`
- `??` `.changeset/x4-20.md`
- `??` `.changeset/x4-24.md`
- `??` `.changeset/x4-30.md`
- `??` `.changeset/x4-31.md`
- `??` `.changeset/x4-33.md`
- `??` `.changeset/x4-41.md`
- `??` `COMMIT-PLAN.md`
- `??` `packages/cms/src/admin-http/routes/external-mcp/__tests__/external-mcp-route-failures.unit.test.ts`
- `??` `packages/cms/src/admin-http/routes/external-mcp/route-helpers.ts`
- `??` `packages/cms/src/admin-http/routes/plugins/__tests__/unit/install-route.unit.test.ts`
- `??` `packages/cms/src/admin-http/routes/system/__tests__/site-share-failures.test.ts`
- `??` `packages/cms/src/public-http/routes/__tests__/integration/plugin-contributions.auth.integration.test.ts`

## Direct test declaration counts (static inventory only)

These are direct it/test declarations in touched files, not executed or parameter-expanded test counts. No pre-existing declaration was removed.

| File | Before | After |
| --- | ---: | ---: |
| `packages/cms/src/admin-http/routes/publish-content/__tests__/peer-transport.routes.pins.test.ts` | 1 | 2 |
| `packages/cms/src/admin-http/routes/system/publish-credentials/__tests__/publish-credentials-route.test.ts` | 1 | 2 |
| `packages/cms/src/html/site/__tests__/safe-url.test.ts` | 2 | 2 |
| `packages/cms/src/public-http/http/site/__tests__/render.golden.characterization.test.ts` | 1 | 1 |
| `packages/cms/src/public-http/routes/site/__tests__/comments-submit.test.ts` | 8 | 9 |
| `packages/commerce/src/http/__tests__/purchase.test.ts` | 2 | 2 |
| `packages/cookie-consent/src/site/__tests__/site-cookie-consent.regressions.unit.test.ts` | 3 | 4 |
| `packages/daemon/src/surface-exchanges/__tests__/human-confirm.lifecycle.test.ts` | 2 | 2 |
| `packages/user-management/src/admin-http/owner/__tests__/owner-passkey-routes.unit.test.ts` | 2 | 2 |
| `packages/user-management/src/member-login/__tests__/unlink-identity.test.ts` | 2 | 3 |
| `packages/user-management/src/members/__tests__/access-resolver.test.ts` | 15 | 16 |
| `packages/cms/src/admin-http/routes/external-mcp/__tests__/external-mcp-route-failures.unit.test.ts` | 0 | 2 |
| `packages/cms/src/admin-http/routes/plugins/__tests__/unit/install-route.unit.test.ts` | 0 | 1 |
| `packages/cms/src/admin-http/routes/system/__tests__/site-share-failures.test.ts` | 0 | 2 |
| `packages/cms/src/public-http/routes/__tests__/integration/plugin-contributions.auth.integration.test.ts` | 0 | 1 |
