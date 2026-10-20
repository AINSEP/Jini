/**
 * @file The wire vocabulary shared by the host page, the host server and a plugin's admin surface:
 * protocol constants and the message envelopes (init, action request, open-link request, response).
 *
 * Why a separate file: the host-side validator, the server-side dispatcher and the docs all name the
 * same envelope, and it must stay one definition. The surface-side client (`./surface-client.ts`)
 * deliberately repeats the constants instead of importing them so a plugin can copy that one file;
 * the vertical-slice test proves both sides still agree.
 */

/** Discriminates this protocol's messages from anything else posted to the same window. */
export const ADMIN_SURFACE_PROTOCOL = 'jini.admin-surface';
export const ADMIN_SURFACE_PROTOCOL_VERSION = 1;

/** The ONLY sandbox token a surface frame gets. Adding `allow-same-origin` next to `allow-scripts`
 * lets the frame remove its own sandbox, so it is never granted. */
export const ADMIN_SURFACE_SANDBOX = 'allow-scripts';

/** A frame sandboxed without `allow-same-origin` has an opaque origin, which `MessageEvent.origin`
 * serializes as the string "null". Every sandboxed frame shares it, so origin alone never identifies
 * a mount: the per-mount nonce and the frame's window identity do. */
export const SANDBOXED_FRAME_ORIGIN = 'null';

/** Short-lived data the host server issues for one surface render (e.g. a scoped access token plus
 * public config). Never cached (see `adminSurfaceBootstrapHeaders`), refused once `expiresAt` passes. */
export interface AdminSurfaceBootstrap<D = unknown> {
  readonly surfaceId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly data: D;
}

/** Host page -> surface, once per mount, after the frame loads. Carries the mount nonce. */
export interface AdminSurfaceInitMessage {
  readonly protocol: typeof ADMIN_SURFACE_PROTOCOL;
  readonly version: typeof ADMIN_SURFACE_PROTOCOL_VERSION;
  readonly kind: 'init';
  readonly mountId: string;
  readonly bootstrap?: AdminSurfaceBootstrap;
}

/** Surface -> host page. `mountId` must echo the nonce from init. */
export interface AdminSurfaceActionRequest {
  readonly protocol: typeof ADMIN_SURFACE_PROTOCOL;
  readonly version: typeof ADMIN_SURFACE_PROTOCOL_VERSION;
  readonly kind: 'action-request';
  readonly mountId: string;
  readonly requestId: string;
  readonly action: string;
  readonly payload: unknown;
}

/** Surface -> host page: asks the host to open `url` outside the sandbox (`./external-links.ts`).
 * Answered with an `action-response` for `requestId`, like an action. */
export interface AdminSurfaceOpenLinkRequest {
  readonly protocol: typeof ADMIN_SURFACE_PROTOCOL;
  readonly version: typeof ADMIN_SURFACE_PROTOCOL_VERSION;
  readonly kind: 'open-link';
  readonly mountId: string;
  readonly requestId: string;
  readonly url: string;
}

/** Surface-safe failure: `message` is written for the person using the surface and never carries a
 * handler's raw error text, a token or a submitted value. */
export interface AdminSurfaceActionFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type AdminSurfaceActionOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: AdminSurfaceActionFailure };

/** Host page -> surface, answering exactly one request. */
export type AdminSurfaceActionResponse = {
  readonly protocol: typeof ADMIN_SURFACE_PROTOCOL;
  readonly version: typeof ADMIN_SURFACE_PROTOCOL_VERSION;
  readonly kind: 'action-response';
  readonly mountId: string;
  readonly requestId: string;
} & AdminSurfaceActionOutcome;

/** Builds the init envelope the host page posts into a freshly loaded frame.
 * @complexity O(1). */
export function adminSurfaceInitMessage(required: { readonly mountId: string }, optional: { readonly bootstrap?: AdminSurfaceBootstrap } = {}): AdminSurfaceInitMessage {
  return { protocol: ADMIN_SURFACE_PROTOCOL, version: ADMIN_SURFACE_PROTOCOL_VERSION, kind: 'init', mountId: required.mountId, ...(optional.bootstrap ? { bootstrap: optional.bootstrap } : {}) };
}

/** Wraps a dispatcher outcome as the response to one validated request.
 * @complexity O(1). */
export function adminSurfaceActionResponse(required: { readonly request: Pick<AdminSurfaceActionRequest, 'mountId' | 'requestId'>; readonly outcome: AdminSurfaceActionOutcome }, _optional: Record<string, never> = {}): AdminSurfaceActionResponse {
  const { mountId, requestId } = required.request;
  return { protocol: ADMIN_SURFACE_PROTOCOL, version: ADMIN_SURFACE_PROTOCOL_VERSION, kind: 'action-response', mountId, requestId, ...required.outcome };
}
