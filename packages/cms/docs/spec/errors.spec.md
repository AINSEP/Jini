Spec ID: SPEC-JINI-CMS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d03527ab8122d4f1bdc138096674820e10370a8933fcb0467087ee31472f62ba
spec_mode: reverse_spec


# CMS error contract

## Discriminants and propagation

Catch classes from the subpath you called. Same-named `ForbiddenError`, `VersionConflictError`, `ContentTypeNotFoundError` and `OutboxPort` symbols are separate domain contracts. Most errors have no `.code`; `.name` is not consistently customized. The transport owns HTTP status, retry-after headers and redaction.

Content-type and entry services normally return `{ok:true,value}` or `{ok:false,error}` for domain rejection. Their dependencies can still throw/reject. Other services generally reject promises with domain classes. Tool `fromResult` unwraps success and throws the failed result's error. Pure validation returns its own validation result; it is not an HTTP envelope.

## Core and tool errors

| Class/code | Condition | Caller action |
| --- | --- | --- |
| `DuplicateCommandError`, `changeSetId` | Workspace command key already persisted, or a verified winning insert after uniqueness conflict | Read current state/change set; do not execute again with that key. |
| Core `ForbiddenError`, `permission`, `reason` | Supplied authorization gate denies | Correct authorization; do not disclose command-key history. |
| `EntityNotLiveError`; `ENTITY_IN_TRASH` / `ENTITY_TOMBSTONED` | Liveness guard receives trashed/tombstoned | Restore a trashed row first; permanently deleted rows cannot be edited. |
| `ToolInputError` from `@jini-ai/core` | Input-shape helpers, denied tool permission or uncallable tool | Correct input/permissions/confirmation; expose only intended caller-safe messages. |
| Ordinary `Error` | Partial command auth wiring, inconsistent risk/catalog setup or dependency failure | Fix host wiring or investigate infrastructure; avoid blindly exposing raw messages. |

`DuplicateCommandError({message,changeSetId}, {})`, core `ForbiddenError({message,permission,reason}, {})` and `EntityNotLiveError({entityType,entityId,state}, {})` use object arguments. Tool helpers do not define additional public CMS-specific error classes.

## Navigation, workspace and presentation

| Class | Condition | Caller action |
| --- | --- | --- |
| `MenuNotFoundError` | Menu ID/row missing | Refresh the selection. |
| `MenuValidationError` | Invalid title/slug/tree/target/href or exceeded depth/count | Correct the payload or supported limits. |
| `MenuConflictError` | Duplicate menu slug or stale version | Choose another slug or reload and reapply edits. |
| `MenuLocationBoundError`, `boundLocations` | Purging a trashed menu with bindings without force | Reassign/unbind locations or use a deliberately authorized force operation. |
| `WorkspaceValidationError` | Empty trimmed name or malformed normalized slug | Correct input. |
| `WorkspaceConflictError` | Workspace slug already exists | Read existing workspace or choose another slug. |
| `WorkspaceNotFoundError` | Update/delete targets missing workspace | Refresh state. |
| `WorkspaceLastRemainingError` | Deleting when repo list contains at most one workspace | Retain a workspace. |
| `PresentationSettingsNotFoundError` | Settings row absent | Seed settings in host persistence. |
| `PresentationSettingsValidationError` | Active theme ID absent from supplied/fallback allowlist | Supply a discovered valid ID. |

Most constructors here are `({message}, ErrorOptions = {})`. `MenuLocationBoundError` takes `{message,boundLocations}` and an empty optional object. Non-live menu edits additionally surface core `EntityNotLiveError`.

## Content types

| Class/discriminant | Condition | Caller action |
| --- | --- | --- |
| Domain `ForbiddenError` | Collections permission denied | Obtain permission; do not retry unchanged. |
| `InvalidKeyGrammarError` | Type key fails identifier grammar | Correct key. |
| `ReservedContentTypeKeyError` | Key is `post` or `page` | Choose another key. |
| `InvalidFieldNameGrammarError` | Field name fails identifier grammar | Correct field name. |
| `InvalidFieldKindError` | Field kind outside closed vocabulary | Select a supported kind. |
| `StorageOnlyFieldNotQueryableError` (subclass of preceding class) | Storage-only `json` marked queryable | Disable queryability. |
| `InvalidFieldShapeError`, code `VALIDATION_ERROR`, `violation:{path,expected,received}` | Untrusted fields array/item structure rejected by parser | Correct the indicated shape; received records the type, not raw value. |
| `QueryableFieldCapExceededError` | More than 20 queryable fields | Reduce indexed fields. |
| `VersionConflictError` | Schema update expected version differs | Reload schema/version before applying edits. |
| `ContentTypeNotFoundError`, name `CONTENT_TYPE_NOT_FOUND` | Scoped type absent | Check workspace/key. |
| `ContentTypeAlreadyExistsError`, `tombstoned` | Any row already owns the registration key | Update an existing live type; choose a new key for a tombstone. |
| `ValidationError`, code/name `VALIDATION_ERROR`, `details.reason` | Schema replacement empty (`fields_empty`) or duplicate names (`fields_duplicate_name`) | Correct the field list. |
| `ContentTypeLifecycleError` | Invalid lifecycle edge, including active→tombstone or leaving tombstone | Deprecate first; tombstone is terminal. |
| `CleanupNotEligibleError`, `reason` | Cleanup planning gate fails | See ordered reasons below. |

Most content-type errors extend `ToolInputError` and set their names; cleanup remains plain `Error`. Constructors generally take `{message}` plus `{}`. Exceptions: shape takes the violation object; already-exists takes `{key,tombstoned}`; validation takes `{message,reason}`; cleanup takes `{reason}, {message?}`.

Cleanup reasons are `forbidden`, `not_tombstoned`, `retention_window_not_elapsed`, `export_reference_missing`, `gateway_rejected`. Correct the failing condition before planning again. Execution forwards failed gateway results unchanged; the gateway owns token expiry, redemption, actor class and stale-plan error vocabulary. Index/transaction/outbox failures propagate and may follow committed state.

## Entries

| Class/discriminant | Condition | Caller action |
| --- | --- | --- |
| Domain `ForbiddenError` | Entry-scoped authorization denied | Correct permission. |
| `EntryNotFoundError`, name `ENTRY_NOT_FOUND` | Scoped entry missing | Check ID/workspace. |
| Domain `ContentTypeNotFoundError`, name `CONTENT_TYPE_NOT_FOUND` | Create/import owning type missing or workspace mismatch | Check type/workspace. |
| `ContentTypeNotActiveError` | Create into non-active type; other guarded writes into tombstoned type | Use an eligible type/lifecycle state. |
| `EntrySlugConflictError`, name `ENTRY_SLUG_CONFLICT` | Existing workspace/type/slug | Choose another slug or update existing row. |
| Domain `VersionConflictError` | Wrong expected version, import absence/existence mismatch or import attempts type change | Reload before retry; preserve type. |
| `EntryFieldValidationError`, `fieldErrors` | Field JSON fails current type schema | Correct named fields. |

Constructors take `{message}, {}` except field validation, which takes `{fieldErrors}, {}` and formats its own message. No `.code` is attached. Promise rejection after enqueue failure may mean row/revision already committed.

## Settings

| Class | Condition | Caller action |
| --- | --- | --- |
| `DefinitionInvalidError` | Owner fence, scope mask, default or definition/lifecycle input rejected | Correct registration/lifecycle input. |
| `ScopeNotAllowedError` | Definition forbids requested layer | Choose an allowed scope. |
| `SecretNotSupportedError` | Secret definition requested | Use a host credential store. |
| `ValueValidationFailedError` | Value/default fails schema where checked | Correct value. |
| `RenameRetypeConflictError` | One retype request also changes identity | Split operations. |
| `AliasDepthExceededError` | Rename would target/operate through forbidden aliases | Resolve the active name first. Resolution allows one alias hop and rejects malformed targets, cycles or deeper chains as absent. |
| `DefinitionTombstonedError` | Write targets tombstone | Choose another live setting. |
| `DefinitionNotFoundError` | Write targets absent definition | Register/resolve the correct definition. |
| `PurgeRequiredError` | Exported compatibility class; no current package service constructs it | Handle only if a host adapter explicitly surfaces it; do not infer a built purge guard. |
| Domain `ForbiddenError` | Scope/definitions/purge permission denial or supplied auth/target workspace mismatch | Correct permissions/tenant context. |
| `PrincipalNotFoundError`, `principalId`, `workspaceId` | Other-user target absent/disabled in that workspace | Choose an active scoped principal. |

Settings classes have no stable code or customized name. Most inherit `Error(message?:string, options?)` unchanged; `SecretNotSupportedError` and `PurgeRequiredError` use `{message}, ErrorOptions`; `PrincipalNotFoundError` still uses positional `(message,principalId,workspaceId)`. In-memory transaction overlap rejects with an ordinary error. Reader dependency/coercer failures propagate despite comments describing total reads.

## Taxonomy

| Class | Condition | Caller action |
| --- | --- | --- |
| `TaxonomyNotApplicableError` | Content type not allowed for taxonomy | Select an applicable taxonomy/type or supply policy. |
| `WorkspaceMismatchError` | Content/term resolved outside caller workspace | Correct tenant-bound adapters/IDs. |
| `ContentTypeMismatchError` | Supplied content type differs from resolved kind | Use resolved kind. |
| `TaxonomyNotHierarchicalError` | Parent requested for flat taxonomy | Remove parent. |
| `ParentCrossTaxonomyError` | Parent belongs to another taxonomy | Choose a same-taxonomy parent. |
| `TermNotFoundError` | Hierarchy candidate parent absent | Refresh parent selection. |
| `HierarchyCycleDetectedError` | Parent would create a cycle | Choose another parent. |
| `TaxonomyRecordNotFoundError` / `TermRecordNotFoundError` / `ContentRecordNotFoundError` | Required write target missing | Refresh target/context. |
| `TaxonomyVersionConflictError` | Import expected-version/absence guard fails | Reload version and plan again. |
| `TermHasAssignedContentError`, `assignedCount` | Term delete with content assignments | Unassign first. |
| `TermHasChildTermsError`, `childCount` | Term delete with direct children | Remove/reparent children first. |
| `TaxonomyHasAssignedContentError`, `assignedCount` | Taxonomy delete with assigned content | Unassign its terms first. |
| `SameTermMergeError` | Source and destination IDs identical | Select distinct terms. |

These classes set `.name` and have no `.code`. Constructors take `{message}, {}`, plus the indicated count when present. Authorization failures in taxonomy writers are ordinary `Error`, and gateway failures propagate. Merge token and actor errors belong to the injected gateway.

## Media and import

| Class | Condition | Caller action |
| --- | --- | --- |
| `MediaNotFoundError` | Scoped asset missing | Refresh ID/slug. |
| `MediaValidationError` | Invalid bytes/MIME/size/metadata/dimensions/slug/attributes | Correct payload/policy. |
| `MediaConflictError` | Metadata slug conflicts | Choose another slug. |
| `MediaSourceImmutableError` (validation subclass) | Requested source hash differs from an existing source | Create a new asset. |
| `MediaStillReferencedError` (conflict subclass), `referencing` | Purge before trash; current guard substitutes status for a real content-reference check | Trash first; host must also protect real references. |
| `TransformValidationError` | Invalid name/owner/transform params | Correct definition. |
| `ImageTransformUnavailableError` | Transformer/format unsupported or optional Sharp unavailable | Install/wire a supported transformer through host provisioning. |
| `ImageSourceCorruptError` | Sharp cannot decode source | Replace invalid source bytes. |
| `MediaImportValidationError` on `./media/import` | Invalid URL/byte policy, non-2xx, absent raw bytes, empty/truncated/oversized bytes or disallowed sniffed MIME | Correct source/policy; expired signed URL may require a fresh URL. |

Media constructors generally take `{message}, ErrorOptions`; still-referenced takes `{message,referencing}, {}`; import takes `{message}` only. No stable `.code` is provided. Filesystem missing reads throw ordinary errors; absent remove is idempotent. Network/outbound-guard errors propagate; the package does not normalize their codes or promise retries. Rendition normal absence/gone states are returned as outcomes rather than thrown.

Evidence: exported error classes, service rejection branches, `../core/src/registration-kit.ts` and argument adapters. No tests were executed.

## Trash failures

`TrashAdapterMissingError({ message }, { cause? } = {})` rejects missing/disallowed adapters. Retention/time/batch/lease validation can throw RangeError. Transaction/repo/adapter/follow-up exceptions propagate; notification/reporting callback exceptions are swallowed by service policy. Marker outcomes include not-found/version-changed/blocked; restore/purge preserve index and lease state for unsuccessful outcomes. See `src/trash/ports.ts` for the exact outcome unions.

## Settings mapping

Settings uses a distinct envelope `{error:string,code?:string,details?}`. `UNAUTHENTICATED` is 401; `FORBIDDEN` is 403 with permission/reason when authorization denies; `VALIDATION_ERROR` is 400; disposed routes return `UNAVAILABLE` at 503. Workspace mismatch is 404 `{error:string}` without a code.

CMS classes map per operation: PrincipalNotFoundError → 404 `PRINCIPAL_NOT_FOUND`; DefinitionNotFoundError → 404 `DEFINITION_NOT_FOUND`; DefinitionTombstonedError → 409 `DEFINITION_TOMBSTONED`; ScopeNotAllowedError → 400 `SCOPE_NOT_ALLOWED`; ValueValidationFailedError → 400 `VALUE_VALIDATION_FAILED`; ForbiddenError → 403 `FORBIDDEN`; definition operations additionally map SecretNotSupportedError/DefinitionInvalidError → 400 `SECRET_NOT_SUPPORTED`/`DEFINITION_INVALID`, RenameRetypeConflictError/AliasDepthExceededError → 409 `RENAME_RETYPE_CONFLICT`/`ALIAS_DEPTH_EXCEEDED`. Reset maps only ForbiddenError. Unmapped errors become 500 `{error:'internal error',code:'INTERNAL_ERROR'}`.

Known CMS messages are disclosed; unknown errors are not. Feed poll/reauthorization failures are reported through `onError` or console and leave the stream available for subsequent ticks; denial closes. After headers, HTTP-wrapper failures end the response.

