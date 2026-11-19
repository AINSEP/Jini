/** Daemon route packs; generic transport primitives live in @jini-ai/http-kit. */
export { messageRelayRoutes, MESSAGE_RELAY_CLAIM_PATH, type MessageRelayHttpDeps } from './message-relay.js';
export type {
  ResolveWorkspaceRootOptions,
  WorkspaceRootRequest,
  WorkspaceRootResolver,
} from './workspace-root.js';
export { denyAllWorkspaceRoots, resolveWorkspaceRoot, WorkspaceRootDeniedError } from './workspace-root.js';
export type { RunCancellationService } from './cancel-owned-runs.js';
export { cancelRunsOwnedBy } from './cancel-owned-runs.js';
export type { ActiveContextDeps, ActiveContextResource } from './active-context.js';
export {
  ACTIVE_CONTEXT_TTL_MS,
  getActiveRoute,
  activeContextRoutes,
  setActiveRoute,
} from './active-context.js';
export type {
  CatalogueEntry,
  HostEditor,
  HostEditorsResponse,
  HostToolLaunchPlan,
  HostToolProbeEnv,
  LaunchHostToolResult,
  Platform,
  RealPlatform,
} from './host-tools.js';
export {
  applicableForPlatform,
  CATALOGUE,
  currentPlatform,
  defaultProbeEnv,
  hostEditorsRoute,
  launchHostTool,
  listAvailableEditors,
  pathDirs,
  probeCommandOnPath,
  probeMacBundle,
  hostToolsRoutes,
  resolveEntry,
  resolveHostToolLaunchPlan,
} from './host-tools.js';
export type {
  DaemonShutdownResponse,
  DaemonStatusDeps,
  DaemonStatusResponse,
} from './daemon-status.js';
export { daemonShutdownRoute, daemonStatusRoute, daemonStatusRoutes } from './daemon-status.js';
export type {
  RunCancelResponse,
  RunCreateRequest,
  RunHttpDeps,
  RunInternalErrorContext,
  RunListResponse,
  RunStartContext,
  RunMessageRequest,
  RunMessageResponse,
  RunStartHandler,
  RunStartResponse,
  RunStatusResponse,
} from './runs.js';
export {
  RUN_EVENTS_ROUTE_PATH,
  runCancelRoute,
  runListRoute,
  runMessageRoute,
  RUN_MESSAGE_MAX_CHARS,
  runRoutes,
  runStartRoute,
  runStatusRoute,
} from './runs.js';
export { JINI_ROUTE_MANIFEST, manifestRoutesForFamilies, routeFamilyManifest } from './route-manifest.js';
export type { RouteRegistration } from './route-manifest.js';
export type { DaemonRouteHost } from './route-host.js';
export type { AgentListResponse, AgentModelSummary, AgentsHttpDeps, AgentSummary } from './agents.js';
export { agentListRoute, agentRescanRoute, agentRoutes } from './agents.js';
export type {
  MemoryChangeEmitter,
  MemoryConfigResponse,
  MemoryDeleteEntryResponse,
  MemoryEntryInput,
  MemoryEntryResponse,
  MemoryExtractionLog,
  MemoryExtractionsResponse,
  MemoryHttpDeps,
  MemoryInternalErrorContext,
  MemoryRouteDeps,
  MemoryIndexResponse,
  MemoryNoteEntry,
  MemoryNoteEntrySummary,
  MemoryNoteStore,
  MemoryNoteStoreOptions,
  MemoryOverviewResponse,
  MemoryRemovedResponse,
  MemoryTreeNode,
  MemoryTreeNodePatch,
  MemoryTreeResponse,
  MemoryUpdateTreeNodeResponse,
  MemoryVerificationsResponse,
  MemoryVerifyLog,
} from './memory.js';
export {
  memoryClearExtractionsRoute,
  memoryClearVerificationsRoute,
  memoryCreateEntryRoute,
  memoryDeleteEntryRoute,
  memoryListExtractionsRoute,
  memoryListVerificationsRoute,
  memoryOverviewRoute,
  memoryReadEntryRoute,
  memoryRemoveExtractionRoute,
  memoryRemoveVerificationRoute,
  memoryTreeRoute,
  memoryUpdateEntryRoute,
  memoryUpdateTreeNodeRoute,
  memoryWriteConfigRoute,
  memoryWriteIndexRoute,
  memoryRoutes,
} from './memory.js';
export type {
  RoutineDeleteResponse,
  RoutineHttpDeps,
  RoutineListResponse,
  RoutineResponse,
  RoutineRunNowResponse,
  RoutineRunsResponse,
  RoutineScheduler,
} from './routines.js';
export {
  routineRoutes,
  routineCreateRoute,
  routineDeleteRoute,
  routineGetRoute,
  routineListRoute,
  routineRunNowRoute,
  routineRunsListRoute,
  routineUpdateRoute,
} from './routines.js';
export type {
  CreateDaemonDbToolRegistrationsOptions,
  DaemonDbHttpDeps,
  DaemonDbInternalErrorContext,
  DaemonDbOperations,
  DaemonDbStatusReport,
  DaemonDbTableInfo,
  DaemonDbToolRegistrations,
  DaemonDbVacuumResult,
  DbIntegrityIssue,
  DbIntegrityIssueKind,
  DbIntegrityReport,
} from './db-ops.js';
export {
  createDaemonDbToolRegistrations,
  daemonDbInspectRoute,
  daemonDbVacuumRoute,
  daemonDbVerifyRoute,
  DB_INSPECT_TOOL_ID,
  DB_VACUUM_TOOL_ID,
  DB_VERIFY_TOOL_ID,
  denyAllDaemonDbPolicy,
  daemonDbRoutes,
} from './db-ops.js';
export type {
  ToolCatalogEntry,
  ToolCatalogDescribeOptions,
  ToolCatalogHttpDeps,
  ToolCatalogQuery,
  ToolCatalogSearchHit,
} from './tool-catalog.js';
export {
  toolCatalogRoutes,
  toolCatalogDescribeRoute,
  toolCatalogSearchRoute,
} from './tool-catalog.js';
export type {
  ComponentCatalogEntry,
  ComponentCatalogHttpDeps,
  ComponentCatalogQuery,
  ComponentCatalogSearchHit,
} from './component-catalog.js';
export {
  componentCatalogRoutes,
  componentCatalogDescribeRoute,
  componentCatalogSearchRoute,
} from './component-catalog.js';
export type {
  DelegatedToolExecuteRequest,
  DelegatedToolExecuteResponse,
  DelegatedToolsHttpDeps,
  DelegatedToolsInternalErrorContext,
} from './delegated-tools.js';
export {
  delegatedToolExecuteRoute,
  delegatedToolRoutes,
} from './delegated-tools.js';
export type { FamilySelector, ToolFamilyDescription, ToolFamilyPort } from '../core/tool-family.js';
export type {
  RemoteRunEventHttpDeps,
  RemoteRunEventResponse,
  RemoteToolBridgeTokenConfig,
  RemoteToolResultRequest,
  RemoteToolUseRequest,
} from './remote-run-events.js';
export {
  remoteRunEventRoutes,
  remoteToolBridgeTokenGate,
  remoteToolResultRoute,
  remoteToolUseRoute,
} from './remote-run-events.js';
export type {
  FrontendSessionAttachedEvent,
  FrontendSessionErrorEvent,
  FrontendSessionInvocationEvent,
  FrontendSessionResponseBody,
  FrontendSessionResponseRequest,
  FrontendSessionStreamEvent,
  FrontendSessionTimer,
  FrontendSessionsHttpDeps,
} from './frontend-sessions.js';
export {
  FRONTEND_SESSION_RESPONSE_ROUTE_PATH,
  FRONTEND_SESSION_STREAM_ROUTE_PATH,
  frontendSessionResponseRoute,
  frontendSessionRoutes,
  parseCapabilityQuery,
} from './frontend-sessions.js';
export { createFrontendControl } from './frontend-control.js';
export type {
  CreateFrontendControlOptions,
  FrontendBindErrorContext,
  FrontendControl,
} from './frontend-control.js';
export type {
  TerminalActionResponse,
  TerminalCreateRequest,
  TerminalListResponse,
  TerminalsHttpDeps,
  TerminalsInternalErrorContext,
} from './terminals.js';
export {
  terminalCreateRoute,
  terminalDeleteRoute,
  terminalKillRoute,
  terminalListRoute,
  terminalResizeRoute,
  terminalRoutes,
  terminalStdinRoute,
} from './terminals.js';
export type { ModelProxyHttpDeps, ModelProxyInternalErrorContext } from './model-proxy.js';
export { modelProxyRoutes } from './model-proxy.js';
export type { HealthHttpDeps, HealthReadinessResult, LivenessResponse, ReadinessResponse, VersionResponse } from './health.js';
export {
  apiHealthRoute,
  apiReadyRoute,
  apiVersionInfoRoute,
  healthRoute,
  readyRoute,
  healthRoutes,
  versionInfoRoute,
} from './health.js';
export type {
  AuthCredentials,
  AuthProvider,
  AuthSession,
  AuthUser,
  ConnectorsAuthSessionResponse,
  ConnectorsAuthUserResponse,
  ConnectorsAuthVerifyResponse,
  ConnectorsDbQueryResponse,
  ConnectorsDbRecordResponse,
  ConnectorsHttpDeps,
  ConnectorsInternalErrorContext,
  ConnectorsOkResponse,
  ConnectorsStorageGetResponse,
  ConnectorsStorageListResponse,
  ConnectorsStorageMetaResponse,
  DbProvider,
  DbQuery,
  DbRecord,
  RealtimeProvider,
  StorageObjectMeta,
  StorageProvider,
  StoragePutOptions,
} from './connectors.js';
export {
  connectorsAuthSessionRoute,
  connectorsAuthSignInRoute,
  connectorsAuthSignOutRoute,
  connectorsAuthSignUpRoute,
  connectorsDbDeleteRoute,
  connectorsDbGetRoute,
  connectorsDbInsertRoute,
  connectorsDbQueryRoute,
  connectorsDbUpdateRoute,
  connectorsRealtimePublishRoute,
  connectorsStorageDeleteRoute,
  connectorsStorageGetRoute,
  connectorsStorageListRoute,
  connectorsStoragePutRoute,
  connectorsRoutes,
} from './connectors.js';
export type {
  ResearchProvider,
  ResearchSearchRequest,
  ResearchHttpDeps,
  ResearchInternalErrorContext,
  ResearchProviderCredentials,
  ResearchSearchResponse,
  ResearchSource,
} from './research.js';
export { createResearchSearchRoute, researchRoutes, researchSearchRoute } from './research.js';
export type {
  MediaGenerateResponse,
  MediaHttpDeps,
  MediaInternalErrorContext,
  MediaTaskDeleteResponse,
  MediaTaskListResponse,
  MediaTaskResponse,
} from './media.js';
export {
  mediaGenerateRoute,
  mediaTaskDeleteRoute,
  mediaTaskGetRoute,
  mediaTaskListRoute,
  mediaRoutes,
} from './media.js';
export type {
  AttachmentClaim,
  AttachmentStore,
  CreateDiskAttachmentStoreOptions,
  PendingAttachmentSummary,
  StoredAttachment,
} from './attachment-types.js';
export type {
  AttachmentRejectionReason,
} from './attachment-rejections.js';
export type {
  AttachmentsHttpDeps,
  AttachmentsInternalErrorContext,
  AttachmentUploadResponse,
} from './attachment-handlers.js';
export type {
  ObservedAttachmentIdentity,
  RecordedAttachmentIdentity,
} from './attachment-integrity.js';
export {
  ATTACHMENTS_ROUTE_PATH,
  handleAttachmentCleanup,
  handleAttachmentUpload,
} from './attachment-handlers.js';
export {
  AttachmentRejectedError,
  sanitizeAttachmentName,
} from './attachment-rejections.js';
export {
  createDiskAttachmentStore,
} from './attachments.js';
export {
  detectAttachmentKind,
} from './attachment-signatures.js';
export {
  isUnchangedAttachment,
} from './attachment-integrity.js';
export {
  stageAttachmentClaim,
} from './attachment-staging.js';
export {
  writeBoundedAttachmentBody,
} from './attachment-body.js';
export { attachmentCleanupRoutes, attachmentUploadRoutes } from './attachment-routes.js';
export type {
  XaiAuthStatusResponse,
  XaiHttpDeps,
  XaiInternalErrorContext,
  XaiOauthStartResponse,
  XaiOkResponse,
  XaiSearchResponse,
} from './xai.js';
export {
  xaiRoutes,
  xaiAuthStatusRoute,
  xaiOauthCancelRoute,
  xaiOauthCompleteRoute,
  xaiOauthDisconnectRoute,
  xaiOauthStartRoute,
  xaiSearchRoute,
} from './xai.js';
export * from './run-credentials.js';
export type { RunWithToolContext } from './tool-execution-stream.js';
export type {
  AuthorizeToolRun,
  ToolExecutionRoutesOptional,
  ToolExecutionRoutesRequired,
  ToolRunAuthorization,
  ToolRunVerdict,
} from './tool-execution-routes.js';
export {
  DEFAULT_TOOL_EXEC_MAX_BODY_BYTES,
  TOOL_CATALOG_ROUTE_PATH,
  TOOL_EXECUTIONS_ROUTE_PATH,
  toolExecutionRoutes,
} from './tool-execution-routes.js';
export type { ToolExecutionCallerRefusal } from './tool-execution-caller.js';
export { DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR, toolExecutionCallerRefusal } from './tool-execution-caller.js';
export type { AttachmentLookup, AttachmentLookupRequest, AttachmentLookupRoutesRequired } from './attachment-lookup-routes.js';
export { ATTACHMENT_LOOKUP_ROUTE_PATH, attachmentLookupRoutes } from './attachment-lookup-routes.js';
export type { RemoteAttachmentLookupOptional, RemoteAttachmentLookupRequired } from '../remote-attachment-lookup.js';
export { createRemoteAttachmentLookup } from '../remote-attachment-lookup.js';

export { createTavilyResearchProvider } from './research-tavily.adapter.js';
export { createFrontendGuestScope } from './frontend-guest-scope.js';
export type { FrontendHookInput } from './frontend-hook-input.js';
export { restoreSurface } from './surface-restoration.js';
export type { SurfaceHttpResult } from './surface-restoration.js';
export { frontendRequestRoutes } from './frontend-request-route.js';
export type { FrontendRequestRoutesRequired } from './frontend-request-route.js';
export { deliverSurfaceCallback, isSurfaceCallbackPermitted, SURFACE_TYPED_ANSWER_REFUSAL, type SurfaceCallbackInput } from './surface-callback.js';
