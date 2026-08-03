/**
 * @file Public surface (barrel) for the `entries` library (ADR-029).
 *
 * A module's public contract is its `index.ts` (ADR-009 §1) — deep imports from outside this
 * directory should go through here.
 *
 * `entries` and `content-types` ship as two subpaths rather than one because they are two
 * contracts: an entry's write path needs only a *read-only slice* of its owning content type
 * (`OwningContentType` in `types.ts`), never that type's write authority. The dependency between
 * them is type-only and one-directional, and keeping the entry points separate is what makes that
 * checkable rather than merely intended.
 */
export type {
  EntryStatus,
  EntryFieldsJson,
  EntryRecord,
  OwningContentType,
  ActorIdentityInput,
  Result,
} from "./types.js";

export type { EntryListPort } from "./list.js";
export { listEntries } from "./list.js";

export type {
  FieldValidationError,
  ValidateFieldsResult,
} from "./field-validation.js";
export { validateFieldsAgainstSchema, selectVisibleEntryFields } from "./field-validation.js";

/**
 * These are exported as **values**, not types: callers catch them with `instanceof`. Because this
 * barrel re-exports rather than redeclares, there is exactly one class object per error across
 * every consumer.
 *
 * `ForbiddenError` and `VersionConflictError` are this module's own, deliberately distinct from the
 * same-named classes on `../core/commands/command.js` and on `../content-types/index.js`. That
 * separation is inherited from the source this was ported from; a consumer catching across the
 * boundary must catch the one it actually called into.
 */
export {
  ForbiddenError,
  EntryNotFoundError,
  ContentTypeNotFoundError,
  ContentTypeNotActiveError,
  EntrySlugConflictError,
  VersionConflictError,
  EntryFieldValidationError,
} from "./errors.js";

export type { EntryLifecycleOp, EntryLifecycleHandler } from "./lifecycle-dispatch.js";
export {
  ENTRY_LIFECYCLE_OP_NAMES,
  ENTRY_LIFECYCLE_OPS,
  parseEntryLifecycleOp,
} from "./lifecycle-dispatch.js";

export type {
  AuthorizeFn,
  EntryRevisionInput,
  EntryRepoPort,
  ContentTypeLookupPort,
  OutboxPort,
  WatermarkPort,
  CreateEntryRequired,
  UpdateEntryRequired,
  PublishUnpublishEntryRequired,
} from "./write-service.js";
export { createEntry, updateEntry, publishEntry, unpublishEntry } from "./write-service.js";

/**
 * The in-memory repository. Exported for the same reason `navigation` exports its own: a host's
 * concrete adapter implements the port directly, and the in-memory implementation is the reference
 * a consumer tests against before it has one.
 */
export { InMemoryEntryRepo, toEntryOutbox } from "./repo.memory.js";

/** The agent-tool surface for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  entriesAgentToolCatalog,
  type AgentToolDefinition as EntriesAgentToolDefinition,
  type AgentToolSideEffect as EntriesAgentToolSideEffect,
} from "./agent-tools.js";

/**
 * The agent-tool wiring for this domain.
 *
 * `EntriesToolDeps` is declared structurally rather than derived from any host's request-scoped
 * dependency bag, which is what lets a host satisfy it by passing whatever object it already has —
 * the shape is the contract, so no host type needs to be named here.
 */
export {
  buildEntriesRegistrations,
  entriesDerivedRisk,
  type EntriesToolDeps,
} from "./tool-registrations.js";

/**
 * There is no SQLite adapter export here, deliberately. A concrete `EntryRepoPort` over a specific
 * database handle would put one host's persistence choice on this library's public contract and
 * drag that host's schema into every consumer's dependency closure. Hosts compose their own; this
 * entry point exports the ports they compose against.
 */
