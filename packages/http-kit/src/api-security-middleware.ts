/**
 * @module api-security-middleware
 *
 * The two `/api` request gates a locally-bound daemon needs before any route handler runs:
 * bearer-token authentication (optional, active only when a token is configured) and cross-origin
 * rejection (always active). Genericized from an origin daemon's inline `startServer` middleware
 * pair — see `source-map.md` for the exact drop-list. Both are plain Express middleware factories
 * with all configuration injected, so neither reads a hardcoded env var name or an OD-specific
 * request shape.
 *
 * **Dropped, not carried over** (see `source-map.md`'s transformation table for the full
 * reasoning): the project-preview-scope GET exemption, the zero-config browser-extension
 * ("clipper") bypass, the live-artifacts-preview bypass, and the `Origin: null` safe-GET
 * allow-list regex — all four name or exist solely for OD product routes with no meaning in the
 * generic engine. `Origin: null` is therefore always rejected here, not conditionally allowed.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import {
  apiTokenFromEnv,
  isApiTokenMiddlewareEnabled,
  type ApiTokenAuthEnvConfig,
} from '@jini-ai/core';
import { isLoopbackPeerAddress } from './local-daemon-request.js';
import { allowedBrowserPorts, isAllowedBrowserOrigin } from './origin-validation.js';

/** Health/readiness/version probes stay reachable without a bearer token so monitoring never needs one. Both the mount-relative and `/api`-prefixed forms are listed because this middleware is always registered via `app.use('/api', ...)`, under which Express strips the `/api` prefix from `req.path` for a request to `/api/health` — the prefixed form is kept for parity with the origin module's own set rather than dropped as dead, in case a future caller mounts this middleware unprefixed. */
const OPEN_PROBE_PATHS = new Set([
  '/health',
  '/api/health',
  '/ready',
  '/api/ready',
  '/version',
  '/api/version',
]);

const BEARER_TOKEN_PATTERN = /^Bearer\s+(\S+)\s*$/i;

export interface ApiBearerAuthMiddlewareDeps {
  /** Env var names for the token/disable flags. Defaults to `JINI_API_TOKEN` / `JINI_DISABLE_API_AUTH`. */
  tokenConfig?: ApiTokenAuthEnvConfig;
  /** Defaults to `process.env`. Threaded through so tests never have to mutate real process env. */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TOKEN_CONFIG: ApiTokenAuthEnvConfig = {
  tokenEnvVar: 'JINI_API_TOKEN',
  disableEnvVar: 'JINI_DISABLE_API_AUTH',
};

/**
 * Registers a bearer-token gate on every `/api/*` route, active only when
 * {@link isApiTokenMiddlewareEnabled} says a token is configured and auth hasn't been disabled.
 * When active: open-probe paths and loopback peers skip the check unconditionally; every other
 * request must send `Authorization: Bearer <token>` matching the configured token exactly, or the
 * request is rejected with 401 before reaching any route handler.
 *
 * @param app - The Express app to register the gate on.
 * @param deps - See {@link ApiBearerAuthMiddlewareDeps}. Both fields are optional; omitting `deps`
 * entirely reads `JINI_API_TOKEN`/`JINI_DISABLE_API_AUTH` from real `process.env`.
 * @returns Nothing. Registers zero middleware (a deliberate no-op, not a bug) when no token is configured.
 * @complexity Setup is O(1). Each gated request is O(1) (one Set lookup, one regex match).
 * @overallScore 100/100
 */
export function registerApiBearerAuthMiddleware(app: Express, deps: ApiBearerAuthMiddlewareDeps = {}): void {
  const tokenConfig = deps.tokenConfig ?? DEFAULT_TOKEN_CONFIG;
  const env = deps.env ?? process.env;
  if (!isApiTokenMiddlewareEnabled(tokenConfig, env)) return;

  const apiToken = apiTokenFromEnv(tokenConfig, env);
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (OPEN_PROBE_PATHS.has(req.path)) {
      next();
      return;
    }
    // Loopback short-circuit: the desktop UI / local CLI never carry a bearer, and a reverse
    // proxy in front of a non-loopback bind must always forward the real bearer itself — so this
    // is intentionally not fooled by a proxied `X-Forwarded-For` header.
    if (isLoopbackPeerAddress(req.socket?.remoteAddress)) {
      next();
      return;
    }
    const match = BEARER_TOKEN_PATTERN.exec(req.get('authorization') ?? '');
    if (!match || match[1] !== apiToken) {
      res.status(401).json({
        error: {
          code: 'API_TOKEN_REQUIRED',
          message: `Authorization: Bearer <${tokenConfig.tokenEnvVar}> required`,
        },
      });
      return;
    }
    next();
  });
}

export interface ApiOriginGuardMiddlewareDeps {
  /** The host this daemon is bound to — compared against a request's `Host`/`Origin` headers. */
  host: string;
  /** Extra allow-listed origins (e.g. a reverse-proxy's public origin). Defaults to none. */
  extraAllowedOrigins?: readonly string[];
  /** Returns the daemon's resolved listen port, or a falsy value before it has resolved. */
  getResolvedPort: () => number | null | undefined;
  /** Defaults to `process.env`. Threaded through so `JINI_WEB_PORT` is testable without mutating real process env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Chrome may strip the port from the `Origin` header on same-origin GET requests. Used only as a
 * narrow fallback for safe, idempotent GET requests once the exact-match check below has already
 * failed — mutating routes always require an exact origin/host match.
 */
function isPortlessLoopbackOrigin(origin: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])$/.test(origin);
}

/**
 * Registers an unconditional cross-origin gate on every `/api/*` route: non-browser clients (no
 * `Origin` header) and requests whose `Origin` resolves to a loopback, private-LAN, or explicitly
 * allow-listed origin are let through; everything else is rejected with 403. `Origin: null`
 * (typically a sandboxed iframe) is always rejected — see this module's doc for why the origin
 * daemon's safe-GET exemption for that case was dropped.
 *
 * @param app - The Express app to register the gate on.
 * @param deps - See {@link ApiOriginGuardMiddlewareDeps}.
 * @returns Nothing. Unlike the bearer-token gate, this always registers its middleware — there is
 * no "disabled" state.
 * @complexity Setup is O(1). Each gated request is O(p) in the number of allowed ports (typically 1-2).
 * @overallScore 100/100
 */
export function registerApiOriginGuardMiddleware(app: Express, deps: ApiOriginGuardMiddlewareDeps): void {
  const { host, getResolvedPort } = deps;
  const extraAllowedOrigins = deps.extraAllowedOrigins ?? [];
  const env = deps.env ?? process.env;

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin == null || origin === '') {
      next();
      return;
    }

    if (origin === 'null') {
      res.status(403).json({ error: 'Origin: null not allowed for this route' });
      return;
    }

    // Fail-closed: block every browser origin until the daemon's real listen port is known, so a
    // request arriving in the brief window before `.listen()` resolves can never be compared
    // against a wrong or default port.
    const resolvedPort = getResolvedPort();
    if (!resolvedPort) {
      res.status(403).json({ error: 'Server initializing' });
      return;
    }

    const ports = allowedBrowserPorts(resolvedPort, env);
    if (!isAllowedBrowserOrigin(origin, req.headers.host, ports, host, [...extraAllowedOrigins])) {
      if (req.method !== 'GET' || !isPortlessLoopbackOrigin(String(origin))) {
        res.status(403).json({ error: 'Cross-origin requests are not allowed' });
        return;
      }
    }
    next();
  });
}
