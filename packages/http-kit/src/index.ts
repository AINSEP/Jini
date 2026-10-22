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
export type {
  Handler,
  HttpMethod,
  InputParser,
  JsonRouteSpec,
  JsonRoutePorts,
  JsonRouteAuthorize,
  Result,
  RouteInputContext,
} from './types.js';
export { err, ok } from './types.js';
export type {
  ParsedHostHeader,
  RequestWithOriginHeaders,
} from '@jini-ai/core';
export {
  allowedBrowserPorts,
  assertValidAllowedOrigins,
  configuredAllowedHosts,
  configuredAllowedOrigins,
  isAllowedBrowserHost,
  isAllowedBrowserOrigin,
  isIpLiteralHostname,
  isLoopbackOrPrivateLanHost,
  isLocalSameOrigin,
  isPrivateIpv4,
  parseHostHeader,
} from '@jini-ai/core';
export type { AdapterContext } from './adapter.js';
export { ClientFacingError, defineJsonRoute, mountJsonRoute } from './adapter.js';
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
export { mountPackHttp } from './pack-http.js';
export type {
  ApiBearerAuthMiddlewareDeps,
  ApiOriginGuardMiddlewareDeps,
  StrictBearerTokenDeps,
} from './api-security-middleware.js';
export {
  bearerTokenFromHeader,
  registerApiBearerAuthMiddleware,
  registerApiOriginGuardMiddleware,
  requireStrictBearerToken,
  timingSafeTokenMatch,
} from './api-security-middleware.js';
export { isLoopbackHostname } from '@jini-ai/platform/net';
export {
  isLoopbackPeerAddress,
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
export * from './verified-origin.js';
export * from './observability.js';

// Generic request/response and origin primitives used by capability-owned route packs.
export * from './request.js';
export * from './response.js';
export * from './origin.js';
