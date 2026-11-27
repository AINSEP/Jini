# ext-crp Jini commit plan

Base: fd06f45b12ae0516b0fc196f58d785eba4d3831e (codex/w3-ext-crpj).
Source: Tovu bf1519bba7 (read from git objects; local Tovu HEAD has advanced).
Tests are written before implementation; no tests, mutations, builds, installs, typechecks or linters run, per dispatch. Coordinator/Opus must execute mutation witnesses, gates and affected API-baseline regeneration. No git writes.

## CRP-01.J — approval copy and catalogs

Files:
- `packages/core/src/contracts/site/approval-i18n.ts`
- `packages/core/src/contracts/site/core-custom-credential-categories.ts`
- `packages/core/src/tool-metadata/agent-pause.ts`
- `packages/core/src/contracts/site/__tests__/approval-i18n.test.ts`
- `packages/core/src/contracts/site/__tests__/custom-credential-categories.test.ts`
- `packages/core/src/tool-metadata/__tests__/agent-pause.test.ts`
- `packages/core/package.json`
- `.changeset/crp-01-contract-catalog.md`

Named mutations: approval-labels-always-english; drop-general-category; resume-adds-second-confirmation.

## CRP-02.J — confirmation lifecycle

Files:
- `packages/core/src/contracts/site/daemon-surface-exchanges.ts`
- `packages/daemon/src/surface-exchanges/chat-delete-grant.ts`
- `packages/daemon/src/surface-exchanges/human-confirm.ts`
- `packages/daemon/src/surface-exchanges/__tests__/chat-delete-grant.test.ts`
- `packages/daemon/src/surface-exchanges/__tests__/human-confirm.test.ts`
- `packages/daemon/package.json`
- `.changeset/crp-02-human-confirm.md`

Named mutations: skip-post-click-grant-read; allow-delete-without-grant-reader.

## CRP-03.J — traced outbox delivery

Files:
- `packages/infra/src/events/domain-outbox.ts`
- `packages/infra/src/events/__tests__/domain-outbox.test.ts`
- `.changeset/crp-03-outbox-delivery.md`

Named mutations: strip-before-reading-parent.

## CRP-04.J — PARTIAL: stored-media builder only

Files:
- `packages/cms/src/admin-http/routes/media/stored-media-response.ts`
- `packages/cms/src/admin-http/routes/media/__tests__/stored-media-response.test.ts`
- `packages/cms/package.json`
- `.changeset/crp-04-admin-dtos.md`

Named mutations: report-upload-length-for-svg (written); spread-presentation-settings (left with stopped projection).

STOP: the literal approved import `../../presentation/sql/repo.js` does not export `PresentationSettingsRecord`; it only imports the type from `../presentation.js`. Adding a re-export or silently changing the approved import is outside this sheet. The independent stored-media builder is retained.

Deleted during own-diff review: newly authored `admin-http/http/presentation.ts`, its new test and its new manifest entries/export. None existed at HEAD. No existing production/test deletion.

## CRP-05.J — PARTIAL: stored-credential probe only

Files:
- `packages/cms/src/admin-http/routes/assistant/stored-credential-probe.ts`
- `packages/cms/src/admin-http/routes/assistant/__tests__/stored-credential-probe.test.ts`
- `packages/cms/package.json`
- `.changeset/crp-05-admin-projections.md`

Named mutations: skip-saved-endpoint-match (written); put-install-warning-in-body (left with stopped install response).

STOP: install-response requires `@jini-ai/agent-plugins/lifecycle`, absent from CMS dependency declarations. That barrel imports `update-store.ts` (`node:path`) and other Node-backed lifecycle modules, conflicting with the required universal entry. Adding a dependency or error-predicate ports is not listed. No install-response implementation/export/test added. Independent probe proceeds.

## CRP-06.J — PARTIAL: refusal primitives except import errors

Files:
- `packages/cms/src/admin-http/routes/publish-content/route-helpers.ts`
- `packages/cms/src/admin-http/routes/system/mail-providers.ts`
- `packages/cms/src/admin-http/routes/system/site-share-password.ts`
- `packages/cms/src/admin-http/routes/publish-content/__tests__/route-helpers.test.ts`
- `packages/cms/src/admin-http/routes/system/__tests__/mail-providers.test.ts`
- `packages/cms/src/admin-http/routes/system/__tests__/site-share-password.test.ts`
- `packages/cms/package.json`
- `.changeset/crp-06-refusal-seams.md`

Named mutations: reverse-refusal-precedence; store-classification-first; drop-exact-origin-check (written); echo-plugin-exception (left with stopped import-errors).

STOP: import-errors port is specified as `(required: { error: unknown }) => error is Error`; `error` is not a parameter of that function, so the type predicate cannot compile or narrow the caller error. Requires a corrected approved port contract. No import-errors implementation/test/export added.

## CRP-07.J — member response seams (constant move stopped)

Files:
- `packages/user-management/src/members/public-member-response.ts`
- `packages/user-management/src/members/public-member-auth-response.ts`
- `packages/user-management/src/members/__tests__/public-member-response.test.ts`
- `packages/user-management/src/members/__tests__/public-member-auth-response.test.ts`
- `packages/user-management/package.json`
- `.changeset/crp-07-public-member-seams.md`

Named mutations: spread-internal-member; map-all-validation-as-reset; negative-member-cookie-max-age.

STOP on the MEMBER_AUTH_FAILURE private-constant move: the pinned source still reads it in retained host `sendMemberAuthError` (lines 76–77); the neutral mapper does not read it. Moving it privately would leave the host writer without its operation/copy, or introduce unused code. Existing `toMemberAuthRefusal` is absent in the scoped Jini members directory; the specified `memberAuthRefusal` moves directly using existing types/errors.

## CRP-08.J — consent cache and visitor analytics

Files:
- `packages/cookie-consent/src/site/pre-consent-cache.ts`
- `packages/cookie-consent/src/site/__tests__/pre-consent-cache.test.ts`
- `packages/analytics/src/site/visitor-analytics.ts`
- `packages/analytics/src/site/__tests__/visitor-analytics.test.ts`
- `packages/cookie-consent/package.json`
- `packages/analytics/package.json`
- `.changeset/crp-08-consent-and-analytics.md`

Named mutations: malformed-config-is-cacheable; skip-delivery-consent-recheck.

## CRP-09.J — visitor confirmation raw spec

Files:
- `packages/daemon/src/surface-exchanges/site-assistant-confirm.ts`
- `packages/daemon/src/surface-exchanges/__tests__/site-assistant-confirm.test.ts`
- `packages/daemon/package.json`
- `.changeset/crp-09-visitor-confirm.md`

Named mutations: confirm-before-origin.

## CRP-10.J — STOPPED

The mandated core `contracts/site/comments-providers.ts` does not export `CommentSubmission` or `CommentsStoredProvider`. It exports `CommentSubmissionPort` and a `CommentsProviderAdapter` union whose stored arm owns `submission.submit`; that result is `{ ok: true; id; status }`, whereas the moved ingress returns `{ ok: true; comment: { id; status } }`. The FIX type `Awaited<ReturnType<CommentsStoredProvider["submit"]>>` cannot type that output. No new types, adapters, tests or exports invented. Needs a corrected approved type seam; no CRP-10 changes.

## CRP-11.J — PARTIAL: marketing and bare-page only

Files:
- `packages/cms/src/public-http/http/site/render/components/marketing.ts`
- `packages/cms/src/public-http/http/site/render/__tests__/marketing.test.ts`
- `packages/cms/src/public-http/http/site/render/body-render-ports.ts`
- `packages/cms/src/public-http/http/site/bare-page.ts`
- `packages/cms/src/public-http/http/site/__tests__/bare-page.test.ts`
- `packages/cms/package.json`
- `.changeset/crp-11-render-seams.md`

Named mutations: skip-action-href-admission; wrap-full-authored-html (written). Remaining four witnesses left with stopped modules.

STOP: `packages/cms/package.json` classifies existing `./media/cover-image` as `node`; its source imports `parse5`, forbidden by CMS isolation for `universal` entries. The mandated direct imports in post-body and template-render-data therefore violate H1. Entry-lists depends on template-render-data; blocks depends on post-body. No unlisted cover ports, parser split, new dependencies or runtime changes introduced. Marketing and bare-page are independent and retained.

Deleted during own-diff review: the four newly authored modules `render/{post-body,template-render-data,blocks}.ts` and `render/components/entry-lists.ts`, their four new test files, and their new manifest entries/exports. These were not present at HEAD. No existing production code/tests deleted or weakened.

## CRP-12.J — page head composition

Files:
- `packages/cms/src/public-http/routes/site/pages/extra-head.ts`
- `packages/cms/src/public-http/routes/site/pages/__tests__/extra-head.test.ts`
- `packages/cms/package.json`
- `.changeset/crp-12-extra-head.md`

Named mutations: use-home-canonical-for-marketing-page.

## Delivery status and review

Implemented full sheets: CRP-01.J, CRP-02.J, CRP-03.J, CRP-08.J, CRP-09.J, CRP-12.J.
Partial sheets: CRP-04.J (stored media), CRP-05.J (credential probe), CRP-06.J (mapped/mail/share primitives), CRP-07.J (all functions; private constant move stopped), CRP-11.J (marketing and bare-page).
Stopped sheet: CRP-10.J. All exact reasons appear above. No Jini sheet in this set is labelled BUILDER: OPUS, REJECT or NEEDS-OPUS; none of those was built. All .T sheets are outside this Jini-only dispatch.

58 changed/new files, including this plan; 17 new test files and 2 extended existing test files, with 24 added test cases. No existing test case removed or weakened. Each retained test was written before its implementation. Named mutations are listed per sheet; none has been applied or run. Changesets are minor for the named packages. API baselines are untouched, per dispatch.

Final own-diff review removed only newly authored work whose specified prerequisites failed (listed under CRP-04 and CRP-11). No existing production files were deleted. Removed the unnecessary dynamic import from the new mail classifier test in favor of the existing static import. No new helpers/abstractions beyond the named metadata factory, specified private confirmation-opening helper, and private BodyRenderPorts contract. Moved rationale comments retained; neutral source-copy seams use supplied host values. The approval routine table retains all 22 locales (English plus 21 translations), first eight values per row.

Architecture audit: PARTIAL / WARNING. Manually inspected the declared inputs/outputs, dependency seams, universal entries, host-owned copy/identity exclusions, grant/access check order, request admission, secret endpoint pinning, consent proof/delivery checks, and authored-document handling. The scoped `rg -i "tovu|open design|OD_"` over new Jini modules returned no matches. Blocked dependency/type seams are not shipped. This is source inspection, not compiler, isolation-gate or runtime evidence.

| Assessment units | Static disposition | Direct witness |
| --- | --- | --- |
| approvalText/familyText; resume metadata; credential vocabulary | retained; fallback and literal-ID seams reviewed | CRP-01 tests |
| requireChatDeleteGrant; requireHumanConfirm; requireAccessApprover; withoutRestore/openConfirmation | retained; two grant/access reads, pre-abort, listener cleanup and observe-only receipts reviewed | CRP-02 tests |
| trackOutboxDelivery | retained; parent read precedes preparation inside trace, rejection propagates | CRP-03 test |
| toStoredMediaResponse | retained; URL-before-size, SVG-only size read and zero preserved | CRP-04 test |
| resolveProbeCredential; normalizeEndpoint; endpoint comparison | retained; selected reader only, failures carry no key | CRP-05 tests |
| knownMappedErrorResponse; classifyMailProviderError; savedKeysSameOrigin/status/upload refusal | retained; precedence and exact-origin rules reviewed | CRP-06 tests |
| member projection/cookie/auth/sign-in refusal functions | retained; allowlist, two clock reads and safe typed refusals reviewed | CRP-07 tests |
| preConsentCacheControl/hasConsentGatedScripts; visitor provenance/capture | retained; literal config ID, lazy cookie gate and delivery recheck reviewed | CRP-08 tests |
| confirmationBody; siteAssistantConfirmRoute.handle | retained; admission order, owner omission, reporting and no-store reviewed | CRP-09 tests |
| marketing renderers/private markup helpers; renderBareEntryDocument | retained; href admission and raw document classification reviewed | retained CRP-11 tests |
| buildExtraHead | retained; canonical precedence and contributor fold reviewed | CRP-12 test |

Runtime and coverage assessment: NOT RUN, explicitly prohibited by dispatch. No performance, coverage, typecheck or passing-test claim. No new recurring workers, polling, retries or retained collections added. Existing bounded catalogs and per-call ports are preserved. Skepticism review found the prerequisite/declaration errors recorded above rather than assuming the approved sheet text was executable. The coordinator must verify function metrics and run the named mutation witnesses before accepting the sheets.

## Tovu consumption / cloud verification

Tovu uses its existing workspace dependency/release workflow for the new subpaths below. Host-only copy, cookie identities, request facts, error classes/reporters and secret readers remain bound in Tovu. No Tovu code changed. CRP-05.T must leave install-response local; CRP-06.T must leave import-errors local; CRP-07.T must keep MEMBER_AUTH_FAILURE with its actual host writer; CRP-10.T must wait. CRP-04.T must leave the presentation projection local. CRP-11.T may bind marketing/bare-page but must not repoint the four stopped renderer modules. These are partial delivery constraints, not a revised extraction design.

The stored-media API follows the sheet's `MediaListLookup<number>` size port. Existing CMS list ports permit `number | null`; the Tovu half must reconcile that narrower approved seam before wiring a nullable host map, without changing zero/null behavior.

New subpaths (each has types/import/default plus universal jini.entries):
- `@jini-ai/core/tool-metadata/agent-pause`
- `@jini-ai/core/contracts/site/approval-i18n`
- `@jini-ai/daemon/surface-exchanges/site-assistant-confirm`
- `@jini-ai/daemon/surface-exchanges/human-confirm`
- `@jini-ai/daemon/surface-exchanges/chat-delete-grant`
- `@jini-ai/cms/public-http/routes/site/pages/extra-head`
- `@jini-ai/cms/public-http/http/site/bare-page`
- `@jini-ai/cms/public-http/http/site/render/components/marketing`
- `@jini-ai/cms/admin-http/routes/system/site-share-password`
- `@jini-ai/cms/admin-http/routes/publish-content/route-helpers`
- `@jini-ai/cms/admin-http/routes/assistant/stored-credential-probe`
- `@jini-ai/cms/admin-http/routes/media/stored-media-response`
- `@jini-ai/user-management/members/public-member-auth-response`
- `@jini-ai/user-management/members/public-member-response`
- `@jini-ai/cookie-consent/site/pre-consent-cache`
- `@jini-ai/analytics/site/visitor-analytics`

Extended existing APIs: core `contracts/site/core-custom-credential-categories`, core `contracts/site/daemon-surface-exchanges`, infra `events/domain-outbox`, CMS `admin-http/routes/system/mail-providers`.

Opus/cloud next: run affected package tests; apply/restore each retained named mutation and confirm its witness turns red; run affected type/build/isolation gates; regenerate only `api-baseline/jini-ai__{core,daemon,infra,cms,user-management,cookie-consent,analytics}.json` with the repository baseline workflow. Focused OPUS-REVIEW remains required for the security/privacy sheets. Resolve each STOP by an approved sheet correction before finishing its omitted work. No commits/pushes performed; the coordinator owns the ordered commits above.
