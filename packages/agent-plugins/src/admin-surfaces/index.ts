/**
 * @file Public barrel for `@jini-ai/agent-plugins/admin-surfaces`: plugin-owned admin surfaces
 * (sandboxed iframes) and the host-mediated action protocol. See `./README.md`.
 *
 * Explicit on purpose: only what a host composes is public. The parsers, checkers and message
 * constants behind these entry points stay internal, so they can change without a host noticing.
 */
export {
  adminSurfaceInitMessage, adminSurfaceActionResponse,
  type AdminSurfaceBootstrap, type AdminSurfaceInitMessage, type AdminSurfaceActionRequest, type AdminSurfaceActionFailure,
  type AdminSurfaceActionOutcome, type AdminSurfaceActionResponse, type AdminSurfaceOpenLinkRequest,
} from './protocol.js';
export type { AdminSurfaceActionSchema } from './action-schema.js';
export { parseAdminSurfacesFile, type AdminSurfaceCspDirective, type AdminSurfaceAction, type AdminSurfaceDescriptor } from './descriptor.js';
export { adminSurfaceFrameAttributes, createAdminSurfaceMount, createAdminSurfaceBootstrap, adminSurfaceBootstrapHeaders } from './sandbox.js';
export { validateAdminSurfaceMessage, type AdminSurfaceMessageEvent, type AdminSurfaceMountRecord, type AdminSurfaceMessageVerdict } from './host-validator.js';
// AdminSurfaceActionError stays public: a host's OWN handlers throw it to send a code the surface can show.
export { createAdminSurfaceActionDispatcher, AdminSurfaceActionError, type AdminSurfaceActionHandler } from './action-dispatcher.js';
export { defineAdminSurfaceContribution, readAdminSurfaceFile, type LoadedAdminSurface } from './contribution.js';
export {
  defineAdminSurfaceHandlerContribution, createAdminSurfaceHandlerHost,
  type AdminSurfaceHandlerContext, type AdminSurfacePluginContext, type AdminSurfaceBootstrapCall, type AdminSurfaceHandlerCall,
  type AdminSurfaceHandlerModule, type LoadedAdminSurfaceHandlers, type AdminSurfaceHostKind,
} from './surface-handlers.js';
export type { AdminSurfaceConnectionDeclaration, AdminSurfaceCapabilityDeclarations } from './capability-declarations.js';
export {
  ADMIN_SURFACE_ACTION_INTENTS, ADMIN_SURFACE_STATE_LIMITS,
  type AdminSurfaceConnectionState, type AdminSurfaceConnectionAction, type AdminSurfaceRevocationOutcome, type AdminSurfaceConnectionStatus, type AdminSurfaceSignInAttempt,
  type AdminSurfaceAuthorizationStart, type AdminSurfaceConnections, type AdminSurfaceStateValue, type AdminSurfaceState,
  type AdminSurfacePublicConfig, type AdminSurfaceCapabilities, type AdminSurfaceCapabilitiesPort,
} from './surface-capabilities.js';
export type { AdminSurfaceDeliveryBinding, AdminSurfaceDeliveryBindingDraft, AdminSurfaceDeliveryBindings } from './delivery-bindings.js';
export { openAdminSurfaceLink, type AdminSurfaceOpenLinkPort, type AdminSurfaceLinkVerdict } from './external-links.js';
export { createAdminSurfaceCallbackInbox, type AdminSurfaceCallbackFieldKey } from './callback-field-inbox.js';
