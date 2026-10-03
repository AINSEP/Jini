/** Daemon route packs; generic transport primitives live in @jini-ai/http-kit. */
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
  registerActiveContextRoutes,
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
  registerHostToolsRoutes,
  resolveEntry,
  resolveHostToolLaunchPlan,
} from './host-tools.js';
export type {
  DaemonShutdownResponse,
  DaemonStatusDeps,
  DaemonStatusResponse,
} from './daemon-status.js';
export { daemonShutdownRoute, daemonStatusRoute, registerDaemonStatusRoutes } from './daemon-status.js';
export type {
  RunCancelResponse,
  RunCreateRequest,
  RunHttpDeps,
  RunInternalErrorContext,
  RunListResponse,
  RunStartContext,
  RunStartHandler,
  RunStartResponse,
  RunStatusResponse,
} from './runs.js';
export {
  registerRunEventStream,
  registerRunRoutes,
  RUN_EVENTS_ROUTE_PATH,
  runCancelRoute,
  runListRoute,
  runStartRoute,
  runStatusRoute,
} from './runs.js';
export { JINI_ROUTE_MANIFEST, manifestRoutesForFamilies, routeFamilyManifest } from './route-manifest.js';
export type { AgentListResponse, AgentModelSummary, AgentsHttpDeps, AgentSummary } from './agents.js';
export { agentListRoute, agentRescanRoute, registerAgentRoutes } from './agents.js';
export type {
  MemoryChangeEmitter,
  MemoryConfigResponse,
  MemoryDeleteEntryResponse,
  MemoryEntryInput,
  MemoryEntryResponse,
  MemoryExtractionLog,
  MemoryExtractionsResponse,
  MemoryHttpDeps,
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
  registerMemoryEventStream,
  registerMemoryRoutes,
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
  registerRoutineRoutes,
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
  registerDaemonDbRoutes,
} from './db-ops.js';
export type {
  ToolCatalogEntry,
  ToolCatalogHttpDeps,
  ToolCatalogQuery,
  ToolCatalogSearchHit,
} from './tool-catalog.js';
export {
  registerToolCatalogRoutes,
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
  registerComponentCatalogRoutes,
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
  registerDelegatedToolRoutes,
} from './delegated-tools.js';
export type {
  RemoteRunEventHttpDeps,
  RemoteRunEventResponse,
  RemoteToolBridgeTokenConfig,
  RemoteToolResultRequest,
  RemoteToolUseRequest,
} from './remote-run-events.js';
export {
  registerRemoteRunEventRoutes,
  remoteToolResultRoute,
  remoteToolUseRoute,
  requireRemoteToolBridgeToken,
} from './remote-run-events.js';
export type {
  FrontendSessionAttachedEvent,
  FrontendSessionErrorEvent,
  FrontendSessionInvocationEvent,
  FrontendSessionResponseBody,
  FrontendSessionResponseRequest,
  FrontendSessionStreamEvent,
  FrontendSessionsHttpDeps,
} from './frontend-sessions.js';
export {
  FRONTEND_SESSION_RESPONSE_ROUTE_PATH,
  FRONTEND_SESSION_STREAM_ROUTE_PATH,
  frontendSessionResponseRoute,
  handleFrontendSessionStream,
  parseCapabilityQuery,
  registerFrontendSessionRoutes,
} from './frontend-sessions.js';
export { createFrontendControl } from './frontend-control.js';
export type {
  CreateFrontendControlOptions,
  FrontendBindErrorContext,
  FrontendControl,
  FrontendHttpExtension,
} from './frontend-control.js';
export type {
  TerminalActionResponse,
  TerminalCreateRequest,
  TerminalListResponse,
  TerminalsHttpDeps,
  TerminalsInternalErrorContext,
} from './terminals.js';
export {
  registerTerminalEventStream,
  registerTerminalRoutes,
  terminalCreateRoute,
  terminalDeleteRoute,
  terminalKillRoute,
  terminalListRoute,
  terminalResizeRoute,
  terminalStdinRoute,
} from './terminals.js';
export type { ModelProxyHttpDeps, ModelProxyInternalErrorContext } from './model-proxy.js';
export { registerModelProxyRoutes } from './model-proxy.js';
export type { HealthHttpDeps, HealthReadinessResult, LivenessResponse, ReadinessResponse, VersionResponse } from './health.js';
export {
  apiHealthRoute,
  apiReadyRoute,
  apiVersionInfoRoute,
  healthRoute,
  readyRoute,
  registerHealthRoutes,
  versionInfoRoute,
} from './health.js';
export type {
  AuthCredentials,
  AuthProvider,
  AuthSession,
  AuthUser,
  Charge,
  ChargeInput,
  ChargeStatus,
  ConnectorsAuthSessionResponse,
  ConnectorsAuthUserResponse,
  ConnectorsAuthVerifyResponse,
  ConnectorsChargeResponse,
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
  PaymentsProvider,
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
  connectorsPaymentsChargeRoute,
  connectorsPaymentsGetRoute,
  connectorsPaymentsRefundRoute,
  connectorsRealtimePublishRoute,
  connectorsStorageDeleteRoute,
  connectorsStorageGetRoute,
  connectorsStorageListRoute,
  connectorsStoragePutRoute,
  registerConnectorsRoutes,
} from './connectors.js';
export type {
  ResearchHttpDeps,
  ResearchInternalErrorContext,
  ResearchProviderCredentials,
  ResearchSearchResponse,
  ResearchSource,
} from './research.js';
export { registerResearchRoutes, researchSearchRoute } from './research.js';
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
  registerMediaRoutes,
} from './media.js';
export type {
  AttachmentClaim,
  AttachmentRejectionReason,
  AttachmentsHttpDeps,
  AttachmentsInternalErrorContext,
  AttachmentStore,
  AttachmentUploadResponse,
  CreateDiskAttachmentStoreOptions,
  ObservedAttachmentIdentity,
  PendingAttachmentSummary,
  RecordedAttachmentIdentity,
  StoredAttachment,
} from './attachments.js';
export {
  ATTACHMENTS_ROUTE_PATH,
  AttachmentRejectedError,
  createDiskAttachmentStore,
  detectAttachmentKind,
  handleAttachmentCleanup,
  handleAttachmentUpload,
  isUnchangedAttachment,
  registerAttachmentRoutes,
  sanitizeAttachmentName,
  writeBoundedAttachmentBody,
} from './attachments.js';
export type {
  XaiAuthStatusResponse,
  XaiHttpDeps,
  XaiInternalErrorContext,
  XaiOauthStartResponse,
  XaiOkResponse,
  XaiSearchResponse,
} from './xai.js';
export {
  registerXaiRoutes,
  xaiAuthStatusRoute,
  xaiOauthCancelRoute,
  xaiOauthCompleteRoute,
  xaiOauthDisconnectRoute,
  xaiOauthStartRoute,
  xaiSearchRoute,
} from './xai.js';
export * from './run-credentials.js';
