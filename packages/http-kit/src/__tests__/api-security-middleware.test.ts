import { describe, expect, it, vi } from 'vitest';
import {
  bearerTokenFromHeader,
  registerApiBearerAuthMiddleware,
  registerApiOriginGuardMiddleware,
  requireStrictBearerToken,
  timingSafeTokenMatch,
} from '../api-security-middleware.js';

const ORIGIN_CONFIG = { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST' };

// PARITY: core's UTF-8 encoding preserves the former Buffer-based Node comparison semantics.
it('binds token comparison without changing UTF-8 replacement or multibyte matching', () => {
  expect(timingSafeTokenMatch({ presented: '\ud800', expected: '\ufffd' })).toBe(true);
  expect(timingSafeTokenMatch({ presented: '🙂', expected: '🙂' })).toBe(true);
  expect(timingSafeTokenMatch({ presented: '🙂', expected: '🙃' })).toBe(false);
});

type MiddlewareHandler = (req: any, res: any, next: any) => void;

/** A minimal Express-app fake: `use('/api', handler)` is the only method either middleware calls. */
function makeApp() {
  const middlewares: MiddlewareHandler[] = [];
  const app = { use: (_path: string, handler: MiddlewareHandler) => middlewares.push(handler) };
  return { app, middlewares };
}

function makeReq(overrides: {
  method?: string;
  path?: string;
  remoteAddress?: string | undefined;
  authorization?: string;
  origin?: string;
  host?: string;
  extraHeaders?: Record<string, string>;
} = {}) {
  const headers: Record<string, string> = {};
  if (overrides.authorization !== undefined) headers.authorization = overrides.authorization;
  if (overrides.origin !== undefined) headers.origin = overrides.origin;
  if (overrides.host !== undefined) headers.host = overrides.host;
  for (const [name, value] of Object.entries(overrides.extraHeaders ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/whatever',
    headers,
    socket: { remoteAddress: overrides.remoteAddress },
    get: (name: string) => headers[name.toLowerCase()],
  };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe('registerApiBearerAuthMiddleware', () => {
  it('registers no middleware at all when no token is configured', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: {} , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    expect(middlewares).toHaveLength(0);
  });

  it('registers no middleware when a token is configured but auth is disabled', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret', JINI_DISABLE_API_AUTH: '1' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    expect(middlewares).toHaveLength(0);
  });

  it('registers a middleware once a token is configured and auth is not disabled', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    expect(middlewares).toHaveLength(1);
  });

  it('lets a matching bearer token through', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(makeReq({ authorization: 'Bearer secret', remoteAddress: '203.0.113.9' }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header with 401 API_TOKEN_REQUIRED', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(makeReq({ remoteAddress: '203.0.113.9' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'API_TOKEN_REQUIRED', message: 'Authorization: Bearer <JINI_API_TOKEN> required' },
    });
  });

  it('rejects a mismatched bearer token with 401', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(makeReq({ authorization: 'Bearer wrong-token', remoteAddress: '203.0.113.9' }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header (no Bearer prefix) with 401', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(makeReq({ authorization: 'Basic secret', remoteAddress: '203.0.113.9' }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('exempts a loopback peer even with no Authorization header', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    const next = vi.fn();
    middlewares[0]!(makeReq({ remoteAddress: '127.0.0.1' }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  // A same-host reverse proxy (nginx/caddy on the same box, proxying to a daemon bound to
  // 127.0.0.1) makes EVERY externally-originated request's socket address loopback, which would
  // otherwise hand the loopback exemption to the whole public internet. A proxy announces itself
  // with a forwarding header; a genuine desktop-UI/local-CLI caller never sets one. The header is
  // therefore read as "this request was proxied", never as a source of trusted identity — its
  // *value* is ignored entirely, so a spoofed one can only ever cost a caller the exemption.
  it.each([
    ['x-forwarded-for', '203.0.113.9'],
    ['x-forwarded-host', 'public.example.com'],
    ['x-forwarded-proto', 'https'],
    ['forwarded', 'for=203.0.113.9;proto=https'],
  ])('refuses the loopback exemption to a request carrying %s', (header, value) => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(makeReq({ remoteAddress: '127.0.0.1', extraHeaders: { [header]: value } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('still lets a proxied loopback request through when it forwards a valid bearer token', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(
      makeReq({
        remoteAddress: '127.0.0.1',
        authorization: 'Bearer secret',
        extraHeaders: { 'x-forwarded-for': '203.0.113.9' },
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('drops the loopback exemption entirely when trustLoopbackPeers is false', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } }, { trustLoopbackPeers: false });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(makeReq({ remoteAddress: '127.0.0.1' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it.each(['/health', '/api/health', '/ready', '/api/ready', '/version', '/api/version'])(
    'exempts the open probe path %s with no Authorization header',
    (path) => {
      const { app, middlewares } = makeApp();
      registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
      const next = vi.fn();
      middlewares[0]!(makeReq({ path, remoteAddress: '203.0.113.9' }), makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
    },
  );

  it('does not exempt a non-probe path for a non-loopback peer', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , env: { JINI_API_TOKEN: 'secret' } , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(makeReq({ path: '/runs', remoteAddress: '203.0.113.9' }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('honors a custom tokenConfig env var pair', () => {
    const { app, middlewares } = makeApp();
    registerApiBearerAuthMiddleware({ app: app as any , tokenConfig: { tokenEnvVar: 'CUSTOM_TOKEN', disableEnvVar: 'CUSTOM_DISABLE' }, env: { CUSTOM_TOKEN: 'xyz' } });
    const next = vi.fn();
    middlewares[0]!(makeReq({ authorization: 'Bearer xyz', remoteAddress: '203.0.113.9' }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  // REGRESSION: fails if registerApiBearerAuthMiddleware reads env from argument two or ambient state.
  it('uses an explicit empty env despite real process.env values', () => {
    const original = process.env.JINI_API_TOKEN;
    try {
      process.env.JINI_API_TOKEN = 'ambient-secret';
      const { app, middlewares } = makeApp();
      registerApiBearerAuthMiddleware({ app: app as any , tokenConfig: { tokenEnvVar: 'JINI_API_TOKEN', disableEnvVar: 'JINI_DISABLE_API_AUTH' } , env: {} });
      expect(middlewares).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.JINI_API_TOKEN;
      else process.env.JINI_API_TOKEN = original;
    }
  });
});

describe('registerApiOriginGuardMiddleware', () => {
  const baseDeps = {
    ...ORIGIN_CONFIG, host: '127.0.0.1', getResolvedPort: () => 7456, env: {} };

  it('always registers exactly one middleware (no disabled state)', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: baseDeps });
    expect(middlewares).toHaveLength(1);
  });

  it('allows a non-browser client (no Origin header) through, any method', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: baseDeps });
    const next = vi.fn();
    middlewares[0]!(makeReq({ method: 'POST' }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects Origin: null with 403, regardless of method or path', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: baseDeps });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(makeReq({ origin: 'null', method: 'GET' }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Origin: null not allowed for this route' });
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed with 403 "Server initializing" while the port has not resolved yet', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: { ...baseDeps, getResolvedPort: () => 0 } });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(
      makeReq({ origin: 'http://127.0.0.1:7456', host: '127.0.0.1:7456' }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server initializing' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a loopback origin matching the resolved port and Host header', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: baseDeps });
    const next = vi.fn();
    middlewares[0]!(
      makeReq({ origin: 'http://127.0.0.1:7456', host: '127.0.0.1:7456' }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('allows an origin present in extraAllowedOrigins even if it would not otherwise match', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({
      app: app as any, deps: {
        ...baseDeps,
        extraAllowedOrigins: ['https://proxy.example.com'],
      }
    });
    const next = vi.fn();
    middlewares[0]!(
      makeReq({ origin: 'https://proxy.example.com', host: 'proxy.example.com' }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a disallowed non-GET cross-origin request with 403', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: baseDeps });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(
      makeReq({ method: 'POST', origin: 'https://evil.example.com', host: '127.0.0.1:7456' }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cross-origin requests are not allowed' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a disallowed GET cross-origin request that is not a portless-loopback origin', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: baseDeps });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(
      makeReq({ method: 'GET', origin: 'https://evil.example.com', host: '127.0.0.1:7456' }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to allowing a disallowed-but-portless-loopback origin on GET only', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: baseDeps });
    const next = vi.fn();
    middlewares[0]!(
      makeReq({ method: 'GET', origin: 'http://127.0.0.1', host: '127.0.0.1:7456' }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not extend the portless-loopback fallback to non-GET methods', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({ app: app as any, deps: baseDeps });
    const next = vi.fn();
    const res = makeRes();
    middlewares[0]!(
      makeReq({ method: 'DELETE', origin: 'http://127.0.0.1', host: '127.0.0.1:7456' }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('reads JINI_WEB_PORT from the injected env, not real process.env', () => {
    const { app, middlewares } = makeApp();
    registerApiOriginGuardMiddleware({
      app: app as any, deps: {
        ...ORIGIN_CONFIG,
        host: '127.0.0.1',
        getResolvedPort: () => 7456,
        env: { JINI_WEB_PORT: '4321' },
      }
    });
    const next = vi.fn();
    middlewares[0]!(
      makeReq({ origin: 'http://127.0.0.1:4321', host: '127.0.0.1:4321' }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses an explicit empty env despite real process.env values', () => {
    const original = process.env.JINI_WEB_PORT;
    try {
      delete process.env.JINI_WEB_PORT;
      const { app, middlewares } = makeApp();
      registerApiOriginGuardMiddleware({ app: app as any, deps: { ...ORIGIN_CONFIG, env: {}, host: '127.0.0.1', getResolvedPort: () => 7456 } });
      const next = vi.fn();
      middlewares[0]!(
        makeReq({ origin: 'http://127.0.0.1:7456', host: '127.0.0.1:7456' }),
        makeRes(),
        next,
      );
      expect(next).toHaveBeenCalledOnce();
    } finally {
      if (original === undefined) delete process.env.JINI_WEB_PORT;
      else process.env.JINI_WEB_PORT = original;
    }
  });
});

describe('bearerTokenFromHeader', () => {
  it('extracts the token from a well-formed header, scheme case-insensitively', () => {
    expect(bearerTokenFromHeader({ header: 'Bearer abc123' })).toBe('abc123');
    expect(bearerTokenFromHeader({ header: 'bearer abc123' })).toBe('abc123');
    expect(bearerTokenFromHeader({ header: 'BEARER abc123' })).toBe('abc123');
  });

  it('tolerates extra surrounding whitespace', () => {
    expect(bearerTokenFromHeader({ header: 'Bearer   abc123  ' })).toBe('abc123');
  });

  it('returns null for an absent, empty, or non-bearer header', () => {
    expect(bearerTokenFromHeader({ header: undefined })).toBeNull();
    expect(bearerTokenFromHeader({ header: '' })).toBeNull();
    expect(bearerTokenFromHeader({ header: 'Basic abc123' })).toBeNull();
    expect(bearerTokenFromHeader({ header: 'Bearer' })).toBeNull();
    expect(bearerTokenFromHeader({ header: 'Bearer ' })).toBeNull();
  });
});

describe('timingSafeTokenMatch', () => {
  it('matches only an exact token', () => {
    expect(timingSafeTokenMatch({ presented: 'secret', expected: 'secret' })).toBe(true);
    expect(timingSafeTokenMatch({ presented: 'secreT', expected: 'secret' })).toBe(false);
  });

  // A length mismatch must return false rather than propagating `timingSafeEqual`'s throw.
  it('returns false rather than throwing on a length mismatch', () => {
    expect(timingSafeTokenMatch({ presented: 'short', expected: 'a-much-longer-secret' })).toBe(false);
    expect(timingSafeTokenMatch({ presented: '', expected: 'secret' })).toBe(false);
    expect(timingSafeTokenMatch({ presented: 'secret', expected: '' })).toBe(false);
  });

  it('handles multi-byte characters by comparing bytes, not code points', () => {
    expect(timingSafeTokenMatch({ presented: 'café', expected: 'café' })).toBe(true);
    // 'é' is 2 bytes, 'e' is 1 — different byte lengths, so no match and no throw.
    expect(timingSafeTokenMatch({ presented: 'café', expected: 'cafe' })).toBe(false);
  });
});

describe('requireStrictBearerToken', () => {
  const TOKEN_ENV_VAR = 'TEST_STRICT_TOKEN';

  it('fails closed with 503 when the token env var is unset', () => {
    const res = makeRes();
    const next = vi.fn();
    requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: {} })(
      makeReq({ authorization: 'Bearer anything' }) as any,
      res as any,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'API_TOKEN_NOT_CONFIGURED', message: expect.stringContaining(TOKEN_ENV_VAR) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  // The fail-closed gate's explicit environment decides between 503 and serving.
  // A host may deliberately inject its live environment to observe later token rotation.
  // PARITY: the host may explicitly inject the live environment.
  it('uses a live environment when the host explicitly injects it', () => {
    const original = process.env[TOKEN_ENV_VAR];
    try {
      process.env[TOKEN_ENV_VAR] = 'from-real-process-env';
      const gate = requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR, env: process.env });

      const okRes = makeRes();
      const okNext = vi.fn();
      gate(makeReq({ authorization: 'Bearer from-real-process-env' }) as any, okRes as any, okNext);
      expect(okNext).toHaveBeenCalledOnce();
      expect(okRes.status).not.toHaveBeenCalled();

      const badRes = makeRes();
      const badNext = vi.fn();
      gate(makeReq({ authorization: 'Bearer wrong' }) as any, badRes as any, badNext);
      expect(badRes.status).toHaveBeenCalledWith(401);
      expect(badNext).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env[TOKEN_ENV_VAR];
      else process.env[TOKEN_ENV_VAR] = original;
    }
  });

  it('fails closed with 503 when the token env var is set but empty', () => {
    const res = makeRes();
    const next = vi.fn();
    requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: '' } })(
      makeReq({ authorization: 'Bearer anything' }) as any,
      res as any,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer header with 401', () => {
    const res = makeRes();
    const next = vi.fn();
    requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: 'right' } })(
      makeReq() as any,
      res as any,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a wrong or malformed bearer token with 401', () => {
    for (const authorization of ['Bearer wrong', 'Basic right', 'right', 'Bearer']) {
      const res = makeRes();
      const next = vi.fn();
      requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: 'right' } })(
        makeReq({ authorization }) as any,
        res as any,
        next,
      );
      expect(res.status, `authorization: ${authorization}`).toHaveBeenCalledWith(401);
      expect(next, `authorization: ${authorization}`).not.toHaveBeenCalled();
    }
  });

  it('calls next() on an exact token match', () => {
    const res = makeRes();
    const next = vi.fn();
    requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: 'right' } })(
      makeReq({ authorization: 'Bearer right' }) as any,
      res as any,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  // THE regression guard for this gate's entire reason to exist. `registerApiBearerAuthMiddleware`
  // calls next() for any loopback peer before reading the header at all; if this gate ever grew that
  // same short-circuit it would silently become a no-op against its actual threat model (another
  // process on the same machine), and every other test here would still pass.
  it('gates a loopback peer exactly like any other caller — no peer-address exemption', () => {
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const res = makeRes();
      const next = vi.fn();
      requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: 'right' } })(
        makeReq({ remoteAddress }) as any,
        res as any,
        next,
      );
      expect(res.status, `remoteAddress: ${remoteAddress}`).toHaveBeenCalledWith(401);
      expect(next, `remoteAddress: ${remoteAddress}`).not.toHaveBeenCalled();
    }
  });

  // The other half of that guard: no `JINI_DISABLE_API_AUTH`-style escape hatch either.
  it('has no disable flag — a truthy disable-shaped env var does not open the gate', () => {
    const res = makeRes();
    const next = vi.fn();
    requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: 'right', JINI_DISABLE_API_AUTH: '1' } })(makeReq({ authorization: 'Bearer wrong' }) as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets an exactly-matching exempt path through without a token', () => {
    const res = makeRes();
    const next = vi.fn();
    requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: 'right' } }, { exemptPaths: ['/api/delegated-tool-calls'] })(makeReq({ path: '/api/delegated-tool-calls' }) as any, res as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  // Exact equality, never prefix: a longer path that merely starts with an exempt one stays gated.
  it('still gates a longer path that only starts with an exempt one', () => {
    const res = makeRes();
    const next = vi.fn();
    requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: 'right' } }, { exemptPaths: ['/api/delegated-tool-calls'] })(makeReq({ path: '/api/delegated-tool-calls/extra' }) as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('exempts nothing by default', () => {
    const res = makeRes();
    const next = vi.fn();
    requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR , env: { [TOKEN_ENV_VAR]: 'right' } })(
      makeReq({ path: '/api/delegated-tool-calls' }) as any,
      res as any,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // The env var is read per-request, not captured at factory time: a host that mints a per-boot
  // token may not have done so when this factory ran.
  it('reads the token env var on every request rather than capturing it at factory time', () => {
    const env: NodeJS.ProcessEnv = {};
    const gate = requireStrictBearerToken({ tokenEnvVar: TOKEN_ENV_VAR, env });

    const before = makeRes();
    gate(makeReq({ authorization: 'Bearer minted-later' }) as any, before as any, vi.fn());
    expect(before.status).toHaveBeenCalledWith(503);

    env[TOKEN_ENV_VAR] = 'minted-later';
    const after = makeRes();
    const next = vi.fn();
    gate(makeReq({ authorization: 'Bearer minted-later' }) as any, after as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(after.status).not.toHaveBeenCalled();
  });
});
