/**
 * @module @jini/http
 *
 * JSON-route transport for a `@jini/core` daemon composition: the `Result`/route-spec types,
 * request parsing, response serialization, the same-origin guard, the Express-mounting Adapter,
 * legacy-shaped compat error helpers, a route-pack registrar, generic daemon status/shutdown
 * routes, and every route pack this package ships (runs, agents, host-tools, memory, routines,
 * db-ops, terminals, model-proxy, active-context, delegated-tools) — all exported flat at this
 * root, the load-bearing surface every consumer (including `@jini/node-host`'s
 * `createLocalNodeDaemon`) imports from directly.
 *
 * This package supported a switchable `express`/`fastify` HTTP transport from 2026-07-19 through
 * 2026-07-22; it was removed since nothing ever consumed `transport: 'fastify'` in practice, and
 * the maintained-but-unused Fastify subtree cost a recurring "does this new route pack also need a
 * Fastify mounting sibling" tax on every future addition to this package. The removed
 * implementation is preserved, unchanged, on the `future/fastify-transport` branch — see
 * `FASTIFY-TRANSPORT-PARKED.md` at the repo root of that branch for the full reasoning and how to
 * revive it. See `source-map.md` for this package's full provenance and scope-decision notes.
 */
export type {
  Handler,
  HttpMethod,
  InputParser,
  JsonRouteSpec,
  Result,
  RouteInputContext,
} from './types.js';
export { err, ok } from './types.js';

export type {
  ParsedHostHeader,
  RequestWithOriginHeaders,
} from './origin-validation.js';
export {
  allowedBrowserPorts,
  configuredAllowedHosts,
  configuredAllowedOrigins,
  isAllowedBrowserHost,
  isAllowedBrowserOrigin,
  isIpLiteralHostname,
  isLoopbackOrPrivateLanHost,
  isLocalSameOrigin,
  isPrivateIpv4,
  parseHostHeader,
} from './origin-validation.js';

export type { AdapterContext } from './adapter.js';
export { defineJsonRoute, mountJsonRoute } from './adapter.js';

export type { InstallRouteRegistrationGuardOptions, RouteRegistration } from './route-registration-guard.js';
export {
  getRouteRegistrationInventory,
  guardedRouteKey,
  installRouteRegistrationGuard,
} from './route-registration-guard.js';

export type { CreateSseChannelOptions, SseChannel, SseEvent } from './sse.js';
export { createSseChannel, DEFAULT_MAX_QUEUED_SSE_EVENTS, requestedAfterCursor, sendRawApiError } from './sse.js';

export type { CreateSseResponseOptions, SseConnection } from './raw-sse.js';
export { createSseResponse } from './raw-sse.js';

export type {
  ResolveWorkspaceRootOptions,
  WorkspaceRootRequest,
  WorkspaceRootResolver,
} from './workspace-root.js';
export { denyAllWorkspaceRoots, resolveWorkspaceRoot, WorkspaceRootDeniedError } from './workspace-root.js';

export { mountPackHttp } from './pack-http.js';

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

export type { ApiBearerAuthMiddlewareDeps, ApiOriginGuardMiddlewareDeps } from './api-security-middleware.js';
export { registerApiBearerAuthMiddleware, registerApiOriginGuardMiddleware } from './api-security-middleware.js';

export type { RunStreamDeps, RunStreamEncoder, RunStreamInternalErrorContext } from './run-stream.js';
export { handleRunStreamRequest, registerRunStreamRoute, RUN_STREAM_ROUTE_PATH } from './run-stream.js';

export {
  isLoopbackHostname,
  isLoopbackPeerAddress,
  localOriginFromHeader,
  normalizeLocalAuthority,
  requireLocalDaemonRequest,
  validateLocalDaemonRequest,
} from './local-daemon-request.js';

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
  runCancelRoute,
  runListRoute,
  runStartRoute,
  runStatusRoute,
} from './runs.js';

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
  DelegatedToolExecuteRequest,
  DelegatedToolExecuteResponse,
  DelegatedToolsHttpDeps,
  DelegatedToolsInternalErrorContext,
} from './delegated-tools.js';
export { delegatedToolExecuteRoute, registerDelegatedToolRoutes } from './delegated-tools.js';
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

// Legacy-shaped compat error helpers (separate code/message/init call shape). `sendApiError`
// above (from `response.ts`) takes a single `ApiError` object; this compat `sendApiError` takes
// `(code, message, init)` — same job, different call-site generation, so it is re-exported here
// under a distinct name to avoid a duplicate export.
export {
  createCompatApiError,
  createCompatApiErrorResponse,
  sendApiError as sendCompatApiError,
} from './compat.js';
