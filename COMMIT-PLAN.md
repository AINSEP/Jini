# Y5 API round 2 — Jini working-tree plan

Base: codex/y5-api-2j, with prior Y5 Jini work and final merge-25 merged. Read final host source at e2655d7e04. G0 is satisfied. No git writes or executable checks are authorized.

## Ordered coordinator commits

1. Sheet A: inherited implementation is already in HEAD; no pending Jini step identified by the earlier handoff.
2. Sheet W: add characterization tests in packages/platform/src/secrets/root-key/__tests__/y5-ensure.test.ts FIRST, then implement packages/platform/src/secrets/root-key/ensure.ts, register its exports/classification in packages/platform/package.json and extend packages/platform/src/secrets/__tests__/exports.test.ts. Reuse decide/reconcile/files. Preserve final source readSiteKeySourceMaterial(... )?.raw unchanged.
3. Sheet H: add packages/cms/src/admin-http/routes/__tests__/y5-preview.test.ts FIRST, then extend packages/cms/src/admin-http/routes/posts/template-preview-render.ts with renderBarePostPreview and createPostPreviewRenderer. Reuse existing renderPostPreview and the final merge-25 types.

## Mutations (execution deferred to coordinator)

- A-remove-choice-revision-recheck: inherited stale-consent case must reject before preference or transcript commit when deleting the after-answer revision check.
- W-skip-invalid-first-source: inherited invalid-first/valid-second case must refuse without reading the second source; continuing on invalid material must make it fail.
- H-release-upload-only-on-success: inherited interrupted-upload case must acquire the next slot after close; removing the close release must make it fail.

## Open step

W-keyring-ABI still conflicts: bindSiteKeyrings({ hkdfSalt, readSourceMaterial, defaultEnv }, _optional = {}) cannot receive the separately required source descriptions, host refusal copy/error mapping or default key ID. Exact constructor signatures and module-specifier-only host edits leave no other injection point. No hidden properties, widened signature or host wording will be invented. Continue all independent steps.

## Scope and verification

Jini only. No host deletions, G3 ledger, counter changes, commits, pushes, tests, mutation runs, installs, builds, typechecks or linters. Runtime and type correctness remain unverified. Existing tests will not be weakened or deleted. Final file inventory and diff cleanup will be added below.

## Round-2 work written (coordinator commits, in order)

1. **Sheet W — ensure orchestration**
   - Created `packages/platform/src/secrets/root-key/__tests__/y5-ensure.test.ts` before implementation: four cases for production no-mint/writable-volume recovery, metadata and key-file race-winner rereads, malformed metadata preservation, and absent metadata with dependent-data refusal.
   - Created `packages/platform/src/secrets/root-key/ensure.ts`: `createSiteKeyEnsurer` binds the existing source readers, dependent-data scan, full-meta builder, randomness, atomic JSON writer, filesystem effects, metadata names/fields, modes and boot-error logger. The result exposes `ensureSiteKey`, `ensureSiteKeyForBoot`, `ensureSiteKeyForSite`, `mintSiteKeyHex`, `installSiteKey`, and `atomicCreateSiteKeyFile`.
   - Changed `packages/platform/package.json`: added `./secrets/root-key/ensure` with types/import/default and node classification.
   - Changed `packages/platform/src/secrets/__tests__/exports.test.ts`: retained exact enumeration and added the ensure entry.
   - Changed `.changeset/y5-api-webhooks.md`: includes provisioning.
2. **Sheet H — preview composition**
   - Created `packages/cms/src/admin-http/routes/__tests__/y5-preview.test.ts` before implementation: two parameterized cases (doc/html) pin all five reads starting before title resolution, `theme: null`, pending content, metadata/widget document arguments, no SEO head argument and no theme read for a bare preview.
   - Changed `packages/cms/src/admin-http/routes/posts/template-preview-render.ts`: added `renderBarePostPreview` and `createPostPreviewRenderer`; existing preview dispatch and theme types remain unchanged.
   - Changed `.changeset/y5-api-admin-http.md`: includes bare preview composition.

8 deliverable files: 3 created, 5 changed. COMMIT-PLAN.md is an additional uncommitted coordinator note and must not be committed.

## Sheet status

- **A — Jini implementation inherited in HEAD; no round-2 edits.** Earlier handoff reports all seven portions built. Runtime/type verification remains for Opus.
- **W — ensure prerequisite cleared and implementation written.** Sources, ordered core/generator and scanners remain inherited. The constructor binder remains **NEEDS-OPUS** for the exact input conflict recorded above. No whole-sheet stop.
- **H — preview prerequisite cleared and implementation written.** Other eleven anchors remain inherited. No remaining reported Jini implementation step in this sheet; runtime/type verification remains for Opus.
- No rejected sheet or mismatched anchor. No G0 wait remains.

## Export paths for the host half

New in round 2:

- `@jini-ai/platform/secrets/root-key/ensure` — `createSiteKeyEnsurer` and existing moved input/result/scan type names.
- Existing `@jini-ai/cms/admin-http/routes/posts/template-preview-render` now also exports `createPostPreviewRenderer` and `renderBarePostPreview`.

Inherited new public paths from round 1:

- `@jini-ai/agent-plugins/site/automatic-agent-plugins`
- `@jini-ai/agent-plugins/connect/host-deps`
- `@jini-ai/agent-plugins/connect/installed-plugin`
- `@jini-ai/platform/secrets/root-key/ordered-keyring` (lower-level configured operations only; no constructor binder)
- `@jini-ai/platform/secrets/root-key/sources`

Every new direct path has an exports entry and matching jini.entries classification. Existing scanner/admin/devops/user-management subpaths still own their additions; no new subpaths for those.

## Host integration details

- Ensure: compose one `createSiteKeyEnsurer` with the configured read binding; bind the dependent-data scan here rather than reading it from each operation input. Inject the existing full-meta builder and `writeJsonFileAtomic` adapter, existing boot log text, filesystem, live mode/env/home/cwd reads, metadata field names, PID/time/randomness and directory/file modes. Boot wraps the throwing site operation; synchronous recovery still only mints minimal metadata. Use `/root-key/decide` directly for the decision table. The source-material reader's `?.raw` remains exactly as in final merge-25.
- Preview: `createPostPreviewRenderer` takes already bound presentation/theme/member/menu/pointer/copy ports plus the five bare resolver ports and document renderer, and returns a callable taking `{ input }`. The retained host binding can remain a single expression: `({ deps, input }) => createPostPreviewRenderer({ ...host adapters closing over deps... })({ input })`. There is one factory call site, no branch and no local read fan-out. Existing `renderPostPreview` API is retained for other consumers.
- Keyrings: do not switch the constructor-only importers until the three-input ABI conflict is resolved. No hidden properties or hard-coded host policy were added.
- All host repoints, bindings, 23 deletions, preview G3 keep, G3 ledger and counter remain Tovu work; no minus-24 result is claimed.

## Source review / assessment

Read final host source via `git show e2655d7e04:<named path>`; reviewed the tracked diff, complete new files and final status. Source line counts: ensure 439; preview leaf 215. No tests, builds, installs, typechecks, linters, mutation runs or counter runs were executed. The six added cases and the inherited named mutation cases are unverified. Prior report: 17 new files / 38 cases; this round adds 2 files / 6 cases, yielding 19 files / 44 cases across both rounds; no existing case removed or weakened.

Architecture audit: **WARNING / incomplete delivery** because W-keyring-ABI remains blocked and executable verification is prohibited. New code imports only its package, core types and Node path/type surfaces; readers have no new ensure import. New effects are injected, not constructed globally. No framework types, vendor strings, product names or host import paths were introduced into the new implementation. Theme assets/renderers/tests were not edited.

| unit | disposition | evidence / remaining limitation | local fix |
| --- | --- | --- | --- |
| Ensure boot/site/install orchestration | INCONCLUSIVE | Four behavioral cases written; no executable evidence | Reused reconcile/files; kept deferred stamp getter and final-source optional material read |
| Bare preview resolver/factory | INCONCLUSIVE | Doc/html parallel-read and argument cases written; no executable evidence | Reused existing preview dispatch and current menu types |
| Ordered keyring constructor ABI | REQUIRED | Three prescribed inputs cannot inject required descriptions/copy/default key ID | No unauthorized ABI extension; coordinator clarification required |

Reuse: provisioning decisions/reconciliation/publication; inspected `root-key/{decide,reconcile,files,material,sources}.ts` and final host ensure; used the existing reconcile and file operations instead of copying their decisions or race handling. Reuse: preview dispatch/document argument types; inspected existing preview leaf and bare document contract plus final host preview; reused renderPostPreview and RenderBareEntryDocumentRequired.

Cost: ensure retains the existing fixed source-order reads, one dependent-data scan when reconciliation needs it, and bounded metadata/file writes. Bare preview still starts exactly five context reads in parallel; no cache, timer, queue or retained state added.

## Final diff cleanup / deletions

- No existing source/test file or test case deleted.
- Did not copy the host's pure plan wrapper/table into ensure; the existing `/root-key/decide` owner remains canonical.
- Did not copy reconciliation, file publication or install decision bodies; their existing owners are called.
- Removed no existing why-comments. Copied why-comments with the moved orchestration and made product command/home/module references neutral where necessary.
- Corrected the new metadata-race reread to use the injected `resolveSiteKeyId`.
- Allowed explicit undefined for moved optional context fields because the unchanged forwarding statement passes home/cwd through on the exact-optional Jini tree.
- Used `object` for full metadata passed only to JSON serialization, allowing the existing host metadata interface without an invented index signature or new metadata type.
- No extra helpers, interfaces, generic parameters, flags, defensive branches, fallback behavior, dependency additions or out-of-sheet product changes retained.

Next: coordinator resolves W-keyring-ABI, performs the Tovu cutover, then Opus executes the contract tests, named mutations and package checks. No local commit or push was performed.
