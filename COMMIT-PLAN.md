# bugd-data — Jini working-tree handoff

No commits, installs, builds, tests, typechecks or linters are run in this dispatch.
Tests are written before their production fixes; RED/GREEN and mutations await the coordinator.

## Constraints and reuse

- Jini only; no subagents; `.git` stays read-only. No version changes or releases.
- Approved sheets: 4a, 4b, 2 (command/transport SQL port only); FIX 19 is a no-op.
- Keep existing vault batch/CAS, sealing/AAD, revision hash, actor, authorization and inverse order.
- Reuse the named store, vault adapter, command, route and tool seams; no memory coordinator.
- Sheet 4b placement decision pending: the specified store file is already 499 lines; adding the named batch operation conflicts with the 500-line ceiling. No unapproved split or comment removal.

## Completed commit units, in order (coordinator commits)

1. `fix(cms): allocate fresh media-provider vault identities` (sheet 4a).
   Mutation: `reuse-deterministic-vault-id-on-create` restores deterministic IDs for inserts.
   Regression: `a pre-delete ETag cannot overwrite a same-tick recreated provider`, changed and identical safe metadata, over the Jini routes and real staged vault repo.
   Files:
   - `packages/cms/src/admin-http/routes/media/__tests__/providers.test.ts`
   - `packages/cms/src/media/site/provider-credential-store.ts`
   - `packages/cms/src/media/site/provider-credential-vault.ts`
   - `packages/cms/src/media/site/provider-credential-store.memory.ts`
   - `packages/cms/src/media/site-generation/providers-tools.ts`
   - `packages/cms/src/media/site/__tests__/provider-credential-store.test.ts`
   - `packages/cms/src/media/site/__tests__/provider-credential-vault.test.ts`
   - `packages/cms/src/media/site/__tests__/provider-credential-store.memory.test.ts`
   - `packages/cms/src/media/site-generation/__tests__/credential-tools.test.ts`
   - `.changeset/media-provider-fresh-vault-id.md`
2. `fix(cms): transact change-set reverts` (sheet 2).
   Mutation: `run-revert-without-transaction` executes the command body directly.
   Regression: `L079: a later inverse failure rolls back earlier writes.`
   Host-only witness: `sql-revert-runs-outside-content-kernel`, exercised by the host's real SQL integration test.
   Files:
   - `packages/cms/src/core/commands/__tests__/revert.unit.test.ts` (new)
   - `packages/cms/src/core/commands/revert.ts`
   - `packages/cms/src/admin-http/routes/change-sets/revert.ts`
   - `packages/cms/src/change-sets/tool-registrations.ts`
   - `packages/cms/src/core/commands/__tests__/public-entry.test.ts`
   - `packages/cms/src/admin-http/routes/change-sets/__tests__/revert.test.ts`
   - `packages/cms/src/change-sets/__tests__/tool-registrations.test.ts`
   - `.changeset/atomic-change-set-revert.md`

## Stopped / no-op sheets

- Sheet 4b: STOPPED pending a file-placement/size decision. The named store was 499 lines before this job and is 500 after 4a's required dependency. Adding the specified batch operation in that file exceeds the hard 500-line limit. No split, unrelated reformatting, helper layer or comment deletion is authorized. The clarification remains unanswered; no 4b edits or changeset were made. Named mutations remain `split-provider-batch-into-row-writes` and `commit-provider-ops-one-at-a-time`.
- FIX 19: DONE / no-op under the coordinator override. No version bump, release or source change.

## Host handoff

- No new subpaths/exports for 4a or 2; existing CMS entries expose the changes.
- Inject the same root `idGen` into SQL/memory credential-repo constructors, store-write deps and media-provider tool deps.
- Add the required `revertTransaction` host dependency; pass it as route `transaction` and tool `revertTransaction`. SQL must call the shared `kernel.transaction(work)` with the same kernel used by content, revisions, ledger and outbox. The memory composition uses the expressly approved `work()` shim with its specified deferred-rollback comment.
- Add the real site SQL Recovery rollback integration witness (post/delete, page HTML/update, menu/update), including final outbox failure; the site boot/composition files and integration fixtures are host-owned and absent from this Jini checkout. The historical host unit and plugin-extension fixtures also remain in that half; existing Jini command/HTTP/tool fixtures were wired here.
- Coordinator runs the regressions and named mutations. No RED/GREEN or mutation result is claimed.

## Final audit

Read the complete changed production and test diff plus the new files. Existing tests retained; two parameterized same-tick cases and one atomic-revert unit case added. Existing legacy canonicalization assertion now pins the injected fresh ID. No tests deleted or weakened, no coverage settings changed.

Deletions: no files, behaviors or tests deleted. Removed the production store's now-unused `mediaVaultId` import; replaced deterministic insert-ID expressions. Revert's old inline load/finalize blocks moved into the two sheet-authorized helpers with their why-comments.

Architecture audit: PASS for implemented units by source review: Jini-neutral, required injected dependencies, existing vault/AAD/metadata/revision hash preserved, no re-export shells or new package layers, no memory coordinator, no version/lockfile changes. Sheet 4b remains blocked by the stated constraint conflict.

Function review:

| Units | Disposition | Evidence / limits |
| --- | --- | --- |
| `sealNewProviderKeys`, `migrateLegacyProviderKeys`, `rowIdentity` | No recorded findings | Allocate before sealing; retain prepared-ID conflict and stable update ID. Same-tick route cases and existing legacy AAD witness; execution deferred. |
| `revertChangeSet`, `loadAppliedChangeSet`, `finalizeRevert` | No recorded findings | Force guard remains first/outside; descending guard/write order and final enqueue remain inside one boundary. Unit observes first write before second inverse fails, asserts original error and unchanged rows/ledger/events. Real SQL witness belongs to host. |
| Route/tool/constructor wiring | No recorded findings | Required ports forwarded without fallback logic; existing fixture runners restore fixture state on rejection. |

Skepticism pass: reviewed stored vs prepared ID selection and persisted revision inputs; reviewed transaction ownership of guard reads and final status/enqueue, actor identity and error propagation. No new persistence/transport logic outside the named owners. Existing loop costs stay unchanged (provider-count seals, descending item sort and loop). Runtime validation, coverage, metrics and mutation execution are deliberately not run, per dispatch.

All changes remain uncommitted. `COMMIT-PLAN.md` is coordinator scratch and must not be committed.
