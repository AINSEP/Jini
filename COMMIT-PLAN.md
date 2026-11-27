# w3-p11rest — Jini working-tree handoff

Base: `fd06f45b12ae0516b0fc196f58d785eba4d3831e` (`codex/w3-p11restj`).
No tests, builds, installs, type-checks, linters, or mutations are executed here, per dispatch. No git writes.

## Stopped before edits

J1 (J1a/J1b/J1c): the writer anchors match, but J1c's required public factory cannot use the existing repository contracts as written. `createBlobGc` receives no workspace, and neither `deletePass({ signal })` nor `unlinkPass({ signal })` supplies one. `AssetBlobRepoPort.list` (`packages/cms/src/media/ports.ts:47`) and `BlobGcJournalRepoPort.list` (`:60`) both require `{ workspaceId }`. No workspace-bound/global enumeration contract is specified. Adding a workspace argument, new repository adapter, or new list signature would exceed the owner rule forbidding unspecified interfaces/adapters/options. The coordinator must specify this binding before J1 is built. No partial breaking writer API is staged. This is a contract gap, not an anchor mismatch.

J1 mutations reserved for the corrected sheet: J1a `M11-verify-input-not-stored`; J1b `M11-process-lock-only`; J1c `M11-journal-after-delete`. No J1 tests or release artifacts added.

## Commit units (coordinator commits)

1. **J2 — request-local revision-thinning routes (source complete; OPUS-REVIEW outstanding).** Tests written first, implementation second.
   - `packages/cms/src/admin-http/routes/posts/__tests__/revision-thinning.test.ts` (new)
   - `packages/cms/src/admin-http/routes/posts/revision-thinning.ts`
   - `api-baseline/jini-ai__cms.json`
   - `.changeset/p11-j2-request-local-revisions.md` (new; CMS major)
   - Four named cases: `one spec resolves two requests to different trusted owners and scopes`; `body cannot override workspace or principal`; `apply requires literal confirmation before invoking the port`; `both writes require same origin`.
   - **Mutation `M13-static-scope`:** retain and reuse the first request's resolved scope for the second request. The two-request assertion must turn red. Mutation not applied/run here.
   - Host binding: `resolve` gets request context and untrusted body selectors plus `selection.params` preserving path selectors. It must reject path/body disagreement and supply identity/workspace from trusted context. Existing `readOlderThan` owns date validation; `preview` receives `before` and maps it to the engine's `olderThan`. `readApply` returns the token and uncoerced confirmation; `missingTokenError` and `confirmationError` inject host refusal wording/classification, routed through `refuse`. No host error strings or URLs added to the leaf.

2. **J3 — read-only partition inventory and fresh manual eligibility (source complete; OPUS-REVIEW outstanding).** Tests written first, implementation second.
   - `packages/desktop-host/src/electron/partitions/__tests__/partition-inventory.test.ts` (new)
   - `packages/desktop-host/src/electron/partitions/__tests__/partition-pass.test.ts`
   - `packages/desktop-host/src/electron/partitions/partition-inventory.ts` (new)
   - `packages/desktop-host/src/electron/partitions/partition-pass.ts`
   - `packages/desktop-host/src/electron/partitions/index.ts`
   - `api-baseline/jini-ai__desktop-host.json`
   - `.changeset/p11-j3-partition-inventory.md` (new; desktop-host minor)
   - Four named cases: `listing never writes or acquires a session`; `unknown claims or ledger yields no actionable sign-ins`; `a pending automatic retirement cannot be manually removed`; `holder or sibling appearing after confirmation keeps the partition`.
   - **Mutation `M18-pending-is-ambiguous`:** omit the pending-record exclusion from the shared eligibility predicate. Pending inventory/removal assertions must turn red.
   - **Mutation `M18-no-post-rename-recheck`:** omit `recheck()` in `asideAndCommit` before CAS. The new holder/sibling/tracked arrivals at the rename boundary must fail the preserved Cookies/Local Storage/IndexedDB assertions. Uses the existing real interlock and filesystem fakes. Mutations not applied/run here.

`COMMIT-PLAN.md` accompanies these commits as the shared handoff.

## Review and validation handoff

Eight tests added; no tests deleted or weakened. No tests or named mutations run. Runtime, compiler, complexity, and coverage evidence are **INCONCLUSIVE**, expressly deferred to the cloud/Opus run by the dispatch. No installs, builds, type-checks, linters, or package/API check commands run.

API hashes were updated using TypeScript's syntax parser/printer and SHA-1 of the explicit declaration shapes only, without creating a type-checker or emitting a build. The cloud run should regenerate against built declarations before release. No package entries/specifiers changed.

Source audit: J2 reuses core `defineJsonRoute`, parsed input/request context, and engine result types; J3 reuses the existing interlock, strict claims/ledger, contained candidate reader, post-rename recheck and CAS. Inventory is not called by `runPartitionPass`. No new interlock, forwarder, production fallback, or activation binding. Source boundary review found no cross-package/product dependency violations; dynamic behavior remains unverified.

| Unit | Disposition | Finding / evidence still needed |
| --- | --- | --- |
| J2 parsers/handlers | INCONCLUSIVE | Four direct spec tests and `M13-static-scope` await execution; inputs/outputs explicit, no retained request state. |
| J3 inventory/predicate | INCONCLUSIVE | Read-only/unknown/pending tests await execution; O(candidates × (claims + ledger records)), existing contained directory read injected. |
| Manual preflight | INCONCLUSIVE | Pending/race tests await execution; preserves existing post-rename checks and CAS. |

Diff review deletions: removed J2's static `principal`, `scope`, `thinning`, and `authorize` dependency fields and their uses as the sheet requires; replaced manual preflight's uncontained single-directory stat with the contained candidate reader. No files, why-comments, tests, measured code, or unrelated capabilities deleted. No extra implementation was retained after scope review.

Tovu adoption: no new subpaths. T3 uses the existing CMS revision-thinning leaf with the new required ports, consumes the CMS major, and remains unmounted/unregistered until STOP 6 clears. T6 consumes desktop-host minor and imports `listAmbiguousPartitions`/`PartitionInventory` from the existing `@jini-ai/desktop-host/electron/partitions` leaf; it must bind the same strict claim sources and ledger as the real removal interlock. T1/T2 cannot adopt a J1 fence release from this run because J1 is stopped.

## Left

T1–T8 are Tovu work, excluded from this Jini dispatch. T4c and T5 are explicitly NEEDS-OPUS. No Jini sheet is marked OPUS-builder, NEEDS-OPUS, or REJECT. J1 remains stopped as above.
