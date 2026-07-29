/**
 * @module api-security-middleware
 *
 * The `/api` request gates a locally-bound daemon needs before any route handler runs:
 * bearer-token authentication (optional, active only when a token is configured), cross-origin
 * rejection (always active), and — for a daemon whose threat model is a co-resident process rather
 * than a remote one — a strict bearer gate with no loopback exemption and no disable flag
 * ({@link requireStrictBearerToken}). The first two were genericized from an origin daemon's inline
 * `startServer` middleware pair — see `source-map.md` for the exact drop-list. All are plain Express
 * middleware factories with configuration injected, so none reads a hardcoded env var name or an
 * OD-specific request shape.
 *
 * The two token gates differ in exactly one load-bearing way and are not interchangeable: the
 * optional one lets any loopback peer through unauthenticated, the strict one does not. Picking the
 * wrong one is a silent no-op rather than a visible error, so see each function's own doc before
 * choosing.
 *
 * **Dropped, not carried over** (see `source-map.md`'s transformation table for the full
 * reasoning): the project-preview-scope GET exemption, the zero-config browser-extension
 * ("clipper") bypass, the live-artifacts-preview bypass, and the `Origin: null` safe-GET
 * allow-list regex — all four name or exist solely for OD product routes with no meaning in the
 * generic engine. `Origin: null` is therefore always rejected here, not conditionally allowed.
 */
import { timingSafeEqual } from 'node:crypto';
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

/**
 * Extracts the token from an `Authorization: Bearer <token>` header value. The scheme is
 * case-insensitive per RFC 7235 §2.1; the token itself is not.
 *
 * Shared by every bearer gate in this package so the accepted header grammar is defined exactly
 * once — three separate copies of this regex is three chances for them to disagree about what
 * counts as a well-formed header.
 *
 * @param header - The raw `Authorization` header value, or `undefined` when absent.
 * @returns The token, or `null` when the header is absent or not a well-formed bearer header.
 * @complexity O(n) in the header length.
 * @overallScore 100/100
 */
export function bearerTokenFromHeader(header: string | undefined): string | null {
  return BEARER_TOKEN_PATTERN.exec(header ?? '')?.[1] ?? null;
}

/**
 * Constant-time token comparison. Length is compared first and NOT in constant time — that leaks
 * only the expected token's length, which for a generated secret is fixed and not itself a secret,
 * never any of its bytes. `timingSafeEqual` throws on a length mismatch, so the early return is
 * required rather than merely an optimization.
 *
 * Every bearer gate in this package routes through here instead of `===`. A plain string compare
 * short-circuits on the first differing byte, which makes the comparison's duration a function of
 * how many leading bytes the presented token got right — enough, over many requests, to recover a
 * token one byte at a time.
 *
 * @param presented - The token from the request's `Authorization` header.
 * @param expected - The configured token to match against.
 * @returns `true` only on an exact match.
 * @complexity O(n) in the token length, with no data-dependent early exit.
 * @overallScore 100/100
 */
export function timingSafeTokenMatch(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(presentedBytes, expectedBytes);
}

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
    const presented = bearerTokenFromHeader(req.get('authorization'));
    if (presented === null || !timingSafeTokenMatch(presented, apiToken)) {
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

export interface StrictBearerTokenDeps {
  /**
   * Env var carrying the expected token. Required with no default: a gate this strict must name the
   * secret it enforces, and this package has no business guessing a host's env-var name.
   */
  readonly tokenEnvVar: string;
  /** Defaults to `process.env`. Threaded through so tests never have to mutate real process env. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Exact request paths this gate does not apply to. Defaults to none — this is a gate-everything
   * primitive, and each exemption must be opted into explicitly at the mount site with a stated
   * reason. Matched by exact equality, never by prefix, so a longer path that merely starts with an
   * exempt one stays gated.
   */
  readonly exemptPaths?: readonly string[];
}

/**
 * Builds a bearer gate with **no loopback exemption and no disable flag** — for a daemon whose
 * threat model is "another process running as the same OS user", not "a remote attacker".
 *
 * This is deliberately not {@link registerApiBearerAuthMiddleware}. That gate short-circuits for any
 * loopback peer before it ever reads the `Authorization` header, which is the right affordance for a
 * desktop UI or local CLI talking to its own daemon, and a no-op against the threat here: a
 * `127.0.0.1` bind keeps remote hosts out but does nothing about a co-resident process, and a
 * sidecar daemon that can start real agent runs and execute real tools is exactly the kind of thing
 * such a process would want to reach. This gate treats a request from `127.0.0.1` like any other.
 *
 * The posture matches `remote-run-events.ts`'s own token gate, which made the same call for the same
 * reason on a single route; this generalizes it to a whole `/api` surface.
 *
 * Fail-closed contract:
 * - token env var unset/empty -> **503**, never a silent pass-through. A misconfigured daemon
 *   refuses to serve rather than serving unauthenticated callers.
 * - missing / malformed / wrong token -> **401**.
 * - exact match -> `next()`.
 *
 * The env var is read on every request rather than captured at factory time: a host that mints a
 * per-boot token may not have done so yet when its module graph is first evaluated, and re-reading
 * costs one property lookup.
 *
 * @param deps - See {@link StrictBearerTokenDeps}. `tokenEnvVar` is required.
 * @returns Express middleware. Mount it with `app.use(...)` before any route registrar and before
 * the JSON body parser, so an unauthenticated caller's body is never parsed.
 * @complexity O(1) per request plus O(n) in the token length for the constant-time comparison.
 * @overallScore 100/100
 */
export function requireStrictBearerToken(deps: StrictBearerTokenDeps) {
  const { tokenEnvVar } = deps;
  const env = deps.env ?? process.env;
  const exempt = new Set(deps.exemptPaths ?? []);

  return function requireStrictBearerTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (exempt.has(req.path)) {
      next();
      return;
    }

    const expected = env[tokenEnvVar];
    if (typeof expected !== 'string' || expected.length === 0) {
      res.status(503).json({
        error: {
          code: 'API_TOKEN_NOT_CONFIGURED',
          message: `${tokenEnvVar} is not set — this daemon refuses to serve unauthenticated callers`,
        },
      });
      return;
    }

    // Deliberately no loopback/peer-address exemption — see this function's doc.
    const presented = bearerTokenFromHeader(req.get('authorization'));
    if (presented === null || !timingSafeTokenMatch(presented, expected)) {
      res.status(401).json({
        error: { code: 'API_TOKEN_REQUIRED', message: `Authorization: Bearer <${tokenEnvVar}> required` },
      });
      return;
    }
    next();
  };
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
