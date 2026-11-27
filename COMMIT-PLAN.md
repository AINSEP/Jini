# p411-j handoff (working tree only)

Base: d2f060d9d (`codex/p411-j`, reviewed `origin/codex/w3-p4-p11-rev`).
No Git mutations, tests, builds, installs, typechecks or linters are authorized.
This file is coordinator scratch and must not be committed.

## Design order and status

1. **J1a — STOPPED at the journal-eligibility prerequisite.** The core contract,
   export and minor changeset already landed in 95a0d849e; do not replay them.
   `UploadMediaDeps` (`media/media-service.ts`), `ReplaceMediaFileDeps`
   (`media/replace-media-file.ts`) and `ResolveMediaRenditionDeps`
   (`media/rendition-service.ts`) have no effect for clearing stale journal
   eligibility transactionally. The sheet names only three added writer ports
   (`blobFence`, `storageKeyFor`, `verifyStoredBlob`), none of which exposes that
   operation. Do not invent an additional transaction/journal contract. Named
   mutation left for this stopped slice: `M11-verify-input-not-stored`.
2. **J1b — SOURCE BUILT; Opus validation and CMS baseline refresh pending.**
   Named tests were written before production edits. Files for this one design
   commit, in order (the coordinator commits):
   - packages/cms/src/media/site/__tests__/import-media-entity.test.ts
   - packages/cms/src/media/site/__tests__/hydrate-blob-store-from-seed.test.ts
   - packages/cms/src/admin-http/routes/publish-content/__tests__/blob-routes.test.ts
   - packages/cms/src/media/site/import-media-entity.ts
   - packages/cms/src/media/site/hydrate-blob-store-from-seed.ts
   - packages/cms/src/admin-http/routes/publish-content/blob-put.ts
   - packages/cms/src/media/site/README.md
   - .changeset/cms-fenced-import-writes.md
   Mutation `M11-process-lock-only`: replace the injected byte fence with direct
   execution (or `withSha256Lock`), leaving the work intact. Barrier-based tests
   must fail because staging/publication starts while the injected fence is held.
   Stored-object tests reject short and same-length corrupt occupied objects and
   independently read the retained object and absence of a published media row.
   Source replacement/restore remain delegated to J1a; not certified by this slice.
   No import paths or package export maps changed. The three existing public
   dependency objects now require the three ports; PUT's store result additionally
   requires `storageKey`. Import's existing optional second object was added as
   specified. Existing tombstones are resurrected before verification, preserving
   attribution; the fence lasts through the conditional media publication. PUT
   and hydration publish no ownership rows. The new-row import path saves active
   ownership before staging, as required for originals in the shared J1 design.
3. **J1c — STOPPED at exact rendition identity/provenance prerequisites.**
   `AssetRenditionRecord` (`media/types.ts`) has `storageKey` but no byte digest;
   `BlobGcJournalEntry` has no reason/provenance/retry state. `cleanupJournal` in
   `MediaRowCleanupDeps` accepts one source `sha256` plus `storageKeys`, so it
   cannot carry the required original/rendition identities with each rendition's
   own digest. The sheet does not name the replacement participant contract or
   the rendition digest/persistence change. Do not infer a digest from an
   arbitrary storage key or invent new ports/types. `BlobGcScope` is present and
   must bind any future collector's listing to one workspace at construction.
   Named mutation left for this stopped slice: `M11-journal-after-delete`.
4. **P4 J3a/J3b — GATED, untouched.** The supplied Opus review explicitly says
   T-GATE is absent and wrapper errors remain optional. No breaking retirement.

## Review and validation handoff

- Opus runs the named tests and mutation, then the applicable strict/API gates.
- CMS API baseline refresh requires generated declarations and remains Opus work;
  no stale declaration hashes will be invented or unrelated drift swept in.
- Tovu T1b must bind the same durable fence and stored-object verifier at import,
  staged PUT and hydration. Existing import subpaths stay unchanged.
- Test declarations (static source count, not executions): import 9 -> 11,
  hydration 9 -> 10, blob routes 13 -> 15 (31 -> 36 total). Five tests added;
  one existing hydration test renamed to the sheet's corrupt-occupied-key name
  and its result changed from already-present to partial/one failure. Its
  byte-preservation assertion remains. Authorization, 400/413/pre-write 422,
  CAS/refusal, no-source and aggregate error pins were retained.
- Named added tests: `import verifies an existing object's size and hash before
  publishing`, `blob PUT refuses a short or same-length corrupt stored object`,
  and `each writer holds the byte fence across write and publish` in each of
  the three suites. The renamed hydration test is `seed hydrate reports a
  corrupt occupied key rather than already-present`.
- Static review only: re-read the complete diff and the scoped same-symbol/
  module-specifier inventory under `packages/cms/src`. The only executable
  Jini callers of these three leaves are the updated tests; the remaining hits
  are definitions, documentation and references. No new production helpers,
  types, exports, fallbacks, configuration, retries, or catch blocks were added.
  Existing why-comments moved with the fenced work unchanged. Existing factual
  commentary about resurrection/corrupt hydration was corrected to match the
  named behavior; its attribution/never-overwrite rationale is retained.
- Self-review deletions: removed the old PUT fixture's `as never` fake return in
  favor of the existing real in-memory store; removed one added blank line.
  No tests, assertions, capabilities, or existing why-rationales were deleted.
- Architecture audit: WARNING / PARTIAL. Checked core/CMS ownership, host-injected
  fence/key/verification, existing leaf specifiers, same-workspace keys, no
  staging ownership, refusal order, and preserved replacement delegation. The
  source changes stay within J1b. J1a/J1c and paired host wiring remain blocking
  for the complete J1 release; no durable unlink capability was constructed.
- Function review: `ensureAssetBlob` verifies active/resurrected/new objects under
  its caller's fence; `importMediaEntity` retains CAS inside that fence; PUT
  retains authorization and body-validation order; `resolveOneSeedBlob` retains
  per-item failure isolation. No additional production functions were created.
  Stored readback is delegated to the required host effect; fixture effects
  independently check both length and digest. Total verification cost is O(B)
  per bounded object, in addition to the retained input digest check.
- Validation not run: all suites, mutations, builds, API commands, installs,
  typechecks and linters are prohibited by this dispatch. No pass/green claim.
  No subagents, Git writes, network operations, commits, or pushes were used.
