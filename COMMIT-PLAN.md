# Sheet 4b — H1970 atomic provider save

Working-tree delivery only; this file is not for commit. No tests, builds, installs,
typechecks, linters, release steps, version changes, or Git mutations are authorized.

## Commit order

1. Regression tests first (written before production edits; execution deferred)
   - packages/ui/src/features/media-providers/__tests__/react/hooks/useMediaProvidersTab.test.ts
   - packages/cms/src/admin-http/routes/media/__tests__/batch-providers.test.ts
   - Mutation `split-provider-batch-into-row-writes`: replace the hook's collection
     call with separately committed removes and patches. The single-call assertion
     and pending-edit/clear rollback assertions must fail.
   - Mutation `commit-provider-ops-one-at-a-time`: commit each vault operation in a
     separate applyBatch call. A CAS miss on operation two must expose operation
     one's partial write and fail the unchanged-storage assertion.
2. Store and route (implemented)
   - packages/cms/src/media/site/provider-credential-batch.ts (new)
   - packages/cms/src/media/site/provider-credential-store.ts (export reused helpers only)
   - packages/cms/src/admin-http/routes/media/batch-providers.ts (new)
   - packages/cms/src/admin-http/routes/media/patch-provider.ts (export shared parser/refusal only)
   - packages/cms/package.json (direct exports and runtime/domain manifest entries only)
3. UI and Admin wiring, changeset (implemented)
   - packages/ui/src/features/media-providers/ports.ts
   - packages/ui/src/features/media-providers/react/hooks/useMediaProvidersTab.ts
   - packages/ui/src/features/media-providers/dependencies.ts
   - packages/ui/src/features/media-providers/__tests__/react/hooks/useMediaProvidersTab.test.ts
   - packages/admin/src/react/kit-media-providers.ts
   - packages/admin/src/screens/media/api/media-api.ts
   - packages/admin/src/screens/media/media-providers-port.ts
   - packages/admin/src/screens/media/__tests__/media-providers-port.unit.test.ts (required fixture method)
   - .changeset/atomic-media-provider-save.md (new)

## Constraints and evidence

- Scope: sheet 4b only. Sheets 2 and 4a are already on HEAD and are untouched.
- Reuse the existing row validation, pre-sealing, merge, staged vault batch,
  field parser, reply builder, and host error mappings.
- One explicit-intent planner; no whole-map replacement by omission.
- Route admission precedes credential-field inspection; workspace comes from deps.
- Run-time RED/GREEN and mutation execution are deferred to the coordinator.
- Existing sibling implementations are the authorized style patterns; no new
  architecture or pattern approval is needed for the specified changes.
- Source review completed with `git diff`, direct reads of new files, and named-area
  contract reads. No runtime success, RED/GREEN, or mutation result is claimed.
- Declared test cases, counted from source (not executed): hook 30 -> 31; new
  batch route 0 -> 1; existing Admin port 8 -> 8. No tests deleted or skipped.
- Architecture audit: source review found the specified injected store and HTTP
  boundaries preserved, no new platform dependencies in production, and all new
  production functions below 50 lines. Runtime/compile verification remains open.
- Function review: batch validation and planning are linear in submitted and
  stored rows plus legacy ids; sealing reuses existing per-key work; one writer
  boundary and one response read. UI/Admin retain one request per flush.
- Source-review skepticism: names match explicit intents, snapshots include full
  ownership scope, the CAS fault reaches operation two across split calls, and
  neither omission nor server markers become write intent.
- Documentation: existing why-comments retained; existing sendProviders wording
  updated for batches. New comments omitted per dispatch's explicit restriction.
- Final diff deletion ledger: removed only the required split remove/patch loops
  and their temporary `saved` accumulator in sendProviders; changed the existing
  row-call expectations to equivalent batch-intent expectations. No unrelated
  deletions or cleanup were needed.

## Consumer handoff

- Import `applyMediaProviderChanges` directly from
  `@jini-ai/cms/media/site/provider-credential-batch`.
- Import `mediaBatchProvidersRoute` and its deps directly from
  `@jini-ai/cms/admin-http/routes/media/batch-providers`.
- Mount collection PATCH beside the existing row routes, binding workspace/store
  deps and the same error mappings. Wire `applyProviderChanges` to the store.
- Existing Admin factories supply the new rows-port method through
  `mediaApi.applyMediaProviderChanges`; no consumer factory-body changes required.
- Run the two specified regressions and named mutations in the coordinator run.
- Sheets 2/4a: already on HEAD, untouched. Sheet 3 release-only: no-op under the
  coordinator override. No version bumps, releases, or lockfile edits.
