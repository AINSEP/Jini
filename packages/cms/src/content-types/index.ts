/**
 * @file Public surface (barrel) for the `content-types` library.
 *
 * A module's public contract is its `index.ts` — deep imports from outside this
 * directory should go through here.
 *
 * See `../entries/index.js`'s header for why these two ship as separate subpaths rather than one.
 */
export type {
  ContentTypeFieldKind,
  ContentTypeFieldDef,
  ContentTypeStatus,
  ContentTypeRecord,
  ActorPrincipalKind,
  ActorIdentityInput,
  Result,
} from "./types.js";
export { CONTENT_TYPE_FIELD_KINDS, isContentTypeFieldKind } from "./types.js";

export type { ContentTypeListPort } from "./list.js";
export { listContentTypes } from "./list.js";

export { parseContentTypeFieldDefs } from "./field-defs.js";

/**
 * These are exported as **values**, not types: callers catch them with `instanceof`. Because this
 * barrel re-exports rather than redeclares, there is exactly one class object per error across
 * every consumer. `ForbiddenError`/`VersionConflictError`/`ContentTypeNotFoundError` are this
 * module's own and are deliberately distinct from the same-named classes on `../entries/index.js`
 * and `../core/commands/command.js` — a consumer must catch the one it actually called into.
 */
export {
  ForbiddenError,
  InvalidKeyGrammarError,
  ReservedContentTypeKeyError,
  InvalidFieldNameGrammarError,
  InvalidFieldKindError,
  InvalidFieldShapeError,
  QueryableFieldCapExceededError,
  VersionConflictError,
  ContentTypeNotFoundError,
  ValidationError,
  ContentTypeLifecycleError,
  CleanupNotEligibleError,
} from "./errors.js";

/**
 * The queryable-field index machinery. `IDENTIFIER_GRAMMAR_PATTERN` is exported because it is the
 * single definition of the identifier grammar — the published agent-tool schemas reference it
 * rather than restating it, and a consumer validating input ahead of a call must reach the same
 * one. `mapFieldKindToCast`/`buildQueryableFieldIndexName` are what a host's own DDL provisioner
 * needs in order to generate the same index names this module expects to find.
 */
export type { FieldIndexState, FieldIndexTransition } from "./index-provisioning.js";
export {
  IDENTIFIER_GRAMMAR_PATTERN,
  validateIdentifierGrammar,
  mapFieldKindToCast,
  buildQueryableFieldIndexName,
  resolveFieldIndexTransition,
} from "./index-provisioning.js";

export type {
  AuthorizeFn,
  ContentTypeRevisionInput,
  ContentTypeRepoPort,
  IndexProvisionerPort,
  OutboxPort,
  WatermarkPort,
  ContentTypeWriteServiceDeps,
  RegisterContentTypeRequired,
  UpdateContentTypeFieldsRequired,
} from "./write-service.js";
export { registerContentType, updateContentTypeFields } from "./write-service.js";

export type {
  LifecycleTransitionInput,
  DeprecateContentTypeRequired,
  ReactivateContentTypeRequired,
  TeardownIndexProvisionerPort,
  TombstoneContentTypeRequired,
} from "./lifecycle.js";
export {
  deprecateContentType,
  reactivateContentType,
  tombstoneContentType,
} from "./lifecycle.js";

export type {
  ContentTypeLifecycleOp,
  ContentTypeLifecycleHandler,
  LifecycleDispatchDeps,
  LifecycleDispatchInput,
} from "./lifecycle-dispatch.js";
export {
  CONTENT_TYPE_LIFECYCLE_OP_NAMES,
  CONTENT_TYPE_LIFECYCLE_OPS,
  parseContentTypeLifecycleOp,
} from "./lifecycle-dispatch.js";

/**
 * Cleanup is the permanent-removal path for a tombstoned type. Both halves are gateway-mediated:
 * this module never performs the destructive removal on its own authority, it plans and then
 * forwards a redeemed confirmation token.
 */
export type {
  CleanupEligibilityCheckRepoPort,
  PlanCleanupGatewayPort,
  PlanCleanupRequired,
  ExecuteCleanupGatewayPort,
  CleanupRemovalRepoPort,
  ExecuteCleanupRequired,
} from "./cleanup.js";
export { planCleanup, executeCleanup } from "./cleanup.js";

/**
 * The in-memory repository and the no-op index provisioner. The latter is the correct
 * `IndexProvisionerPort` for any store with no DDL to run (an in-memory or document backend), not
 * merely a test double.
 */
export {
  InMemoryContentTypeRepo,
  NoopContentTypeIndexProvisioner,
  toContentTypeOutbox,
} from "./repo.memory.js";

/** The agent-tool surface for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  contentTypesAgentToolCatalog,
  type AgentToolDefinition as ContentTypesAgentToolDefinition,
  type AgentToolSideEffect as ContentTypesAgentToolSideEffect,
  type AgentToolActorClassRule as ContentTypesAgentToolActorClassRule,
} from "./agent-tools.js";

/**
 * The agent-tool wiring for this domain.
 *
 * `ContentTypesToolDeps` is declared structurally rather than derived from any host's
 * request-scoped dependency bag, which is what lets a host satisfy it by passing whatever object it
 * already has — the shape is the contract, so no host type needs to be named here.
 */
export {
  buildContentTypesRegistrations,
  contentTypesDerivedRisk,
  type ContentTypesToolDeps,
} from "./tool-registrations.js";

/**
 * There is no SQLite adapter export here, deliberately — same reason as `../entries/index.js`.
 */
