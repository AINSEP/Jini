import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginOAuthPkce,
  PendingAuthCache,
  XAI_OAUTH_PROVIDER_CONFIG,
  type OAuthCallbackListener,
  type OAuthCallbackOutcome,
} from '@jini-ai/agent-runtime';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  registerXaiRoutes,
  xaiAuthStatusRoute,
  xaiOauthCancelRoute,
  xaiOauthCompleteRoute,
  xaiOauthDisconnectRoute,
  xaiOauthStartRoute,
  xaiSearchRoute,
  type XaiHttpDeps,
} from '../xai.js';

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(() => true),
}));

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  patch: (path: string, handler: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return { get: make('get'), post: make('post'), put: make('put'), delete: make('delete'), patch: make('patch'), handlers };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const adapter = { resolvedPortRef: { current: 7456 } };
const REDIRECT_URI = 'http://127.0.0.1:56121/callback';

function makeListener(overrides: Partial<OAuthCallbackListener> = {}): OAuthCallbackListener {
  return {
    address: { host: '127.0.0.1', port: 56121 },
    stop: vi.fn(async () => {}),
    ...overrides,
  };
}

function okTokenResponse(body: Record<string, unknown> = {}) {
  const payload = { access_token: 'atk-123', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rtk-1', scope: 'openid api:access', ...body };
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function okSearchResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

type TestDeps = XaiHttpDeps & {
  dataDir: string;
  pending: PendingAuthCache;
  listenerRef: { current: OAuthCallbackListener | null };
  fetchImpl: typeof fetch;
};

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'xai-http-'));
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

/**
 * Loosely typed on purpose: vitest's `vi.fn(async () => ({...fetch-response-shaped-object}))`
 * mocks never structurally match the real `Response` type's full surface (headers/statusText/...),
 * which is the same reason `research.test.ts`'s `okFetchResponse` helper stubs the *global* `fetch`
 * (an untyped assignment) rather than passing a typed mock around. This package's `fetchImpl` is an
 * explicit injection seam instead, so overrides are accepted loosely here and cast once at the end.
 */
function makeDeps(overrides: Record<string, unknown> = {}): TestDeps {
  return {
    dataDir,
    pending: new PendingAuthCache(30 * 60 * 1000),
    listenerRef: { current: null },
    fetchImpl: vi.fn(),
    ...overrides,
  } as TestDeps;
}

/** Seeds a real pending PKCE state the way `xaiOauthStartRoute` would, without going through the route (so `oauth/complete`/`oauth/cancel` tests can start from a known-valid state). */
function seedPendingState(pending: PendingAuthCache): string {
  return beginOAuthPkce({ config: XAI_OAUTH_PROVIDER_CONFIG, pending, redirectUri: REDIRECT_URI }).state;
}

// ---------------------------------------------------------------------------
// POST /api/xai/oauth/start
// ---------------------------------------------------------------------------

describe('xaiOauthStartRoute', () => {
  it('parse requires no input', () => {
    expect(xaiOauthStartRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });

  it('happy path: begins PKCE, opens the loopback listener, and returns authorizeUrl/state/callback', async () => {
    const listener = makeListener();
    const startCallbackListener = vi.fn(async () => listener);
    const deps = makeDeps({ startCallbackListener });
    const result = await xaiOauthStartRoute.handle(undefined, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.authorizeUrl).toContain('https://auth.x.ai/oauth2/authorize');
    expect(result.value.authorizeUrl).toContain(`client_id=${XAI_OAUTH_PROVIDER_CONFIG.clientId}`);
    expect(typeof result.value.state).toBe('string');
    expect(result.value.state.length).toBeGreaterThan(0);
    expect(result.value.callback).toEqual({ host: '127.0.0.1', port: 56121 });
    expect(deps.listenerRef.current).toBe(listener);
    expect(startCallbackListener).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 56121, path: '/callback', expectedState: result.value.state }),
    );
  });

  it('stops a pre-existing listener before opening a new one', async () => {
    const staleListener = makeListener();
    const newListener = makeListener();
    const startCallbackListener = vi.fn(async () => newListener);
    const deps = makeDeps({ startCallbackListener, listenerRef: { current: staleListener } });
    await xaiOauthStartRoute.handle(undefined, deps);
    expect(staleListener.stop).toHaveBeenCalledTimes(1);
    expect(deps.listenerRef.current).toBe(newListener);
  });

  it('SEC-005: a listener-bind failure is reported and returns a redacted INTERNAL_ERROR, leaving no listener set', async () => {
    const boom = new Error('Port 56121 is already in use');
    const startCallbackListener = vi.fn(async () => {
      throw boom;
    });
    const onInternalError = vi.fn();
    const deps = makeDeps({ startCallbackListener, onInternalError });
    const result = await xaiOauthStartRoute.handle(undefined, deps);
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) } });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ source: 'oauth-start', error: boom }));
    expect(deps.listenerRef.current).toBeNull();
  });

  // Two starts used to interleave at their `await`s: both cleared the shared ref, B installed its
  // listener and returned `ok` to its caller, then A's `startCallbackListener` rejected and A's
  // catch called `stopListener` on the *shared* ref — stopping B's listener. B's caller had already
  // been handed an authorizeUrl pointing at a callback endpoint that no longer existed, so the sign-in
  // would hang forever with nothing to diagnose.
  it('a failing concurrent start does not stop the listener a successful one already returned', async () => {
    const goodListener = makeListener();
    let call = 0;
    const startCallbackListener = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // Lose the race deliberately: yield so the second start gets all the way through first.
        await new Promise((resolveTick) => setTimeout(resolveTick, 10));
        throw new Error('port already in use');
      }
      return goodListener;
    });
    const deps = makeDeps({ startCallbackListener, onInternalError: vi.fn() });

    const [first, second] = await Promise.all([
      xaiOauthStartRoute.handle(undefined, deps),
      xaiOauthStartRoute.handle(undefined, deps),
    ]);

    // Exactly one start succeeded, and whichever one did still owns a live listener.
    const succeeded = [first, second].filter((result) => result.ok);
    expect(succeeded).toHaveLength(1);
    expect(deps.listenerRef.current).toBe(goodListener);
    expect(goodListener.stop).not.toHaveBeenCalled();
  });

  it('respects overridden callback host/port/path', async () => {
    const listener = makeListener({ address: { host: '0.0.0.0', port: 9999 } });
    const startCallbackListener = vi.fn(async () => listener);
    const deps = makeDeps({ startCallbackListener, callbackHost: '0.0.0.0', callbackPort: 9999, callbackPath: '/xai-callback' });
    await xaiOauthStartRoute.handle(undefined, deps);
    expect(startCallbackListener).toHaveBeenCalledWith(expect.objectContaining({ host: '0.0.0.0', port: 9999, path: '/xai-callback' }));
  });

  describe('the loopback listener onCallback (real-browser redirect path)', () => {
    async function startAndCapture(
      overrides: Record<string, unknown> = {},
    ): Promise<{ deps: TestDeps; state: string; onCallback: (outcome: OAuthCallbackOutcome) => Promise<void> | void }> {
      let captured: ((outcome: OAuthCallbackOutcome) => Promise<void> | void) | undefined;
      const deps = makeDeps({
        ...overrides,
        startCallbackListener: vi.fn(async (opts: any) => {
          captured = opts.onCallback;
          return makeListener();
        }),
      });
      const result = await xaiOauthStartRoute.handle(undefined, deps);
      if (!result.ok) throw new Error('expected ok');
      if (!captured) throw new Error('onCallback was not captured');
      return { deps, state: result.value.state, onCallback: captured };
    }

    it('persists the token on a matching ok outcome, the same way manual complete does', async () => {
      const { deps, state, onCallback } = await startAndCapture({ fetchImpl: vi.fn(async () => okTokenResponse()) });
      await onCallback({ kind: 'ok', code: 'browser-code', state });
      expect(deps.listenerRef.current).toBeNull();
      const status = await xaiAuthStatusRoute.handle(undefined, deps);
      expect(status).toMatchObject({ ok: true, value: { connected: true } });
    });

    it('reports (never throws) a non-ok outcome', async () => {
      const onInternalError = vi.fn();
      const { onCallback } = await startAndCapture({ onInternalError });
      await expect(onCallback({ kind: 'error', error: 'access_denied' })).resolves.toBeUndefined();
      expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ source: 'oauth-start' }));
    });

    it('SEC-005: reports (never throws) a token-exchange failure without leaking the upstream body', async () => {
      const onInternalError = vi.fn();
      const { state, onCallback } = await startAndCapture({
        onInternalError,
        fetchImpl: vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'invalid_grant: replayed code' })),
      });
      await onCallback({ kind: 'ok', code: 'c', state });
      expect(onInternalError).toHaveBeenCalledTimes(1);
      const reportedError = onInternalError.mock.calls[0]![0].error as Error;
      expect(reportedError.message).toContain('replayed code');
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/xai/oauth/complete
// ---------------------------------------------------------------------------

describe('xaiOauthCompleteRoute', () => {
  it('parse requires non-empty state and code', () => {
    expect(xaiOauthCompleteRoute.parse({ body: 'not an object', query: {}, params: {} })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' },
    });
    expect(xaiOauthCompleteRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
    expect(xaiOauthCompleteRoute.parse({ body: { state: 'a' }, query: {}, params: {} }).ok).toBe(false);
    expect(xaiOauthCompleteRoute.parse({ body: { state: '  ', code: 'b' }, query: {}, params: {} }).ok).toBe(false);
    expect(xaiOauthCompleteRoute.parse({ body: { state: 'a', code: 'b' }, query: {}, params: {} })).toEqual({ ok: true, value: { state: 'a', code: 'b' } });
  });

  it('trims incidental whitespace off state/code, matching OD real handler\'s server-side .trim() (live-verified 2026-07-22: a padded-but-real state reached the real xAI token endpoint instead of failing "state not found or expired")', () => {
    expect(xaiOauthCompleteRoute.parse({ body: { state: '  a  ', code: '\tb\n' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { state: 'a', code: 'b' },
    });
  });

  it('happy path: exchanges the code, persists the token, stops the listener, returns ok:true', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const listener = makeListener();
    const deps = makeDeps({ pending, listenerRef: { current: listener }, fetchImpl: vi.fn(async () => okTokenResponse()) });

    const result = await xaiOauthCompleteRoute.handle({ state, code: 'auth-code-1' }, deps);
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(listener.stop).toHaveBeenCalledTimes(1);
    expect(deps.listenerRef.current).toBeNull();

    const status = await xaiAuthStatusRoute.handle(undefined, deps);
    expect(status).toEqual({
      ok: true,
      value: { connected: true, expiresAt: expect.any(Number), scope: 'openid api:access', savedAt: expect.any(Number), listening: false },
    });
  });

  it('a padded-but-real state/code (e.g. a copy-paste with a trailing newline) still resolves the pending PKCE entry, matching OD\'s trim-then-lookup behavior', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const deps = makeDeps({ pending, fetchImpl: vi.fn(async () => okTokenResponse()) });

    const parsed = xaiOauthCompleteRoute.parse({ body: { state: `  ${state}\n`, code: ' auth-code-1 ' }, query: {}, params: {} });
    expect(parsed).toEqual({ ok: true, value: { state, code: 'auth-code-1' } });
    if (!parsed.ok) throw new Error('expected ok');

    const result = await xaiOauthCompleteRoute.handle(parsed.value, deps);
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('BAD_REQUEST (not INTERNAL_ERROR) for an unknown/expired state, with no secret to leak', async () => {
    const deps = makeDeps();
    const result = await xaiOauthCompleteRoute.handle({ state: 'unknown-state', code: 'c' }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'xai OAuth state not found or expired' } });
  });

  it('BAD_REQUEST for a replayed (already-consumed) state', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const deps = makeDeps({ pending, fetchImpl: vi.fn(async () => okTokenResponse()) });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    const second = await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    expect(second).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'xai OAuth state not found or expired' } });
  });

  it('SEC-005: a non-ok token-exchange response never leaks the upstream body to the caller', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const onInternalError = vi.fn();
    const deps = makeDeps({
      pending,
      onInternalError,
      fetchImpl: vi.fn(async () => ({ ok: false, status: 400, statusText: 'Bad Request', text: async () => 'invalid_grant: code already used' })),
    });
    const result = await xaiOauthCompleteRoute.handle({ state, code: 'auth-code-1' }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain('invalid_grant');
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  // A non-Error rejection reaches both the `String(error)` fallback in the BAD_REQUEST prefix check
  // and the one inside `redactError`. Neither may assume the thrown value has a `.message`, and the
  // redaction still has to strip a credential embedded in the stringified form.
  it('SEC-005: a non-Error rejection during exchange is stringified and redacted, not crashed on', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const onInternalError = vi.fn();
    const deps = makeDeps({
      pending,
      fetchImpl: vi.fn(async () => { throw 'token endpoint blew up with Bearer atk-leaked-123'; }),
      onInternalError,
    });

    const result = await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const reported = onInternalError.mock.calls[0]![0].error as Error;
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toContain('token endpoint blew up with Bearer [REDACTED]');
    expect(reported.message).not.toContain('atk-leaked-123');
  });

  it('SEC-005: a network-level fetch rejection during exchange is also reported as INTERNAL_ERROR', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const onInternalError = vi.fn();
    const deps = makeDeps({
      pending,
      onInternalError,
      fetchImpl: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    });
    const result = await xaiOauthCompleteRoute.handle({ state, code: 'auth-code-1' }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/xai/oauth/cancel
// ---------------------------------------------------------------------------

describe('xaiOauthCancelRoute', () => {
  it('parse requires no input', () => {
    expect(xaiOauthCancelRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });

  it('stops the in-flight listener without touching a stored token', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const completeDeps = makeDeps({ pending, fetchImpl: vi.fn(async () => okTokenResponse()) });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, completeDeps);

    // A fresh deps object over the same dataDir — sees the token already persisted above — with
    // its own in-flight listener to cancel.
    const listener = makeListener();
    const deps = makeDeps({ listenerRef: { current: listener } });
    const result = await xaiOauthCancelRoute.handle(undefined, deps);
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(listener.stop).toHaveBeenCalledTimes(1);
    expect(deps.listenerRef.current).toBeNull();

    const status = await xaiAuthStatusRoute.handle(undefined, deps);
    expect(status).toMatchObject({ ok: true, value: { connected: true } });
  });

  it('no-ops safely when there is no active listener', async () => {
    const deps = makeDeps();
    const result = await xaiOauthCancelRoute.handle(undefined, deps);
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  // `stopListener` is best-effort by contract: the listener self-closes on completion/timeout anyway,
  // so a failure to stop it must not fail the caller's cancel. It also must still clear the slot, or
  // a dead listener would block the next `oauth/start` forever.
  it('still succeeds and clears the listener slot when stopping the listener throws', async () => {
    const listener = makeListener({ stop: vi.fn(async () => { throw new Error('socket already gone'); }) });
    const deps = makeDeps({ listenerRef: { current: listener } });
    const result = await xaiOauthCancelRoute.handle(undefined, deps);
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(listener.stop).toHaveBeenCalledTimes(1);
    expect(deps.listenerRef.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/xai/auth/status
// ---------------------------------------------------------------------------

describe('xaiAuthStatusRoute', () => {
  it('parse requires no input', () => {
    expect(xaiAuthStatusRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });

  it('reports not connected, not listening, when nothing is stored and no listener is active', async () => {
    const result = await xaiAuthStatusRoute.handle(undefined, makeDeps());
    expect(result).toEqual({ ok: true, value: { connected: false, expiresAt: null, scope: null, savedAt: null, listening: false } });
  });

  it('reports listening:true when a listener is active, independent of connection state', async () => {
    const deps = makeDeps({ listenerRef: { current: makeListener() } });
    const result = await xaiAuthStatusRoute.handle(undefined, deps);
    expect(result).toEqual({ ok: true, value: { connected: false, expiresAt: null, scope: null, savedAt: null, listening: true } });
  });

  // Every other SEC-005 case in this file injects `onInternalError`, so the console.error fallback a
  // host gets by default was never exercised — and it is the only record of a redacted failure.
  it('falls back to console.error when no onInternalError sink is supplied', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A directory where the token file belongs makes `readFile` fail for a real reason (EISDIR),
    // no fs mocking and no network involved — same technique as the injected-sink case below.
    await mkdir(path.join(dataDir, 'xai-oauth-token.json'));

    const result = await xaiAuthStatusRoute.handle(undefined, { dataDir });

    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('internal error (xai/auth-status, correlationId=');
    consoleErrorSpy.mockRestore();
  });

  // A token endpoint may legally omit `token_type`, `expires_in`, and `scope`. The stored token must
  // then default to Bearer and report the two unknown fields as null rather than `undefined`, which
  // would drop them from the JSON response body entirely and break the declared response shape.
  it('defaults token_type to Bearer and reports absent expiry/scope as null, still connected', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const minimalToken = { access_token: 'atk-minimal' };
    const deps = makeDeps({
      pending,
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200, json: async () => minimalToken, text: async () => JSON.stringify(minimalToken) })),
    });

    expect(await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps)).toEqual({ ok: true, value: { ok: true } });
    expect(await xaiAuthStatusRoute.handle(undefined, deps)).toEqual({
      ok: true,
      value: { connected: true, expiresAt: null, scope: null, savedAt: expect.any(Number), listening: false },
    });
  });

  // `dataDir` defaults to `process.cwd()`. Stubbing cwd to the temp dir this test already owns makes
  // that fallback observable: the token written under an explicit dataDir is found again by a deps
  // object that omits it entirely.
  it('defaults dataDir to process.cwd() when omitted', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const seeded = makeDeps({ pending, fetchImpl: vi.fn(async () => okTokenResponse()) });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, seeded);

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dataDir);
    try {
      const result = await xaiAuthStatusRoute.handle(undefined, {});
      expect(result).toMatchObject({ ok: true, value: { connected: true, scope: 'openid api:access' } });
      expect(cwdSpy).toHaveBeenCalled();
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it('SEC-005: a genuine token-file read failure is reported and redacted to INTERNAL_ERROR', async () => {
    // Force a real, non-ENOENT fs failure (EISDIR) rather than mocking fs — a directory at the
    // token file's own path makes `readFile` throw for a real reason, no network involved.
    await mkdir(path.join(dataDir, 'xai-oauth-token.json'));
    const onInternalError = vi.fn();
    const deps = makeDeps({ onInternalError });
    const result = await xaiAuthStatusRoute.handle(undefined, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' } });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ source: 'auth-status' }));
  });
});

// ---------------------------------------------------------------------------
// POST /api/xai/oauth/disconnect
// ---------------------------------------------------------------------------

describe('xaiOauthDisconnectRoute', () => {
  it('parse requires no input', () => {
    expect(xaiOauthDisconnectRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });

  it('stops the listener and clears the stored token', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const deps = makeDeps({ pending, fetchImpl: vi.fn(async () => okTokenResponse()) });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    expect((await xaiAuthStatusRoute.handle(undefined, deps)).ok && true).toBe(true);

    const listener = makeListener();
    const deps2 = { ...deps, listenerRef: { current: listener } };
    const result = await xaiOauthDisconnectRoute.handle(undefined, deps2);
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(listener.stop).toHaveBeenCalledTimes(1);

    const status = await xaiAuthStatusRoute.handle(undefined, deps2);
    expect(status).toEqual({ ok: true, value: { connected: false, expiresAt: null, scope: null, savedAt: null, listening: false } });
  });

  it('is a safe no-op when nothing was ever connected', async () => {
    const result = await xaiOauthDisconnectRoute.handle(undefined, makeDeps());
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('SEC-005: a genuine token-file failure during disconnect is reported and redacted to INTERNAL_ERROR', async () => {
    await mkdir(path.join(dataDir, 'xai-oauth-token.json'));
    const onInternalError = vi.fn();
    const deps = makeDeps({ onInternalError });
    const result = await xaiOauthDisconnectRoute.handle(undefined, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ source: 'oauth-disconnect' }));
  });
});

// ---------------------------------------------------------------------------
// POST /api/xai/search
// ---------------------------------------------------------------------------

describe('xaiSearchRoute.parse', () => {
  it('rejects a non-object body and a missing/empty query', () => {
    expect(xaiSearchRoute.parse({ body: 'nope', query: {}, params: {} }).ok).toBe(false);
    expect(xaiSearchRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
    expect(xaiSearchRoute.parse({ body: { query: '   ' }, query: {}, params: {} }).ok).toBe(false);
  });

  // Every optional field gets its own rejection case: the parse is a straight-line sequence of
  // guards, so a missing case means one field silently accepts the wrong type.
  it.each([
    ['allowedXHandles', 'not-an-array'],
    ['excludedXHandles', [1, 2]],
    ['fromDate', 5],
    ['toDate', 5],
    ['enableImageUnderstanding', 'yes'],
    ['enableVideoUnderstanding', 'yes'],
    ['model', 7],
  ])('rejects a malformed %s', (field, value) => {
    expect(xaiSearchRoute.parse({ body: { query: 'q', [field]: value }, query: {}, params: {} }).ok).toBe(false);
  });

  it('trims incidental whitespace off query, matching OD real handler\'s server-side .trim() (routes/xai.ts:258)', () => {
    expect(xaiSearchRoute.parse({ body: { query: '  latest on grok  ' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { query: 'latest on grok' },
    });
  });

  it('accepts a bare query and the full set of optional fields', () => {
    expect(xaiSearchRoute.parse({ body: { query: 'latest on grok' }, query: {}, params: {} })).toEqual({ ok: true, value: { query: 'latest on grok' } });
    expect(
      xaiSearchRoute.parse({
        body: {
          query: 'q',
          allowedXHandles: ['xai'],
          excludedXHandles: ['spam'],
          fromDate: '2026-01-01',
          toDate: '2026-07-01',
          enableImageUnderstanding: true,
          enableVideoUnderstanding: false,
          model: 'grok-custom',
        },
        query: {},
        params: {},
      }),
    ).toEqual({
      ok: true,
      value: {
        query: 'q',
        allowedXHandles: ['xai'],
        excludedXHandles: ['spam'],
        fromDate: '2026-01-01',
        toDate: '2026-07-01',
        enableImageUnderstanding: true,
        enableVideoUnderstanding: false,
        model: 'grok-custom',
      },
    });
  });
});

describe('xaiSearchRoute.handle', () => {
  it('NOT_CONFIGURED (no fetch call) when no xAI account is connected', async () => {
    const fetchImpl = vi.fn();
    const result = await xaiSearchRoute.handle({ query: 'q' }, makeDeps({ fetchImpl }));
    expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'no xAI account connected — sign in via /api/xai/oauth/start first' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // `research.ts` in this same package carries an abort deadline through both `fetch` and body
  // consumption for exactly this failure mode; the xAI search path had none, so a stalled upstream
  // held the HTTP request, its socket and its handler open indefinitely. These model a real
  // `fetch`: the signal aborts the request *and* any body read already in flight.
  //
  // Aborting the request itself:
  it('aborts a search request that never responds, rather than hanging forever', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse({ access_token: 'atk-timeout' }))
      .mockImplementationOnce((_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolveNever, rejectOnAbort) => {
          init.signal?.addEventListener('abort', () => {
            rejectOnAbort(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
          });
        }),
      );
    const deps = makeDeps({ pending, fetchImpl, searchTimeoutMs: 25, onInternalError: vi.fn() });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);

    const result = await xaiSearchRoute.handle({ query: 'what is xAI' }, deps);

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // Aborting a body that stalls after the headers arrive — the case a deadline armed only around
  // `fetch` would miss entirely, since the response resolves promptly and only the read hangs.
  it('aborts a search whose response body never arrives', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    let bodySignal: AbortSignal | undefined;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse({ access_token: 'atk-body-timeout' }))
      .mockImplementationOnce(async (_url: string, init: { signal?: AbortSignal }) => {
        bodySignal = init.signal;
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: () =>
            new Promise((_resolveNever, rejectOnAbort) => {
              bodySignal?.addEventListener('abort', () => {
                rejectOnAbort(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
              });
            }),
        };
      });
    const deps = makeDeps({ pending, fetchImpl, searchTimeoutMs: 25, onInternalError: vi.fn() });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);

    const result = await xaiSearchRoute.handle({ query: 'what is xAI' }, deps);

    expect(result.ok).toBe(false);
    // The deadline must still have been armed when the body read began, not cleared at `fetch`'s
    // resolution — that is the whole distinction this test exists to draw.
    expect(bodySignal?.aborted).toBe(true);
  });

  it('happy path: calls the Responses API with the bearer token and the documented x_search tool shape', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const searchPayload = { output_text: 'Grok says hi.', output: [] };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse({ access_token: 'atk-search' }))
      .mockResolvedValueOnce(okSearchResponse(searchPayload));
    const deps = makeDeps({ pending, fetchImpl });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);

    const result = await xaiSearchRoute.handle({ query: 'what is xAI' }, deps);
    expect(result).toEqual({ ok: true, value: { answer: 'Grok says hi.', citations: [], model: 'grok-4.20-reasoning' } });

    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe('https://api.x.ai/v1/responses');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer atk-search');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: 'grok-4.20-reasoning',
      input: [{ role: 'user', content: 'what is xAI' }],
      tools: [{ type: 'x_search' }],
      store: false,
    });
  });

  it('translates the full optional field set to xAI\'s real snake_case tool payload and honors a custom model', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse())
      .mockResolvedValueOnce(okSearchResponse({ output_text: '' }));
    const deps = makeDeps({ pending, fetchImpl });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);

    await xaiSearchRoute.handle(
      {
        query: 'q',
        allowedXHandles: ['xai'],
        excludedXHandles: ['spam'],
        fromDate: '2026-01-01',
        toDate: '2026-07-01',
        enableImageUnderstanding: true,
        enableVideoUnderstanding: true,
        model: 'grok-custom',
      },
      deps,
    );
    const [, init] = fetchImpl.mock.calls[1]!;
    const body = JSON.parse(init.body);
    expect(body.model).toBe('grok-custom');
    expect(body.tools).toEqual([
      {
        type: 'x_search',
        allowed_x_handles: ['xai'],
        excluded_x_handles: ['spam'],
        from_date: '2026-01-01',
        to_date: '2026-07-01',
        enable_image_understanding: true,
        enable_video_understanding: true,
      },
    ]);
  });

  it('refreshes an expired token in place (via the same injected fetchImpl) before calling search', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi.fn().mockResolvedValueOnce(okTokenResponse({ access_token: 'atk-stale', expires_in: -1 }));
    const deps = makeDeps({ pending, fetchImpl });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);

    fetchImpl
      .mockResolvedValueOnce(okTokenResponse({ access_token: 'atk-fresh', expires_in: 3600 }))
      .mockResolvedValueOnce(okSearchResponse({ output_text: 'fresh answer' }));
    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toEqual({ ok: true, value: { answer: 'fresh answer', citations: [], model: 'grok-4.20-reasoning' } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [, searchInit] = fetchImpl.mock.calls[2]!;
    expect(searchInit.headers.authorization).toBe('Bearer atk-fresh');
  });

  it('extracts structured output[].content[].text and deduplicated url_citation annotations', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const payload = {
      output: [
        {
          content: [
            {
              text: 'first part.',
              annotations: [
                { type: 'url_citation', url: 'https://x.com/a' },
                { type: 'url_citation', url: 'https://x.com/a' },
                { type: 'other', url: 'https://x.com/ignored' },
              ],
            },
            { text: 'second part.' },
          ],
        },
      ],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse())
      .mockResolvedValueOnce(okSearchResponse(payload));
    const deps = makeDeps({ pending, fetchImpl });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toEqual({ ok: true, value: { answer: 'first part.\nsecond part.', citations: ['https://x.com/a'], model: 'grok-4.20-reasoning' } });
  });

  it('answers empty/no citations for a non-object or shapeless payload, without throwing', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse())
      .mockResolvedValueOnce(okSearchResponse('a bare string, not an object'));
    const deps = makeDeps({ pending, fetchImpl });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toEqual({ ok: true, value: { answer: '', citations: [], model: 'grok-4.20-reasoning' } });
  });

  /**
   * The Responses API payload is untrusted input, and both extractors walk it defensively. Each
   * malformed shape below must be skipped rather than throwing — a single bad `output` item must not
   * cost the caller the whole answer.
   */
  it('skips malformed output items, content blocks, and annotations while keeping the well-formed ones', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse())
      .mockResolvedValueOnce(
        okSearchResponse({
          output: [
            'not an object',
            { content: 'not an array' },
            {
              content: [
                'not an object',
                { text: 42 },
                { text: '' },
                {
                  text: 'kept text.',
                  annotations: [
                    'not an object',
                    { type: 'file_citation', url: 'https://ignored.example.com' },
                    { type: 'url_citation', url: 99 },
                    { type: 'url_citation', url: '   ' },
                    { type: 'url_citation', url: '  https://x.com/kept  ' },
                    { type: 'url_citation', url: 'https://x.com/kept' },
                  ],
                },
                { annotations: 'not an array' },
              ],
            },
          ],
        }),
      );
    const deps = makeDeps({ pending, fetchImpl });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    // Only the one usable text block survives, and the duplicate/blank/non-string citation URLs
    // collapse to a single trimmed entry.
    expect(result).toEqual({ ok: true, value: { answer: 'kept text.', citations: ['https://x.com/kept'], model: 'grok-4.20-reasoning' } });
  });

  it('reports an empty-bodied non-ok Responses API reply as "no body"', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => '' });
    const onInternalError = vi.fn();
    const deps = makeDeps({ pending, fetchImpl, onInternalError });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect((onInternalError.mock.calls[0]![0].error as Error).message).toBe('xAI 503: no body');
  });

  it('redacts a non-Error rejection from the search fetch without assuming it has a .message', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse())
      // A bare string rejection — real fetch polyfills and proxies do this.
      .mockRejectedValueOnce('socket hang up while sending Bearer atk-123');
    const onInternalError = vi.fn();
    const deps = makeDeps({ pending, fetchImpl, onInternalError });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);
    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const reported = onInternalError.mock.calls[0]![0].error as Error;
    expect(reported.message).toContain('xAI request failed: socket hang up');
    expect(reported.message).not.toContain('atk-123');
  });

  it('SEC-005: a non-ok Responses API response is reported to onInternalError and never leaks the bearer token', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse({ access_token: 'super-secret-token' }))
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Bearer super-secret-token invalid' });
    const onInternalError = vi.fn();
    const deps = makeDeps({ pending, fetchImpl, onInternalError });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);

    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain('super-secret-token');
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const reportedError = onInternalError.mock.calls[0]![0].error as Error;
    expect(reportedError.message).not.toContain('super-secret-token');
    expect(reportedError.message).toContain('[REDACTED]');
  });

  it('SEC-005: a network-level fetch rejection during search is also redacted and reported', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse({ access_token: 'super-secret-token' }))
      .mockRejectedValueOnce(new Error('ECONNRESET while talking to super-secret-token owner'));
    const onInternalError = vi.fn();
    const deps = makeDeps({ pending, fetchImpl, onInternalError });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);

    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    const reportedError = onInternalError.mock.calls[0]![0].error as Error;
    expect(reportedError.message).not.toContain('super-secret-token');
  });

  it('rejects a forbidden internal search base url (SSRF guard) without ever calling fetch for the search request', async () => {
    const pending = new PendingAuthCache(30 * 60 * 1000);
    const state = seedPendingState(pending);
    const fetchImpl = vi.fn().mockResolvedValueOnce(okTokenResponse());
    const deps = makeDeps({ pending, fetchImpl });
    await xaiOauthCompleteRoute.handle({ state, code: 'c1' }, deps);

    const forbiddenFetchImpl = vi.fn();
    const onInternalError = vi.fn();
    const deps2 = makeDeps({ ...deps, searchBaseUrl: 'http://169.254.169.254', fetchImpl: forbiddenFetchImpl, onInternalError });
    const result = await xaiSearchRoute.handle({ query: 'q' }, deps2);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(forbiddenFetchImpl).not.toHaveBeenCalled();
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('SEC-005: a throwing token resolver (real fs failure) is caught and reported as INTERNAL_ERROR', async () => {
    await mkdir(path.join(dataDir, 'xai-oauth-token.json'));
    const onInternalError = vi.fn();
    const deps = makeDeps({ onInternalError });
    const result = await xaiSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(onInternalError).toHaveBeenCalledWith(expect.objectContaining({ source: 'search' }));
  });
});

// ---------------------------------------------------------------------------
// registerXaiRoutes
// ---------------------------------------------------------------------------

describe('registerXaiRoutes', () => {
  it('mounts exactly the six xai routes', () => {
    const app = makeApp();
    registerXaiRoutes(app as any, { dataDir }, adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(
      [
        'GET /api/xai/auth/status',
        'POST /api/xai/oauth/cancel',
        'POST /api/xai/oauth/complete',
        'POST /api/xai/oauth/disconnect',
        'POST /api/xai/oauth/start',
        'POST /api/xai/search',
      ].sort(),
    );
  });

  it('requires same-origin: rejects a cross-origin oauth/start with 403 before opening any listener', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const startCallbackListener = vi.fn();
    const app = makeApp();
    registerXaiRoutes(app as any, { dataDir, startCallbackListener }, adapter);
    const res = makeRes();
    await app.handlers['POST /api/xai/oauth/start']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(startCallbackListener).not.toHaveBeenCalled();
  });

  it('requires same-origin: rejects a cross-origin auth/status GET with 403', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerXaiRoutes(app as any, { dataDir }, adapter);
    const res = makeRes();
    await app.handlers['GET /api/xai/auth/status']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requires same-origin: rejects a cross-origin search with 403 before any fetch', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const fetchImpl = vi.fn();
    const app = makeApp();
    registerXaiRoutes(app as any, { dataDir, fetchImpl } as unknown as XaiHttpDeps, adapter);
    const res = makeRes();
    await app.handlers['POST /api/xai/search']!({ body: { query: 'q' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shares one pending-auth cache and listener slot across mounted requests: start then complete succeeds end to end', async () => {
    const listener = makeListener();
    const startCallbackListener = vi.fn(async () => listener);
    const fetchImpl = vi.fn(async () => okTokenResponse());
    const app = makeApp();
    registerXaiRoutes(app as any, { dataDir, startCallbackListener, fetchImpl } as unknown as XaiHttpDeps, adapter);

    const startRes = makeRes();
    await app.handlers['POST /api/xai/oauth/start']!({ body: {}, query: {}, params: {} }, startRes);
    expect(startRes.status).toHaveBeenCalledWith(200);
    const state = startRes.json.mock.calls[0]![0].state as string;
    expect(typeof state).toBe('string');

    const completeRes = makeRes();
    await app.handlers['POST /api/xai/oauth/complete']!({ body: { state, code: 'browser-code' }, query: {}, params: {} }, completeRes);
    expect(completeRes.status).toHaveBeenCalledWith(200);
    expect(completeRes.json).toHaveBeenCalledWith({ ok: true });

    const statusRes = makeRes();
    await app.handlers['GET /api/xai/auth/status']!({ body: {}, query: {}, params: {} }, statusRes);
    expect(statusRes.json).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
  });

  it('a same-origin GET auth/status with nothing connected returns 200 with a not-connected body', async () => {
    const app = makeApp();
    registerXaiRoutes(app as any, { dataDir }, adapter);
    const res = makeRes();
    await app.handlers['GET /api/xai/auth/status']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ connected: false, expiresAt: null, scope: null, savedAt: null, listening: false });
  });
});

/**
 * Real Express app on a real socket, one genuine round-trip per mounted route. Everything above uses
 * a handler-capturing fake app, which cannot catch a path that fails to resolve, an Express-parsed
 * body the spec's `parse` reads differently, or a declared status that never reaches the wire. The
 * full OAuth handshake is driven here as one sequence, because the shared `pending`/`listenerRef`
 * state is exactly the thing a per-request mount would break.
 */
describe('registerXaiRoutes — real Express server on a real socket', () => {
  const servers: Server[] = [];
  const adapterRef = { resolvedPortRef: { current: 0 } };

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(deps: XaiHttpDeps): Promise<string> {
    const app = express();
    app.use(express.json());
    registerXaiRoutes(app as never, deps, adapterRef as never);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    adapterRef.resolvedPortRef.current = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${adapterRef.resolvedPortRef.current}`;
  }

  async function send(base: string, method: string, routePath: string, body?: unknown, origin = base) {
    const response = await fetch(`${base}${routePath}`, {
      method,
      headers: { 'content-type': 'application/json', origin },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it('drives the whole OAuth handshake over the wire: start -> complete -> status -> disconnect', async () => {
    const listener = makeListener();
    const base = await listen({
      dataDir,
      startCallbackListener: vi.fn(async () => listener),
      fetchImpl: vi.fn(async () => okTokenResponse()) as unknown as typeof fetch,
    });

    const started = await send(base, 'POST', '/api/xai/oauth/start');
    expect(started.status).toBe(200);
    expect(typeof started.body.authorizeUrl).toBe('string');
    expect(typeof started.body.state).toBe('string');

    const completed = await send(base, 'POST', '/api/xai/oauth/complete', { state: started.body.state, code: 'browser-code' });
    expect(completed).toEqual({ status: 200, body: { ok: true } });

    const status = await send(base, 'GET', '/api/xai/auth/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ connected: true, scope: 'openid api:access', listening: false });

    const disconnected = await send(base, 'POST', '/api/xai/oauth/disconnect');
    expect(disconnected).toEqual({ status: 200, body: { ok: true } });
    expect((await send(base, 'GET', '/api/xai/auth/status')).body).toMatchObject({ connected: false });
  });

  it('serves oauth/cancel over the wire, stopping the in-flight listener', async () => {
    const listener = makeListener();
    const base = await listen({ dataDir, startCallbackListener: vi.fn(async () => listener) });
    expect((await send(base, 'POST', '/api/xai/oauth/start')).status).toBe(200);
    expect(await send(base, 'POST', '/api/xai/oauth/cancel')).toEqual({ status: 200, body: { ok: true } });
    expect(listener.stop).toHaveBeenCalledTimes(1);
  });

  it('serves a real search round-trip once connected', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse())
      .mockResolvedValueOnce(okSearchResponse({ output_text: 'grok says hi' }));
    const base = await listen({
      dataDir,
      startCallbackListener: vi.fn(async () => makeListener()),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const started = await send(base, 'POST', '/api/xai/oauth/start');
    await send(base, 'POST', '/api/xai/oauth/complete', { state: started.body.state, code: 'c1' });

    const searched = await send(base, 'POST', '/api/xai/search', { query: 'latest on grok' });
    expect(searched.status).toBe(200);
    expect(searched.body).toMatchObject({ answer: 'grok says hi', citations: [] });
  });

  it('answers 503 over the wire for a search with no xAI account connected', async () => {
    const base = await listen({ dataDir });
    expect(await send(base, 'POST', '/api/xai/search', { query: 'q' })).toEqual({
      status: 503,
      body: { error: { code: 'NOT_CONFIGURED', message: 'no xAI account connected — sign in via /api/xai/oauth/start first' } },
    });
  });

  it('answers 400 over the wire for a malformed search body', async () => {
    const base = await listen({ dataDir });
    expect((await send(base, 'POST', '/api/xai/search', { query: '   ' })).status).toBe(400);
  });

  it('answers 403 over the wire for a cross-origin request', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const startCallbackListener = vi.fn();
    const base = await listen({ dataDir, startCallbackListener });
    const response = await send(base, 'POST', '/api/xai/oauth/start', undefined, 'http://evil.example.com');
    expect(response.status).toBe(403);
    expect(startCallbackListener).not.toHaveBeenCalled();
  });
});
