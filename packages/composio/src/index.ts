/**
 * @module @injini/composio
 *
 * Public surface for the headless Composio integration package.
 */
export type {
  ConnectorAuthDetail,
  ConnectorCatalogDefinition,
  ConnectorCatalogToolDefinition,
  ConnectorDetail,
  ConnectorStatus,
  ConnectorToolApproval,
  ConnectorToolCuration,
  ConnectorToolDetail,
  ConnectorToolSafety,
  ConnectorToolSafetyClassificationInput,
  ConnectorToolSideEffect,
  ConnectorToolUseCase,
  JsonObject,
} from './catalog.js';
export {
  classifyConnectorToolSafety,
  connectorDefinitionToDetail,
  defineConnectorTool,
  isRefreshEligibleConnectorToolSafety,
} from './catalog.js';

export type {
  ComposioConfig,
  ComposioConfigStore,
  FileComposioConfigStoreOptions,
  PublicComposioConfig,
} from './composio-config.js';
export { createFileComposioConfigStore } from './composio-config.js';

export type { ComposioToolkitMetadata } from './composio-descriptions.js';
export {
  COMPOSIO_TOOLKIT_METADATA,
  getComposioToolkitMetadata,
} from './composio-descriptions.js';

export type {
  ComposioAuthConfigPrepareResult,
  ComposioConnectionCompletion,
  ComposioConnectionStart,
  ComposioCredentialMaterial,
  ComposioConnectorProviderOptions,
  ComposioCurationOverlay,
  ComposioPendingConnection,
  ComposioProviderEvent,
  ComposioToolkitCatalogEntry,
  StaticComposioCatalogDefinitionsOptions,
} from './composio.js';
export {
  ComposioConnectorProvider,
  DOCUMENTED_COMPOSIO_TOOLKITS,
  FEATURED_COMPOSIO_CATALOG,
  getStaticComposioCatalogDefinitions,
  isComposioCredentialMaterial,
} from './composio.js';

export type {
  ComposioConnectorServiceOptions,
  ConnectorAuthConfigPrepareResponse,
  ConnectorConnectResult,
  ConnectorConnectionRecord,
  ConnectorConnectionStatus,
  ConnectorCredentialMaterial,
  ConnectorCredentialRecord,
  ConnectorCredentialStore,
  ConnectorDiscoveryResult,
  ConnectorExecuteRequest,
  ConnectorExecuteResponse,
  ConnectorExecutionContext,
  ConnectorOutputProtectionResult,
  ConnectorStatusServiceOptions,
} from './service.js';
export {
  COMPOSIO_AUTH_CONFIG_PREPARE_LIMIT,
  ComposioConnectorService,
  CONNECTOR_MAX_OUTPUT_BYTES,
  CONNECTOR_RUN_LIMIT_TTL_MS,
  CONNECTOR_RUN_RATE_LIMIT_CALLS,
  CONNECTOR_RUN_RATE_LIMIT_WINDOW_MS,
  CONNECTOR_RUN_TOTAL_CALL_LIMIT,
  ConnectorStatusService,
  FileConnectorCredentialStore,
  InMemoryConnectorCredentialStore,
  protectConnectorOutput,
} from './service.js';

export type { ConnectorServiceErrorCode } from './errors.js';
export { ConnectorServiceError } from './errors.js';
