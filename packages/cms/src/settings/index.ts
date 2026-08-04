/**
 * @file Public surface (barrel) for the `settings` library.
 *
 * A module's public contract is its `index.ts` — deep imports from outside
 * this directory should go through here.
 *
 * A host's `repo.sqlite.ts` adapter and any one-time brownfield migration of a
 * host's own legacy pre-ledger settings table are NOT part of this package —
 * a fresh host has no legacy data to migrate, and a SQLite adapter names a
 * host's own database schema. Both stay host-side, composed against the
 * `SettingsRepoPort` this barrel exports.
 */

export {
  SCOPE_BIT,
  type SettingScope,
  type SettingOwnerKind,
  type DefinitionStatus,
  type ValueState,
  type RevisionEntityKind,
  type RevisionOp,
  type SettingValueSchema,
  type SettingDefinitionRecord,
  type SettingValueRecord,
  type SettingRevisionRecord,
  type SettingScopeContext,
} from "./types.js";

export {
  DefinitionInvalidError,
  ScopeNotAllowedError,
  SecretNotSupportedError,
  ValueValidationFailedError,
  RenameRetypeConflictError,
  AliasDepthExceededError,
  DefinitionTombstonedError,
  DefinitionNotFoundError,
  PurgeRequiredError,
  ForbiddenError,
  PrincipalNotFoundError,
} from "./errors.js";

export type { SettingsRepoPort } from "./ports.js";

export { InMemorySettingsRepo } from "./repo.memory.js";

export {
  type DefinitionInput,
  validateDefinitionInput,
  validateValueAgainstSchema,
  registerCoercer,
  invalidateDefinitionNamespaceCache,
  invalidateWorkspaceSettingsCache,
  resolveDefinitionRaw,
  resolveDefinition,
  type ResolvedSetting,
  getEffective,
} from "./settings.js";

export {
  type AuthorizeFn,
  type SettingsWriteServiceDeps,
  deriveRequiredPermission,
  type RegisterDefinitionsRequired,
  registerDefinitions,
  type SetValueRequired,
  set,
  type ClearValueRequired,
  clear,
  type ResetNamespaceRequired,
  resetNamespace,
  type RenameDefinitionRequired,
  renameDefinition,
  type RetypeDefinitionRequired,
  retypeDefinition,
  type ReconcileDefinitionDefaultRequired,
  reconcileDefinitionDefault,
  type DeprecateDefinitionRequired,
  deprecateDefinition,
  type TombstoneDefinitionRequired,
  tombstoneDefinition,
} from "./write-service.js";

export {
  type PurgeServiceDeps,
  type PurgeTenantSettingsRequired,
  purgeTenantSettings,
} from "./purge-service.js";

export {
  type ChangeFeedViewer,
  isRevisionVisibleTo,
  type ChangeFeedBatch,
  collectChangedNamespaces,
} from "./change-feed.js";

export {
  type DefinitionOpRequestItem,
  type DefinitionOpContext,
  type DefinitionOpHandler,
  NON_REGISTER_DEFINITION_OP_NAMES,
  type NonRegisterDefinitionOp,
  parseNonRegisterDefinitionOp,
  NON_REGISTER_DEFINITION_OPS,
} from "./definitions-dispatch.js";

export {
  type SettingDefinitionSpec,
  type EnsureSettingDefinitionsDeps,
  type EnsureSettingDefinitionsInput,
  ensureSettingDefinitions,
} from "./ensure-definitions.js";

export {
  INSTRUCTIONS_NAMESPACE,
  NOTIFICATIONS_NAMESPACE,
  PRIVACY_NAMESPACE,
  APPEARANCE_NAMESPACE,
  LANGUAGE_NAMESPACE,
  type EnsureSettingsUiTabDefinitionsInput,
  ensureSettingsUiTabDefinitions,
} from "./ui-tab-definitions.js";

export {
  type AgentWritablePreference,
  AGENT_PREFERENCE_WRITE_SCOPE,
  AGENT_WRITABLE_PREFERENCES,
  AGENT_WRITABLE_PREFERENCE_IDS,
  resolveAgentWritablePreference,
  AGENT_PREFERENCE_REQUIRED_SCOPE_BIT,
} from "./agent-writable-preferences.js";

/** The agent-tool catalog for this domain. */
export {
  getSettingsAgentToolCatalog,
  type AgentToolDefinition as SettingsAgentToolDefinition,
  type AgentToolSideEffect as SettingsAgentToolSideEffect,
} from "./agent-tools.js";

/**
 * The agent-tool wiring for this domain.
 *
 * `SettingsToolDeps` is declared structurally rather than derived from any host's request-scoped
 * dependency bag, which is what lets a host satisfy it by passing whatever object it already has —
 * the shape is the contract, so no host type needs to be named here.
 */
export {
  buildSettingsRegistrations,
  settingsDerivedRisk,
  type SettingsToolDeps,
} from "./tool-registrations.js";
