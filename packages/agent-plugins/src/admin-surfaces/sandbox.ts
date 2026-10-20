/**
 * @file The isolation contract a host applies when it renders and serves an admin surface: the
 * iframe attributes, the Content-Security-Policy and headers for each served surface file, the mount
 * nonce, and the short-lived, never-cached bootstrap envelope.
 *
 * Why these are pure helpers instead of host code: every host must apply the SAME strict values, and
 * the values are the security boundary (no same-origin, no inline script, no direct network access
 * unless the descriptor declared and validation accepted an https origin). Hosts call these and only
 * choose routes.
 */
import type { AdminSurfaceDescriptor } from './descriptor.js';
import { ADMIN_SURFACE_SANDBOX, type AdminSurfaceBootstrap } from './protocol.js';

/** Bootstrap data is meant to live for one render: one minute, fixed so no host can lengthen it. */
const BOOTSTRAP_TTL_MS = 60_000;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

/**
 * The attributes for the `<iframe>` that renders a surface. `sandbox` is exactly `allow-scripts`:
 * the frame gets an opaque origin, so it cannot read the host's cookies, storage or DOM.
 * @complexity O(1).
 */
export function adminSurfaceFrameAttributes(required: { readonly src: string; readonly title: string }, _optional: Record<string, never> = {}) {
  return { src: required.src, title: required.title, sandbox: ADMIN_SURFACE_SANDBOX, referrerPolicy: 'no-referrer' } as const;
}

/**
 * The CSP for every file of one surface. Starts from `default-src 'none'`; scripts, styles, images
 * and fonts may come from the surface's own files; `connect-src` and `frame-src` are closed unless the
 * descriptor declared validated https origins. The `sandbox` directive keeps the document sandboxed
 * even when opened directly rather than through the host's iframe.
 * @complexity O(c) declared CSP sources.
 */
export function adminSurfaceContentSecurityPolicy(required: { readonly descriptor: Pick<AdminSurfaceDescriptor, 'csp'> }, _optional: Record<string, never> = {}): string {
  const extra = (directive: keyof AdminSurfaceDescriptor['csp']) => required.descriptor.csp[directive] ?? [];
  const own = (directive: keyof AdminSurfaceDescriptor['csp']) => [`'self'`, ...extra(directive)].join(' ');
  const closed = (directive: keyof AdminSurfaceDescriptor['csp']) => (extra(directive).length ? extra(directive).join(' ') : `'none'`);
  return [
    `default-src 'none'`,
    `script-src ${own('script-src')}`,
    `style-src ${own('style-src')}`,
    `img-src ${own('img-src')}`,
    `font-src ${own('font-src')}`,
    `connect-src ${closed('connect-src')}`,
    `frame-src ${closed('frame-src')}`,
    `form-action 'none'`,
    `base-uri 'none'`,
    `frame-ancestors 'self'`,
    `sandbox ${ADMIN_SURFACE_SANDBOX}`,
  ].join('; ');
}

/**
 * Response headers for one served surface file. Script files carry `Access-Control-Allow-Origin: *`
 * because a module script requested by an opaque-origin document is a cross-origin CORS fetch; the
 * files are static plugin code fetched without credentials, so they must never contain secrets.
 * @complexity O(c) declared CSP sources.
 */
export function adminSurfaceFileHeaders(required: { readonly descriptor: Pick<AdminSurfaceDescriptor, 'csp'>; readonly path: string }, _optional: Record<string, never> = {}): Readonly<Record<string, string>> {
  const extension = required.path.slice(required.path.lastIndexOf('.') + 1);
  const script = extension === 'mjs' || extension === 'js';
  return {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Content-Security-Policy': adminSurfaceContentSecurityPolicy({ descriptor: required.descriptor }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
    ...(script ? { 'Access-Control-Allow-Origin': '*' } : {}),
  };
}

/** One rendered surface: the nonce its messages must echo (they must also come from origin "null").
 * @complexity O(1). */
export function createAdminSurfaceMount(
  required: { readonly surfaceId: string },
  optional: { readonly randomBytes?: (input: { readonly length: number }) => Uint8Array } = {},
) {
  const randomBytes = optional.randomBytes ?? (({ length }) => globalThis.crypto.getRandomValues(new Uint8Array(length)));
  const mountId = Array.from(randomBytes({ length: 16 }), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { surfaceId: required.surfaceId, mountId };
}

/**
 * The envelope a host server returns for one surface render. Its lifetime is fixed at
 * {@link BOOTSTRAP_TTL_MS}, not caller-chosen: bootstrap data may include a short-lived access token.
 * @complexity O(1).
 */
export function createAdminSurfaceBootstrap<D>(required: { readonly surfaceId: string; readonly data: D; readonly nowMs: number }, _optional: Record<string, never> = {}): AdminSurfaceBootstrap<D> {
  return { surfaceId: required.surfaceId, issuedAt: required.nowMs, expiresAt: required.nowMs + BOOTSTRAP_TTL_MS, data: required.data };
}

/** Headers for the bootstrap response: never stored by the browser or any intermediary cache.
 * @complexity O(1). */
export function adminSurfaceBootstrapHeaders(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): Readonly<Record<string, string>> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** True while the bootstrap may still be used.
 * @complexity O(1). */
export function isAdminSurfaceBootstrapCurrent(required: { readonly bootstrap: Pick<AdminSurfaceBootstrap, 'expiresAt'>; readonly nowMs: number }, _optional: Record<string, never> = {}): boolean {
  return required.nowMs < required.bootstrap.expiresAt;
}
