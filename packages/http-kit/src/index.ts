/**
 * @module @jini-ai/http-kit
 * JSON-route transport: parsing/serialization, same-origin guards, Express mounting and pack
 * registration. Capability-owned HTTP entries own domain route packs; core stays framework-free.
 * pack-http.ts mounts the same composed app-services supplied to CLI, skipping packs without HTTP.
 * Post-hoc external CLI tool events cannot serve as pre-execution authorization; a controlled
 * agent protocol is required for that gate. Unknown API error codes default conservatively to 500.
 * Hand-mounted legacy error helpers retain their public surface for patch-sync fidelity; response.ts
 * owns sending. See the capability owners for raw-stream uploads, bodyless cleanup, attachment
 * rejection mapping and host-owned claim/cleanup lifecycle rather than duplicating those rules here.
 */
export type { JsonRouteSpec, JsonRoutePorts, RawRouteSpec, RouteMountOptions, RouteRequestOptIns, RouteDepsSource } from './types.js';
export { defineJsonRoute, mountJsonRoute } from './adapter.js';
export { defineRawRoute, mountRawRoute } from './raw-route.js';
export type { RouteInternalErrorContext, RouteInternalErrorSink } from './internal-error.js';
export { reportRouteInternalError } from './internal-error.js';
export { createReporterRouteInternalError } from './reporter-internal-error.js';
export type { InstallRouteRegistrationGuardOptions, RouteRegistration } from './route-registration-guard.js';
export {
  getRouteRegistrationInventory,
  guardedRouteKey,
  installRouteRegistrationGuard,
  recordRouteRegistrations,
} from './route-registration-guard.js';
export type { CreateSseChannelOptions, SseChannel } from './sse.js';
export { createSseChannel, requestedAfterCursor, sendRawApiError } from './sse.js';
export { mountPackHttp } from './pack-http.js';
export type {
  ApiBearerAuthMiddlewareDeps,
  ApiOriginGuardMiddlewareDeps,
  StrictBearerTokenDeps,
} from './api-security-middleware.js';
export {
  registerApiBearerAuthMiddleware,
  registerApiOriginGuardMiddleware,
  requireStrictBearerToken,
  timingSafeTokenMatch,
} from './api-security-middleware.js';
export {
  localOriginFromHeader,
  normalizeLocalAuthority,
  requireLocalDaemonRequest,
  validateLocalDaemonRequest,
} from './local-daemon-request.js';
export {
  createCompatApiError,
  createCompatApiErrorResponse,
} from './compat.js';
export * from './rate-limit.js';
export * from './middleware.js';
export * from './observability.js';

// Generic request/response and origin primitives used by capability-owned route packs.
export * from './request.js';
export * from './response.js';
export * from './origin.js';
export * from './trust-proxy.js';
