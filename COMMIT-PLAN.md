# Y5 pub — Jini working-tree handoff

No commits: `.git` is read-only. No installs, builds, tests, typechecks, or linters are authorized for this dispatch. Tests are written before their implementation; execution and mutation verification belong to the coordinator.

## Base and boundaries

- Actual HEAD: `7b30ee092` on `codex/y5-pubj`; clean at dispatch start.
- Missing prerequisite: `origin/codex/m25-tipj` is absent from the readable Jini clone. Available Jini merge-25 ref is `7b30ee092`; available host merge-25 ref is `48f6802924`, explicitly excluded as the final G0 base. Conditional render/kernel repairs and moves requiring the final repaired host source stay blocked pending final SHAs. Read-only GitHub branch searches for `m25` in both repositories returned no branches. No fetch or rebase was attempted because `.git` is read-only. Final SHAs were requested asynchronously; no answer arrived during the independent work.
- Jini only. No host edits, subagents, dependency intake, themes, root exports, or compatibility forwarders.
- Required ports carry host policy, strings, clocks, stores, readers and writers. No CMS/devops dependency in either direction; diagnostics stays injected.
- Existing implementation and test files named in the sheets govern style. Test seams are injected effects and returned values; authorization, parent divergence, cancellation, cookies and writer ordering are asserted directly.

## Ordered commits for coordinator

1. Site backup: characterization and service/catalog/keep-off/projection changes — IN PROGRESS.
   - Named mutation `backup-recheck-parent`: delete the planned-parent comparison in `pushPlannedBackup`; divergence must refuse with zero blob uploads.
2. Public HTTP: characterization and required neutral HTTP orchestrators — IN PROGRESS.
   - Named mutation `slug-gate-before-template`: render a slug template before checking member access; gated-post characterization must observe zero template calls.

## Validation and final scope review

- Tests/mutations not executed, by dispatch instruction.
- Final per-step status, touched files, public exports and deletions are recorded below as work completes.

## Final status: PARTIAL; neither design commit is complete

Independent additions were implemented against the existing Jini owners. Checked host-source excerpts were read only to compare the named constructs; the checkout was not moved to the excluded host commit. The mandatory final repair base remains unavailable. Remaining source moves and final-base-dependent repairs were stopped rather than treating the checked snapshot as the final base.

### 1. Site backup — partial Jini implementation

Implemented:
- Service: required scoped/server credential-status readers; required config-text/folder-name ports; next-step formatting with injected manifest name; copied typed `producer` record on each saved plan, passed unchanged to the existing upload-policy port. Preserved the parent comparison, repository recheck, post-upload abort check and observability branches. Runtime shared values/functions moved to the specified internal leaf.
- Catalog: `createSiteBackupCatalog` contains the eight definitions and named schemas. Import, commit and share descriptions are required host inputs (the share description also names the host archive format). Original schema field order and risk map retained.
- Keep-off: singular/plural summary selection precedes notice formatting; required sanitizer and no-theme ID retained. CMS `contentStore` selects the existing four-table view from the same schema-erased kernel; no wrapper, reopen or transaction change.
- Projection: four bound operations, separate required archive-media scope, existing SQL owners retained. Exact transform parameters thread through the existing archive/projection generic without an archive-row cast.

Stopped/pending under G0:
- Required-catalog/metadata/error/parser/service-binder contributor conversion, including injected `catalogModule`; the existing contributor remains unchanged. Do not wire the host binding to it as though this conversion shipped.
- Final repaired storage/query-handle boundary and downstream projection alignment must be compared against the final repair tip. No SQLite adapter redesign was attempted.
- Host moves, caller retargets, G3 keeps and count reduction are outside this Jini-only dispatch. No host deletion is claimed.

Files for coordinator commit 1:
- `packages/devops/src/backup/site/backup-service.ts`
- `packages/devops/src/backup/site/backup-service.credentials.ts`
- `packages/devops/src/backup/site/backup-service.plan.ts`
- `packages/devops/src/backup/site/backup-service.push.ts`
- `packages/devops/src/backup/site/backup-service.shared.ts` (created; internal only)
- `packages/devops/src/backup/site/tool-registrations.ts`
- `packages/devops/src/backup/site/import-keep-off.ts`
- `packages/devops/src/backup/site/share-database/projection.ts`
- `packages/devops/src/backup/site/share-database/projection.media.ts`
- `packages/cms/src/site/keep-off-content-store.ts`
- `packages/devops/src/backup/site/__tests__/backup-service.test.ts`
- `packages/devops/src/backup/site/__tests__/tool-registrations.test.ts` (created)
- `packages/devops/src/backup/site/__tests__/import-keep-off.test.ts`
- `packages/devops/src/backup/site/share-database/__tests__/projection.test.ts`
- `.changeset/y5-site-backup.md` (created; required minor bumps)

### 2. Public HTTP — partial Jini implementation

| design step | Jini status | exact outstanding prerequisite/work |
| --- | --- | --- |
| 1 serving gate | implemented, unrun tests | host binding remains outside scope |
| 2 consent HTTP/document owners/assets | stopped | final G0 repair of host consent structural-contribution boundary unavailable |
| 3 OIDC | delivery refusal helper implemented, unrun test; remainder stopped | final source base unavailable for outcome/request binding moves; callback/proof/unlink factories and preflight remain absent |
| 4 media handlers | stopped | required final source base unavailable; factory, normalization and lazy entitlement move remain absent |
| 5 member pages | stopped | required final source base unavailable; markup factory and dispatch remain absent |
| 6 response | implemented, unrun tests | host request decoding and cookie writer binding remain outside scope |
| 7 static tier/render types | stopped | G0 explicitly requires final repair versions; no conditional repairs redone against the old base |
| 8 404/home/slug | stopped, dependent | final render contract from step 7 unavailable; shared context, handlers, home subpath and mutation test remain absent |
| 9 products | stopped, dependent | shared neutral theme-state/context from step 8 unavailable |

Files for coordinator commit 2:
- `packages/core/src/contracts/site/site-serving-gate.ts`
- `packages/core/src/contracts/site/__tests__/site-serving-gate.test.ts`
- `packages/cms/src/public-http/routes/site/pages/response.ts`
- `packages/cms/src/public-http/routes/site/pages/__tests__/response.test.ts`
- `packages/user-management/src/member-login/oidc-request.ts`
- `packages/user-management/src/member-login/__tests__/oidc-request.test.ts`
- `.changeset/y5-public-http.md` (created with the four required minor bumps; hold release until the consent part and remaining sheet work are complete)

### Public API additions; existing entry paths only

| path | added export / contract |
| --- | --- |
| `@jini-ai/devops/backup/site/tool-registrations` | `createSiteBackupCatalog({ importDescription, commitDescription, shareDescription })` |
| `@jini-ai/devops/backup/site/share-database/projection` | `createShareDatabaseProjection({ host, archiveMediaTempRoot })`; optional exact archive transform type parameter on the existing projection contract |
| `@jini-ai/core/contracts/site/site-serving-gate` | `dispatchSiteServingGate({ path, exactPaths, prefixes, readStatus, serve, blocked, failure })` |
| `@jini-ai/cms/public-http/routes/site/pages/response` | `sendPublicPage({ html, perVisitor, preConsentCacheControl, hasConsentGatedScripts, writer, ports })` |
| `@jini-ai/user-management/member-login/oidc-request` | `requireOidcContinuationDelivery({ check })` |

No new public subpath or root export. In particular the requested `home` subpath is NOT delivered. Existing service entry still exports plan/push, tool IDs, permission, wait constant and public service types. Helpers moved into `backup-service.shared.ts` have no public subpath.

### Host half requirements

- Do not mark any of the 17 MOVE files done from this partial handoff; no host files were edited or deleted, and no keep-rule document was created.
- Service ports replace `planVersion`, `readSiteName` and `planNextStep` with required `producer`, `readConfigText` and `manifestName`; scoped status receives `{ siteDir }`, and the server-only status reader is separate. Host manifest assembly must spread the saved `plan.producer` record with its own version key, never read current version defaults during push. Retain the same plan/job owners.
- Keep-off notices provide `morePagesDrafted.singular` and `.plural` functions. Use the final host kernel-erasure adapter when removing the host wrapper.
- Projection binding supplies `host` and `archiveMediaTempRoot`; the four returned operations have host-free required-object arguments. Specialize the existing transform generic where needed.
- Response binding supplies request-bound finalization ports, lazy attempt-ledger lookup, clock and UUID; the dispatcher owns cache/type/widget/token/send sequencing.
- OIDC continuation `check` is a required boolean-returning port; the host check must discard its API-style limit reply as specified.

### Test integrity and mutation handoff

Static test declaration counts (not execution results): backup service 4 → 6; keep-off 12 → 14; projection 1 → 2; tool registrations 0 → 2; gate 1 → 4; response 2 → 5; OIDC request 3 → 4. Total 23 → 37 (+14). No test cases deleted. The producer assertion was updated to the new typed record shape; the parent-divergence fixture now supplies a working upload/commit path so removing the comparison cannot fail merely because collaborators are missing.

- `backup-recheck-parent`: named in the divergence test; removing the comparison permits real fixture blob uploads/commit and invalidates both refusal and zero-write expectations. NOT executed.
- `slug-gate-before-template`: NOT implemented or executed; dependent handler is stopped. Do not report mutation coverage for it.
- Added cases cover cross-caller provider/clock/producer snapshots, cancellation before commit, catalog IDs/required fields/risk/authorization, singular/plural notices and close on drafting failure, trusted projection bootstrap/bound operations/unknown table refusal/separate roots, gate skips/block/failure, page-vs-JSON batch order, asset/widget/token order, export suppression, flash cache policy and fixed continuation refusal.

### Architecture and scope review

Architecture audit: WARNING / partial. Reviewed all listed diffs manually. No new package dependencies, server-framework types, product literals in package code, public internal-helper subpaths, CMS/devops edges, or diagnostics imports. Dependency callbacks remain required. Shared leaf preserves runtime-cycle removal; SQL remains in its existing owners. No runtime validation or coverage/mutation result is claimed because execution is prohibited.

| assessed units | disposition | finding / local action |
| --- | --- | --- |
| backup service and shared leaf | partial | final host producer/store and binder compatibility remains unverified; retain saved producer and original job owners when binding |
| catalog factory | implemented, unverified | definitions retain original order; required descriptions injected; contributor conversion still pending |
| keep-off and content view | implemented, unverified | same kernel/close ownership; final host adapter unavailable |
| projection factory/generic | implemented, unverified | scopes separated; final host query-handle compatibility pending |
| gate dispatcher | implemented, unverified | required read/effect/error ports; direct skip/block/rejection tests |
| page sender | implemented, unverified | finalizer callbacks explicitly forwarded to avoid eagerly reading deferred port properties; token clock stays behind optional ledger issuance |
| continuation refusal | implemented, unverified | exact fixed login-unavailable error; API reply discard stays in the injected check |

Reuse: extended only the owners named in the sheets (service, risk map/handlers, keep-off, SQL projection, serving decision, page cache/finalizer and login error). No parallel policies or alternate lifecycle owners added. Resource cost: existing caps, projection transactions, plan/job stores and finalizer passes retained; no timers, polling or caches added.

Final diff cleanup: removed the unused test import of an unavailable kernel-erasure helper; the projection test supplies its required kernel port using the already-imported SQLite owner. Removed an unnecessary flash-payload type assertion. No production/test files deleted, no exclusions/suppressions added, no branches removed. Moved runtime helpers/constants were deleted from their former definitions in the service entry and retained verbatim in the specified internal leaf; old `planVersion`/name/next-step ports were replaced as required. Existing unrelated file formatting was retained.

Pre-completion: requirements reread; diffs and new files reviewed; scope limited to Jini plus this uncommitted handoff; no Git mutations. Tests, mutation runs, installs, builds, typechecks, linters, counters and runtime self-validation were NOT run, per dispatch. Coordinator must obtain the final repair base, finish stopped steps, run the named tests and mutations, complete host bindings/G3 keeps, then commit. This file is not for commit.
