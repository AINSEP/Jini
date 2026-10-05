# Changelog

## Unreleased — Menu and entry version checks

- Entries: `updateEntry`, `publishEntry`/`unpublishEntry` and an import-as-update again refuse an `expectedVersion` that differs from the version they read (`VersionConflictError`), in addition to the save's compare-and-set. The compare-and-set alone let a record built from an older read overwrite a writer that landed the claimed version after that read.
- Navigation: `updateMenuTree` restores the same read check. New `MenuVersionConflictError` (a `MenuConflictError` subclass) is what `menuVersionConflictError` and that check throw, so a host can tell a lost version check from a slug conflict.
- Navigation, BREAKING for `MenuRepoPort` adapters: the port gains `transaction({ fn })`, and `assignLocation` runs both menu saves, the binding upsert and its outbox events inside it, so a conflict on the second save no longer leaves the displaced menu changed. `InMemoryMenuRepo.transaction` just runs `fn` (no rollback).
- Navigation: `MenuSaveOptions.expectedVersion` accepts `null` — insert only when no row (live, trashed, any workspace) holds the id — for a host's id-preserving import-as-create; the loser gets `menu '<id>' already exists (expected no menu, found version <n>)`.

## 0.4.2 — 2026-10-04

- Media: optional `BlobStorePort.sizeOf` reports original blob bytes (filesystem store memoizes `stat`); `MediaRecord.createdBy` is stamped at creation and write-once.
- Navigation: entry targets carry optional `lastKnownHref` and `entryType` hints.
- Taxonomy: `unassignTerms` returns the removed ids. Trash: a no-op trash/restore does not notify again.
- Internal `@jini-ai/*` dependencies are caret ranges (`workspace:^`) instead of exact pins, so a host on a newer patch resolves a single copy without an override.

## Unreleased — Trash host adoption

- Preserve `adapter-unavailable` for absent domains before checking entity policy; selected purge
  still checks resolved-row authorization first. Added regression coverage for both manual and
  retention purge outcomes.
- Restore shared rationale for atomic marker/index changes, keyset pagination, retention promises,
  restore races, leases and follow-up no-ops. Move the cursor wire/Unicode/malformed-input suite
  into `src/trash/__tests__/cursor.test.ts`. Move the nine in-memory repository contract cases
  and nine pure sweep decision cases alongside their shared implementations; native timer and
  SQL/dialect integration coverage remains with the host adapters.

## 0.4.0 — 2026-10-02

### BREAKING

- Remove the unused `@jini-ai/cms/server` placeholder subpath and its `CMS_SERVER_LAYER` marker; concrete Node adapters remain in domain-specific entries and identity wiring belongs to `@jini-ai/user-management/server`.
- Identity tools moved to user-management/server; analytics moved to the analytics package and trash to cms/trash. Settings use a principal lookup port, generic tool/HTTP/clock types come from core, and the nonexistent ./widgets entry was removed.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Compile repairs

- Align settings HTTP adapters and value-write tool errors with current named kernel/domain arguments; import the canonical taxonomy ID generator type.
- Correct feed callback/mock typing, authorization fixtures, taxonomy delete arguments, workspace update dependencies, and awaited index-identity assertions without removing tests.

### Breaking architecture boundaries

- Move identity registrations to `@jini-ai/user-management/server`; remove the user-management dependency.
- Move generic registration helpers and tool catalog types to `@jini-ai/core`; remove domain type aliases and local primitive/Result/HTTP declarations. Use core primitives and named helper calls.
- Replace the settings identity repository dependency with a host-owned findActiveById lookup that a raw identity repository cannot satisfy structurally.
- Require explicitly bound transactions for term rename and workspace deletion.
- Add `./trash`, moved with its tests from platform. Retention is an option defaulting to 60 days; eager RangeError validation and sweeper bounds are retained. ID allocation uses the kernel `IdGenerator.newId()` port.
- Remove the unimplemented `./widgets` export and its metadata entry.


- Add `@jini-ai/cms/http/settings`: move the eight settings routes, contracts, CMS
  adapters and resumable change feed with their behavior suites from HTTP kit.
  `express` and `@jini-ai/http-kit` are optional peers used only by HTTP entries.
- Restore `401 UNAUTHENTICATED` when readiness or principal resolution fails.
- Isolate throwing diagnostics and individual cleanup failures so subscriptions retry
  safely and cancellation/end still run. Regression tests written, not run.

- Remove specification identifiers from runtime refusal messages while preserving the guard, error class and explanatory text; retain rationale references in comments.

- Add forms validation, audited definition writes, bounded submissions and notification services in the separate nested `@jini-ai/cms-forms` workspace package.
- Add `./media/import` URL and binary validation with required MIME/size policy and injected HTTP, sniffer and outbound guard ports.

### CMS integration

- The universal `./core/tools` entry now owns CMS permission helpers. Named input, catalog, schema-rejection and registration helpers are exported directly by the kernel.
- Complete the `./media/import` barrel and runtime metadata, with caller-supplied HTTP, binary validation, MIME/size policy and outbound safety ports.
- Identity services and hashing now live in `@jini-ai/user-management` and `@jini-ai/user-management/server`; Identity tool registration composition is exported by the user-management server entry. Remove the former identity workspace dependency from CMS and exclude retired identity build output from packaging.
- BREAKING: CMS domain functions, constructors, lifecycle handlers and scalar/callback repository, event-bus, outbox and change-set methods use `(requiredArgs, optionalArgs)` object arguments. Optional configuration and seeds move to the second object. Entry/content-type transactions use `transaction({ fn })`; their authorization ports use required principal/permission/workspace fields plus optional entity scope in the second object. Error details, validation and ordering are preserved. Hosts must rewire their adapters and calls.
- BREAKING: Retire `./identity` and `./identity/hasher` CMS export targets after their source migration. Import services from the identity package; import the registration builder from `@jini-ai/user-management/server`.
- Settings and navigation conversions still owned by their active jobs are pending. Legacy core helpers and authorization callbacks remain compatible until those callers migrate.
- Correct `./media` runtime metadata to Node because its existing barrel exposes filesystem, crypto and native-transform adapters; `./media/import` remains universal.
