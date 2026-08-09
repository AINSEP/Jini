// `@jini-ai/ui/core` — the framework-free half of this package: types, decision rules,
// catalogs, and host port contracts for settings and other UI surfaces. No React, no DOM.
//
// This is the former `@jini-ai/ui-core` package, folded in here (2026-08-01) once it became
// clear it was never a standalone package — it was always the framework-free half of THIS
// package's features, split out only because nothing else made that pairing discoverable. See
// this package's README for the full feature map and the `ui-core`/`ui`/`admin` boundary table.
//
// Every export below is a relative re-export of the exact same file the old `@jini-ai/ui-core`
// package's own `src/index.ts` pointed at (now living under `features/<domain>/` alongside — but
// never importing — that feature's `react/` half). Deliberately NOT `export * from
// './features/<domain>/index.js'`: each feature's own barrel also re-exports its React
// components, which would break the "importable without React" guarantee this subpath exists to
// provide. List the framework-free files by name instead.

export type { SettingsDialogChromeLabels, SettingsDialogTabMeta } from './features/settings/dialog/types.js';
export { findActiveTab, resolveInitialActiveTabId } from './features/settings/dialog/rules.js';
export { randomUUID } from './utils/uuid.js';
export {
  isAllowedEndpointUrl,
  isBlockedEndpointHost,
  isLoopbackEndpointHost,
} from './utils/endpoint-policy.js';
export type { IconName } from './icon-name.js';
export type { SoundId, SoundOption } from './features/notifications/notifications-catalog.js';
export {
  DEFAULT_FAILURE_SOUND_ID,
  DEFAULT_SUCCESS_SOUND_ID,
  FAILURE_SOUNDS,
  SUCCESS_SOUNDS,
} from './features/notifications/notifications-catalog.js';

// --- about ---
export type {
  AboutUpdateControl,
  AboutUpdatePrimaryAction,
  AboutUpdateTone,
  AppVersionInfo,
  SilentUpdatesState,
  UpdateKind,
  UpdaterDownloadProgress,
  UpdaterEnvironment,
  UpdaterModel,
  UpdaterState,
  UpdaterStatus,
} from './features/about/types.js';
export {
  ABOUT_UPDATE_KEYS,
  beginSilentUpdatesWrite,
  deriveAboutUpdateControl,
  isAboutUpdateActionDisabled,
  resolveSilentUpdatesWriteFailure,
  resolveSilentUpdatesWriteSuccess,
} from './features/about/rules.js';

// --- appearance ---
export type { SettingsThemeChoice } from './features/appearance/types.js';
export { THEME_OPTIONS, DEFAULT_ACCENT_COLOR, ACCENT_SWATCHES } from './features/appearance/constants.js';
export type { ThemeOption } from './features/appearance/constants.js';
export { normalizeAccentColor, resolveAccentColor, accentVars } from './features/appearance/rules.js';
export type { AccentCssVars } from './features/appearance/rules.js';

// --- connectors ---
// Full surface of the connectors domain logic. `export *` rather than a hand-listed set,
// matching the old ui-core connectors barrel: the React side imports these modules directly, so
// an omission here silently becomes a broken import there.
export * from './features/connectors/constants.js';
export * from './features/connectors/ports.js';
export * from './features/connectors/rules.js';
export * from './features/connectors/types.js';

// --- execution ---
export type {
  AgentAuthStatus,
  AgentCliEnvFieldSpec,
  AgentDiagnostic,
  AgentDiagnosticReason,
  AgentDiagnosticSeverity,
  AgentExecutableRepair,
  AgentExecutableSource,
  AgentFixIntent,
  AgentModelOption,
  AgentModelSource,
  AgentScanState,
  AgentSupportsCustomModel,
  AgentTestState,
  ApiProtocol,
  ByokConfig,
  ByokProviderCredentials,
  ByokRequiredField,
  ConnectionTestState,
  DetectedAgent,
  ExecutionConfig,
  ExecutionMode,
  LocalCliConfig,
  ModelDiscoveryState,
  ProviderPreset,
  ProviderPresetKind,
} from './features/execution/types.js';
export {
  CUSTOM_MODEL_SENTINEL,
  CUSTOM_PRESET_ID,
  DEFAULT_AGENT_CLI_ENV_FIELDS,
  DEFAULT_AGENT_DESCRIPTIONS,
  DEFAULT_BASE_URL_BY_PROTOCOL,
  DEFAULT_PROVIDER_PRESETS,
  PROTOCOL_OPTIONS,
} from './features/execution/constants.js';
export {
  agentCliEnvValue,
  agentDiagnosticTooltip,
  agentExecutableRepairState,
  agentMetaLabel,
  agentModelSummary,
  binPathEnvField,
  cleanAgentVersionLabel,
  cliEnvFieldsForAgent,
  credentialsForPreset,
  customPreset,
  filterAgentModelOptions,
  groupPresets,
  isBaseUrlInvalid,
  isProviderConfigured,
  isValidApiBaseUrl,
  missingRequiredFields,
  nextConfigForAgentCliEnvChange,
  nextConfigForAgentModel,
  nextConfigForAgentReasoning,
  nextConfigForAgentSelect,
  nextConfigForModeChange,
  nextConfigForPresetSelect,
  nextConfigForProtocolSelect,
  parseMaxTokens,
  presetRequiresApiKey,
  presetsForProtocol,
  resolveSelectedPreset,
  selectedAgentModel,
  selectedAgentReasoning,
  shouldShowCustomModelInput,
  showsBaseUrlField,
  sortDetectedAgents,
} from './features/execution/rules.js';
export type { AgentMetaLabels } from './features/execution/rules.js';
export type { ExecutionPort } from './features/execution/ports.js';
export { createFakeExecutionPort } from './features/execution/dependencies.js';
export type { FakeExecutionPortOptions } from './features/execution/dependencies.js';

// --- integrations ---
export type {
  CodexInstallStatus,
  McpClientDescriptor,
  McpClientId,
  McpClientSnippet,
  McpInstallInfo,
  McpInstallPlatform,
  McpSnippetLanguage,
  McpStdioServerConfig,
} from './features/integrations/types.js';
export { DEFAULT_MCP_CLIENT_ID, DEFAULT_MCP_SERVER_NAME, MCP_CLIENTS } from './features/integrations/constants.js';
export {
  buildClaudeCliSnippet,
  buildCodexEnvToml,
  buildCodexTomlSnippet,
  buildCursorDeeplink,
  buildMcpStdioServerConfig,
  buildSharedMcpJson,
  buildVsCodeSnippet,
  buildZedSnippet,
  commandPaletteShortcut,
  homeConfigPath,
  isMcpInstallPrerequisiteMissing,
  methodLabelForClient,
  settingsShortcut,
  snippetForClient,
  utf8Btoa,
} from './features/integrations/rules.js';
export type { McpIntegrationsPort } from './features/integrations/ports.js';
export { createFakeMcpIntegrationsPort } from './features/integrations/dependencies.js';
export type { FakeMcpIntegrationsPortOptions } from './features/integrations/dependencies.js';

// --- language ---
export type { LocaleOption } from './features/language/types.js';

// --- media-providers ---
export type {
  MediaProviderCredentials,
  MediaProviderMap,
  MediaProviderOption,
  MediaProvidersLoadState,
  MediaProvidersSaveState,
} from './features/media-providers/types.js';
export {
  hasAnyConfiguredProvider,
  hasRecoverableFields,
  invalidBaseUrlProviderIds,
  isEntryEmpty,
  isEntryPresent,
  isMarkerOnlyEntry,
  isProviderBaseUrlInvalid,
  maskedKeyLabel,
  mergeDaemonProviders,
  resolveProviderBaseUrl,
  shouldSyncLocalProvidersToDaemon,
  sortProvidersByConfigured,
} from './features/media-providers/rules.js';
export type { MediaProvidersPort } from './features/media-providers/ports.js';
export { createFakeMediaProvidersPort } from './features/media-providers/dependencies.js';
export type { FakeMediaProvidersPortOptions } from './features/media-providers/dependencies.js';
export { DEFAULT_MEDIA_PROVIDER_CATALOG } from './features/media-providers/constants.js';

// --- memory ---
// Full surface of the memory domain logic. `export *`, matching the old ui-core memory barrel:
// the React side imports these modules directly, so an omission here silently becomes a broken
// import there.
export * from './features/memory/async-commit-guard.js';
export * from './features/memory/constants.js';
export * from './features/memory/formatters.js';
export * from './features/memory/ports.js';
export * from './features/memory/rules.js';
export * from './features/memory/types.js';

// --- notifications ---
export type { NotificationsPreferences } from './features/notifications/types.js';
export { DEFAULT_NOTIFICATIONS_PREFERENCES } from './features/notifications/constants.js';
export type { TestStatus } from './features/notifications/rules.js';
export { testStatusLabel } from './features/notifications/rules.js';

// --- privacy ---
export type { PrivacyConsentState, TelemetryPreferences } from './features/privacy/types.js';
export {
  generateInstallationId,
  hasMadeConsentDecision,
  isSharingEnabled,
  nextStateForDeclineAll,
  nextStateForDeleteMyData,
  nextStateForShareAll,
  nextStateForTelemetryPatch,
} from './features/privacy/rules.js';

// --- project-locations ---
export type {
  ProjectLocation,
  ProjectLocationDraft,
  ProjectLocationsActionResult,
  StoredProjectLocation,
} from './features/project-locations/types.js';
export {
  DEFAULT_LOCATION_ID,
  externalLocations,
  isDuplicatePath,
  locationLabel,
  resolveDefaultLocationId,
  saveableDrafts,
  toStoredLocations,
} from './features/project-locations/rules.js';
export type { ProjectLocationsPort } from './features/project-locations/ports.js';
export { createFakeProjectLocationsPort } from './features/project-locations/dependencies.js';
export type { FakeProjectLocationsPortOptions } from './features/project-locations/dependencies.js';

// --- skills ---
export type {
  SkillDetail,
  SkillDraft,
  SkillDraftError,
  SkillFileEntry,
  SkillFilterOption,
  SkillFilters,
  SkillSource,
  SkillSummary,
  SourceFilter,
} from './features/skills/types.js';
export {
  EMPTY_SKILL_DRAFT,
  filterSkills,
  formatSkillFileSize,
  hasAnyCategory,
  humanizeSkillCategory,
  isBuiltInSkill,
  isDeletableSkill,
  localizedSkillDescription,
  localizedSkillName,
  parseTriggers,
  skillFileLeafName,
  skillFileTreeIndent,
  skillFilterOptions,
  skillMatchesFilters,
  skillMatchesSearch,
  summaryToDraft,
  validateSkillDraft,
} from './features/skills/rules.js';
export type { SkillFilterDimension } from './features/skills/rules.js';
export type { SkillWritePayload, SkillsPort } from './features/skills/ports.js';
export { createFakeSkillsPort } from './features/skills/dependencies.js';
export type { FakeSkillsPortOptions } from './features/skills/dependencies.js';

// --- source-config-list ---
// Full surface of the source-config-list domain logic. `export *`, matching the old ui-core
// source-config-list barrel: the React side imports these modules directly, so an omission here
// silently becomes a broken import there.
export * from './features/source-config-list/constants.js';
export * from './features/source-config-list/dependencies.js';
export * from './features/source-config-list/ports.js';
export * from './features/source-config-list/rules.js';
export * from './features/source-config-list/types.js';
