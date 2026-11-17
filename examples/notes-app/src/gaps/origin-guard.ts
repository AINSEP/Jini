// GAP: G-ORIGIN core's same-origin guard does not fit a web Request
/**
 * @file Host/Origin guard for a localhost-bound app, as a `ServerMiddleware`. It is built from core's
 * origin primitives, not core's `guardSameOrigin`, because that one (a) reads plain-object headers,
 * not a web `Request`'s `Headers`, (b) answers one undifferentiated FORBIDDEN where this app tells
 * a bad Host from a bad Origin, and (c) lets a request with no Origin through whatever its
 * `Sec-Fetch-Site` says, which a cross-site POST must not be.
 */
import type { ServerMiddleware } from '@jini-ai/core/contracts/server';
import { allowedBrowserPorts, isAllowedBrowserHost, isAllowedBrowserOrigin, type OriginValidationEnvConfig } from '@jini-ai/core';

// The env vars are never read (env is empty); the config type just requires names.
const CONFIG: OriginValidationEnvConfig = { allowedOriginsEnvVar: 'NOTES_ALLOWED_ORIGINS', webPortEnvVar: 'NOTES_WEB_PORT', bindHostEnvVar: 'NOTES_BIND_HOST' };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function refuse({ code, message }: { code: string; message: string }): Response {
  return Response.json({ error: { code, message } }, { status: 403 });
}

/**
 * Refuses a request whose Host is not loopback on the bound port, whose Origin is not the app's own,
 * or (for a state-changing method) that the browser marks `Sec-Fetch-Site: cross-site`.
 * `port` is read per request, so the guard follows the real bound port; while it is 0 (not
 * listening) every request is refused. Nothing is taken from a request header except what is checked.
 */
export function createOriginGuard({ port }: { readonly port: () => number }, _optional: Record<string, never> = {}): ServerMiddleware {
  return ({ request, next }) => {
    const origin = request.headers.get('origin');
    const check = { config: CONFIG, hostHeader: request.headers.get('host'), ports: allowedBrowserPorts({ config: CONFIG, port: port(), env: {} }), bindHost: '127.0.0.1', extraAllowedOrigins: [] };
    if (!isAllowedBrowserHost(check)) return refuse({ code: 'HOST_REJECTED', message: 'This app only answers requests addressed to its own localhost address.' });
    if (origin !== null && origin !== '' && !isAllowedBrowserOrigin({ ...check, origin })) {
      return refuse({ code: 'ORIGIN_REJECTED', message: 'Cross-origin requests are not allowed.' });
    }
    if (!SAFE_METHODS.has(request.method) && request.headers.get('sec-fetch-site') === 'cross-site') {
      return refuse({ code: 'ORIGIN_REJECTED', message: 'Cross-site requests are not allowed.' });
    }
    return next();
  };
}
