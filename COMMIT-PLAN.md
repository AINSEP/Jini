# Data bug handoff

Working-tree edits only. Tests are written before implementation. No installs, builds, tests,
typechecks or linters are run, per dispatch; RED/GREEN and mutation execution are unverified.

## Completed logical units / coordinator commit order

1. data 1 — redirect creation validates under its existing writer transaction.
   - packages/cms/src/redirects/redirects.ts
   - packages/cms/src/redirects/__tests__/redirects.write-boundaries.test.ts
   - Mutation: `validate-create-before-lock` moves validation before transaction entry.
     Both the activated create witness and new per-row import witness must fail: a cycle
     commits rather than refusing, and a created event is emitted for the rejected row.
2. data 3 — restore trusted publish actor refusal and the two focused witnesses from 2df333941.
   - applyRunActor, its doc comment and both imports already exist on this HEAD; the helper
     is byte-identical to 2df333941 and is reused, with no duplicate helper restoration.
   - packages/cms/src/publish/content/repo-handler.ts
   - packages/cms/src/publish/content/raw-row-contributor.ts
   - packages/cms/src/publish/content/__tests__/repo-handler.actor.test.ts (new/restored)
   - packages/cms/src/publish/content/__tests__/raw-row-contributor.test.ts
   - Mutation: `fallback-to-user` restores either writer's missing-actor human fallback.
     The corresponding missing-actor witness must fail on rejection/data/change-set assertions.
     Both named agent cases also assert the supplied agent attribution.
   - Consumer prerequisite: the 12 named fixture files must land with the CMS dependency bump.
     No consumer files edited here. No unrelated entries/write-service.create.test.ts hunk restored.
3. data 7 — preserve omission and accept explicit null in the moved newsletter update handler.
   - packages/user-management/src/newsletter/tool-registrations.write.ts
   - packages/user-management/src/newsletter/__tests__/tool-registrations.model-facing-errors.test.ts (new)
   - Mutation: `preheader-null-means-omitted` restores the string-only expression.
     The clear result and persisted row would retain Preview text, failing the null assertions.
4. data 8 — empty filtered Trash pages retain their continuation.
   - packages/admin/src/screens/trash/Trash.tsx
   - packages/admin/src/screens/trash/__tests__/pagination.unit.test.tsx (new)
   - Mutation: `empty-page-hides-continuation` restores the unconditional empty-array return.
     The terminal-message assertion fails and Load more is inaccessible.
   - Consumer order: apply before admin 1's copy edit; no route/filter changes.

## Stopped / skipped

- data 2: NEEDS-OPUS; requires rollback-capable SQL and memory host bindings. Not attempted.
- data 4 H1973: explicit compatibility stop. Consumer package.json declares platform
  ^0.7.3-next.2 and its installed package is 0.7.3-next.2. Its compiled
  dist/secrets/credential-sets/vault.meta.js:14 declares only baseUrl/model for media-provider;
  lines 72–76 throw VaultError(invalid-meta) on unknown keys. Thus incarnation is rejected
  by the currently installed published reader. No metadata/constructor/store edits made.
- data 4 H1970: dependent on the sheet's ordered H1973-first rollout; store/route/UI left
  untouched pending the prerequisite. No new export or subpath introduced.
- data 5 B226 and data 6 SC permanent delete: REJECT duplicates owned by sec 6/sec 7.
- H1974, H1440, retention-policy change, restore-ledger actor_kind: remain skipped as directed.

## Required deletions

- Remove the single-caller persistRedirectWrite after its transaction moves into createRedirect.
- Remove obsolete RED/todo and pre-validation transaction comments from the activated create witness.
- No tests or existing assertions deleted or weakened; no exclusions or suppressions added.

## Final static review

- Reviewed the complete tracked diff and all three new regression files; no unrelated changes.
- Active test declarations in the five affected test files: 29 -> 37. This is seven new
  cases plus the activated redirect todo (todos 1 -> 0), not an executed test count.
- Both publish production files and both focused witness files are byte-identical to
  their requested 2df333941 blobs. The unrelated entries test remains untouched.
- Static boundary audit: all implementation edits remain in the existing Jini owners;
  injected dependencies and public signatures are preserved. No new helper, interface,
  flag, export, subpath or host binding was introduced.
- Function review: createRedirect retains its field construction/order inside one writer
  transaction, then emits after commit; the other changes use the existing actor helper
  or change only the specified merge/empty-state predicate. No additional I/O or scan.
- Runtime/mutation validation remains unperformed because the dispatch prohibits execution.
- Consumer handoff: bump cms with the 12 actor fixtures in the same change, bump
  user-management for the moved newsletter handler, and bump admin for Trash before admin 1.
  No new import paths are required. Media packages and bindings remain unchanged.

COMMIT-PLAN.md is coordinator scratch and must not be committed.
