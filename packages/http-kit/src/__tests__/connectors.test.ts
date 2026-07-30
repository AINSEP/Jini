import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  type AuthCredentials,
  type AuthProvider,
  type AuthSession,
  type AuthUser,
  type Charge,
  type ChargeInput,
  connectorsAuthSessionRoute,
  connectorsAuthSignInRoute,
  connectorsAuthSignOutRoute,
  connectorsAuthSignUpRoute,
  connectorsDbDeleteRoute,
  connectorsDbGetRoute,
  connectorsDbInsertRoute,
  connectorsDbQueryRoute,
  connectorsDbUpdateRoute,
  connectorsPaymentsChargeRoute,
  connectorsPaymentsGetRoute,
  connectorsPaymentsRefundRoute,
  connectorsRealtimePublishRoute,
  connectorsStorageDeleteRoute,
  connectorsStorageGetRoute,
  connectorsStorageListRoute,
  connectorsStoragePutRoute,
  type DbProvider,
  type DbRecord,
  type PaymentsProvider,
  registerConnectorsRoutes,
  type RealtimeProvider,
  type StorageObjectMeta,
  type StorageProvider,
  type ConnectorsHttpDeps,
} from '../connectors.js';

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

const fakeUser: AuthUser = { id: 'u1', email: 'a@example.com', createdAt: 0 };
const fakeSession: AuthSession = { token: 'tok1', userId: 'u1', expiresAt: 0 };

function makeAuthProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    signUp: vi.fn(async (_c: AuthCredentials) => fakeUser),
    signIn: vi.fn(async (_c: AuthCredentials) => fakeSession),
    signOut: vi.fn(async (_t: string) => undefined),
    verifySession: vi.fn(async (_t: string) => fakeUser),
    ...overrides,
  };
}

const fakeMeta: StorageObjectMeta = { key: 'k1', size: 5, updatedAt: 0 };

function makeStorageProvider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    put: vi.fn(async () => fakeMeta),
    get: vi.fn(async () => new Uint8Array([1, 2, 3])),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => [fakeMeta]),
    ...overrides,
  };
}

const fakeCharge: Charge = { id: 'ch1', status: 'succeeded', amountCents: 500, currency: 'usd', customerRef: 'cus_1', createdAt: 0 };

function makePaymentsProvider(overrides: Partial<PaymentsProvider> = {}): PaymentsProvider {
  return {
    charge: vi.fn(async (_i: ChargeInput) => fakeCharge),
    getCharge: vi.fn(async () => fakeCharge),
    refund: vi.fn(async () => ({ ...fakeCharge, status: 'refunded' as const })),
    ...overrides,
  };
}

const fakeRecord: DbRecord = { id: 'r1', name: 'hello' };

function makeDbProvider(overrides: Partial<DbProvider> = {}): DbProvider {
  return {
    insert: vi.fn(async () => fakeRecord),
    get: vi.fn(async () => fakeRecord),
    update: vi.fn(async () => fakeRecord),
    delete: vi.fn(async () => undefined),
    query: vi.fn(async () => [fakeRecord]),
    ...overrides,
  };
}

function makeRealtimeProvider(overrides: Partial<RealtimeProvider> = {}): RealtimeProvider {
  return {
    publish: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ConnectorsHttpDeps> = {}): ConnectorsHttpDeps {
  return { ...overrides };
}

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

describe('auth routes', () => {
  it('signup: happy path calls signUp and wraps the result', async () => {
    const auth = makeAuthProvider();
    const result = await connectorsAuthSignUpRoute.handle({ email: 'a@example.com', password: 'secret' }, makeDeps({ auth }));
    expect(result).toEqual({ ok: true, value: { user: fakeUser } });
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'a@example.com', password: 'secret' });
  });

  it('signup: 503 NOT_CONFIGURED when auth is not supplied', async () => {
    const result = await connectorsAuthSignUpRoute.handle({ email: 'a@example.com', password: 'secret' }, makeDeps());
    expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'auth provider not configured' } });
  });

  it('signup: parse rejects a non-object body, missing email, and missing password', () => {
    expect(connectorsAuthSignUpRoute.parse({ body: 'nope', query: {}, params: {} }).ok).toBe(false);
    expect(connectorsAuthSignUpRoute.parse({ body: { password: 'x' }, query: {}, params: {} }).ok).toBe(false);
    expect(connectorsAuthSignUpRoute.parse({ body: { email: 'a@example.com' }, query: {}, params: {} }).ok).toBe(false);
  });

  it('signin: happy path returns a session', async () => {
    const auth = makeAuthProvider();
    const result = await connectorsAuthSignInRoute.handle({ email: 'a@example.com', password: 'secret' }, makeDeps({ auth }));
    expect(result).toEqual({ ok: true, value: { session: fakeSession } });
  });

  it('signout: happy path returns ok:true', async () => {
    const auth = makeAuthProvider();
    const result = await connectorsAuthSignOutRoute.handle('tok1', makeDeps({ auth }));
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(auth.signOut).toHaveBeenCalledWith('tok1');
  });

  it('signout: parse requires a non-empty token field', () => {
    expect(connectorsAuthSignOutRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
  });

  it('session: reads the token from the POST body and returns the resolved user', async () => {
    const auth = makeAuthProvider();
    const parsed = connectorsAuthSessionRoute.parse({ body: { token: 'tok1' }, query: {}, params: {} });
    expect(parsed).toEqual({ ok: true, value: 'tok1' });
    const result = await connectorsAuthSessionRoute.handle('tok1', makeDeps({ auth }));
    expect(result).toEqual({ ok: true, value: { user: fakeUser } });
  });

  it('session: returns user:null when verifySession resolves null (not an error)', async () => {
    const auth = makeAuthProvider({ verifySession: vi.fn(async () => null) });
    const result = await connectorsAuthSessionRoute.handle('bad-token', makeDeps({ auth }));
    expect(result).toEqual({ ok: true, value: { user: null } });
  });

  it('session: parse rejects a missing token body field', () => {
    expect(connectorsAuthSessionRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
    expect(connectorsAuthSessionRoute.parse({ body: {}, query: { token: 'must-not-be-read-from-url' }, params: {} }).ok).toBe(false);
  });

  it('auth: SEC-005 — a thrown error from the provider is redacted to a generic INTERNAL_ERROR and reported to onInternalError', async () => {
    const boom = new Error('jwt secret leaked: abc123');
    const auth = makeAuthProvider({ signIn: vi.fn(async () => { throw boom; }) });
    const onInternalError = vi.fn();
    const result = await connectorsAuthSignInRoute.handle({ email: 'a@example.com', password: 'x' }, makeDeps({ auth, onInternalError }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('an internal error occurred');
      expect(result.error.requestId).toBeDefined();
    }
    expect(onInternalError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'auth', operation: 'signIn', error: boom }),
    );
  });
});

describe('storage routes', () => {
  it('put: base64-decodes the body and forwards contentType', async () => {
    const storage = makeStorageProvider();
    const result = await connectorsStoragePutRoute.handle(
      { key: 'k1', dataBase64: Buffer.from('hello').toString('base64'), contentType: 'text/plain' },
      makeDeps({ storage }),
    );
    expect(result).toEqual({ ok: true, value: { object: fakeMeta } });
    expect(storage.put).toHaveBeenCalledWith('k1', Buffer.from('hello'), { contentType: 'text/plain' });
  });

  it('put: parse requires a non-empty dataBase64 field', () => {
    const parsed = connectorsStoragePutRoute.parse({ body: {}, query: {}, params: { key: 'k1' } });
    expect(parsed.ok).toBe(false);
  });

  it('get: base64-encodes the returned bytes', async () => {
    const storage = makeStorageProvider();
    const result = await connectorsStorageGetRoute.handle('k1', makeDeps({ storage }));
    expect(result).toEqual({ ok: true, value: { dataBase64: Buffer.from([1, 2, 3]).toString('base64') } });
  });

  it('get: 404 NOT_FOUND when the object does not exist', async () => {
    const storage = makeStorageProvider({ get: vi.fn(async () => null) });
    const result = await connectorsStorageGetRoute.handle('missing', makeDeps({ storage }));
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'storage object not found' } });
  });

  it('delete: happy path', async () => {
    const storage = makeStorageProvider();
    const result = await connectorsStorageDeleteRoute.handle('k1', makeDeps({ storage }));
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('list: forwards the optional prefix query param', async () => {
    const storage = makeStorageProvider();
    const parsed = connectorsStorageListRoute.parse({ body: {}, query: { prefix: 'images/' }, params: {} });
    expect(parsed).toEqual({ ok: true, value: 'images/' });
    await connectorsStorageListRoute.handle('images/', makeDeps({ storage }));
    expect(storage.list).toHaveBeenCalledWith('images/');
  });

  it('list: omitted prefix parses to undefined', () => {
    expect(connectorsStorageListRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });

  it('storage: 503 NOT_CONFIGURED on every route when storage is not supplied', async () => {
    expect(await connectorsStoragePutRoute.handle({ key: 'k', dataBase64: 'aGk=' }, makeDeps())).toEqual({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'storage provider not configured' },
    });
    expect(await connectorsStorageGetRoute.handle('k', makeDeps())).toEqual({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'storage provider not configured' },
    });
    expect(await connectorsStorageDeleteRoute.handle('k', makeDeps())).toEqual({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'storage provider not configured' },
    });
    expect(await connectorsStorageListRoute.handle(undefined, makeDeps())).toEqual({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'storage provider not configured' },
    });
  });
});

describe('payments routes', () => {
  it('charge: happy path', async () => {
    const payments = makePaymentsProvider();
    const input: ChargeInput = { amountCents: 500, currency: 'usd', customerRef: 'cus_1' };
    const result = await connectorsPaymentsChargeRoute.handle(input, makeDeps({ payments }));
    expect(result).toEqual({ ok: true, value: { charge: fakeCharge } });
  });

  it('charge: parse rejects a non-positive/missing amountCents, currency, customerRef', () => {
    expect(connectorsPaymentsChargeRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
    expect(
      connectorsPaymentsChargeRoute.parse({ body: { amountCents: 'nope', currency: 'usd', customerRef: 'c1' }, query: {}, params: {} }).ok,
    ).toBe(false);
    expect(
      connectorsPaymentsChargeRoute.parse({ body: { amountCents: 100, customerRef: 'c1' }, query: {}, params: {} }).ok,
    ).toBe(false);
  });

  it('get: 404 when unknown', async () => {
    const payments = makePaymentsProvider({ getCharge: vi.fn(async () => null) });
    const result = await connectorsPaymentsGetRoute.handle('missing', makeDeps({ payments }));
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'charge not found' } });
  });

  it('refund: happy path', async () => {
    const payments = makePaymentsProvider();
    const result = await connectorsPaymentsRefundRoute.handle('ch1', makeDeps({ payments }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.charge.status).toBe('refunded');
  });

  it('payments: 503 NOT_CONFIGURED when payments is not supplied', async () => {
    const result = await connectorsPaymentsChargeRoute.handle(
      { amountCents: 100, currency: 'usd', customerRef: 'c1' },
      makeDeps(),
    );
    expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'payments provider not configured' } });
  });

  it('payments: SEC-005 — a thrown Stripe-shaped error never reaches the caller verbatim', async () => {
    const payments = makePaymentsProvider({
      charge: vi.fn(async () => {
        throw new Error('Stripe error: sk_live_abcdef rejected');
      }),
    });
    const onInternalError = vi.fn();
    const result = await connectorsPaymentsChargeRoute.handle(
      { amountCents: 100, currency: 'usd', customerRef: 'c1' },
      makeDeps({ payments, onInternalError }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('an internal error occurred');
      expect(JSON.stringify(result.error)).not.toContain('sk_live_abcdef');
    }
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });
});

describe('db routes', () => {
  it('insert: requires a non-empty id field and forwards the whole body as the record', async () => {
    const db = makeDbProvider();
    const parsed = connectorsDbInsertRoute.parse({ body: { id: 'r1', name: 'hello' }, query: {}, params: { collection: 'notes' } });
    expect(parsed).toEqual({ ok: true, value: { collection: 'notes', record: { id: 'r1', name: 'hello' } } });
    const result = await connectorsDbInsertRoute.handle({ collection: 'notes', record: fakeRecord }, makeDeps({ db }));
    expect(result).toEqual({ ok: true, value: { record: fakeRecord } });
  });

  it('insert: parse rejects a missing id', () => {
    expect(connectorsDbInsertRoute.parse({ body: { name: 'x' }, query: {}, params: { collection: 'notes' } }).ok).toBe(false);
  });

  it('get: 404 when unknown', async () => {
    const db = makeDbProvider({ get: vi.fn(async () => null) });
    const result = await connectorsDbGetRoute.handle({ collection: 'notes', id: 'missing' }, makeDeps({ db }));
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'record not found' } });
  });

  it('update: 404 when unknown, 200 with the patched record otherwise', async () => {
    const db = makeDbProvider({ update: vi.fn(async () => null) });
    const notFound = await connectorsDbUpdateRoute.handle({ collection: 'notes', id: 'missing', patch: { x: 1 } }, makeDeps({ db }));
    expect(notFound).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'record not found' } });

    const db2 = makeDbProvider();
    const result = await connectorsDbUpdateRoute.handle({ collection: 'notes', id: 'r1', patch: { name: 'updated' } }, makeDeps({ db: db2 }));
    expect(result).toEqual({ ok: true, value: { record: fakeRecord } });
  });

  it('delete: happy path', async () => {
    const db = makeDbProvider();
    const result = await connectorsDbDeleteRoute.handle({ collection: 'notes', id: 'r1' }, makeDeps({ db }));
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('query: decodes a JSON-encoded ?where= query parameter', () => {
    const parsed = connectorsDbQueryRoute.parse({ body: {}, query: { where: '{"status":"active"}' }, params: { collection: 'notes' } });
    expect(parsed).toEqual({ ok: true, value: { collection: 'notes', query: { where: { status: 'active' } } } });
  });

  it('query: omitted where parses to no query filter', () => {
    expect(connectorsDbQueryRoute.parse({ body: {}, query: {}, params: { collection: 'notes' } })).toEqual({
      ok: true,
      value: { collection: 'notes' },
    });
  });

  it('query: rejects invalid JSON and a non-object where', () => {
    expect(connectorsDbQueryRoute.parse({ body: {}, query: { where: 'not-json' }, params: { collection: 'notes' } }).ok).toBe(false);
    expect(connectorsDbQueryRoute.parse({ body: {}, query: { where: '[1,2,3]' }, params: { collection: 'notes' } }).ok).toBe(false);
  });

  it('query: happy path forwards the query to the provider', async () => {
    const db = makeDbProvider();
    const result = await connectorsDbQueryRoute.handle({ collection: 'notes', query: { where: { status: 'active' } } }, makeDeps({ db }));
    expect(result).toEqual({ ok: true, value: { records: [fakeRecord] } });
    expect(db.query).toHaveBeenCalledWith('notes', { where: { status: 'active' } });
  });

  it('db: 503 NOT_CONFIGURED on every route when db is not supplied', async () => {
    expect(await connectorsDbInsertRoute.handle({ collection: 'c', record: fakeRecord }, makeDeps())).toEqual({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'db provider not configured' },
    });
    expect(await connectorsDbGetRoute.handle({ collection: 'c', id: 'r1' }, makeDeps())).toEqual({
      ok: false,
      error: { code: 'NOT_CONFIGURED', message: 'db provider not configured' },
    });
  });
});

describe('realtime routes', () => {
  it('publish: happy path forwards channel and event', async () => {
    const realtime = makeRealtimeProvider();
    const result = await connectorsRealtimePublishRoute.handle({ channel: 'room1', event: { type: 'ping' } }, makeDeps({ realtime }));
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(realtime.publish).toHaveBeenCalledWith('room1', { type: 'ping' });
  });

  it('publish: parse requires an event field in the body', () => {
    expect(connectorsRealtimePublishRoute.parse({ body: {}, query: {}, params: { channel: 'room1' } }).ok).toBe(false);
  });

  it('publish: parse requires a non-empty channel path param', () => {
    expect(connectorsRealtimePublishRoute.parse({ body: { event: {} }, query: {}, params: {} }).ok).toBe(false);
  });

  it('publish: 503 NOT_CONFIGURED when realtime is not supplied', async () => {
    const result = await connectorsRealtimePublishRoute.handle({ channel: 'room1', event: {} }, makeDeps());
    expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'realtime provider not configured' } });
  });
});

describe('registerConnectorsRoutes', () => {
  it('mounts every connectors route (auth x4, storage x4, payments x3, db x5, realtime x1 = 17)', () => {
    const app = makeApp();
    registerConnectorsRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers)).toHaveLength(17);
    expect(app.handlers['PUT /api/connectors/storage/:key']).toBeDefined();
    expect(app.handlers['GET /api/connectors/db/:collection']).toBeDefined();
    expect(app.handlers['GET /api/connectors/db/:collection/:id']).toBeDefined();
    expect(app.handlers['POST /api/connectors/realtime/:channel/publish']).toBeDefined();
  });

  it('credential-bearing and mutating routes enforce same-origin; GET routes do not gate on it', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerConnectorsRoutes(app as any, makeDeps({ auth: makeAuthProvider() }), adapter);

    const res = makeRes();
    await app.handlers['POST /api/connectors/auth/signup']!({ body: { email: 'a@example.com', password: 'x' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);

    const sessionRes = makeRes();
    await app.handlers['POST /api/connectors/auth/session']!({ body: { token: 't' }, query: {}, params: {} }, sessionRes);
    expect(sessionRes.status).toHaveBeenCalledWith(403);
  });

  it('zero-config default (all five slots unconfigured) still responds 503, not a crash, for a real mounted request', async () => {
    const app = makeApp();
    registerConnectorsRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['POST /api/connectors/auth/session']!({ body: { token: 't' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_CONFIGURED', message: 'auth provider not configured' } });
  });

  // SEC-005's default sink. Every other guardedCall test injects `onInternalError`, so the
  // console.error fallback a host gets by default was never exercised — and it is the only thing
  // standing between a swallowed provider exception and a silent failure in production.
  it('falls back to console.error when a provider throws and no onInternalError sink is supplied', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const auth = makeAuthProvider({ signIn: vi.fn(async () => { throw new Error('db down'); }) });
    const result = await connectorsAuthSignInRoute.handle({ email: 'a@example.com', password: 'x' }, makeDeps({ auth }));
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]![0]).toContain('internal error (connectors/auth.signIn, correlationId=');
    consoleErrorSpy.mockRestore();
  });
});

/**
 * Two contracts every one of the 17 routes owes its caller, checked exhaustively rather than on the
 * two or three routes that happened to get a bespoke test:
 *
 * 1. **SEC-005** — a provider exception becomes a generic `INTERNAL_ERROR` with a correlation id, and
 *    the thrown message (which routinely carries a live credential) never reaches the caller.
 * 2. **Fail closed** — an unconfigured provider slot answers `NOT_CONFIGURED`, never a crash and
 *    never a silent success.
 *
 * A per-route table is the only honest way to state "every route", and it makes a newly added route
 * with a missing guard show up as a failing case instead of a silent coverage dip.
 */
const ROUTE_MATRIX = [
  { label: 'auth signup', route: connectorsAuthSignUpRoute, input: { email: 'a@example.com', password: 'x' }, slot: 'auth', method: 'signUp', capability: 'auth' },
  { label: 'auth signin', route: connectorsAuthSignInRoute, input: { email: 'a@example.com', password: 'x' }, slot: 'auth', method: 'signIn', capability: 'auth' },
  { label: 'auth signout', route: connectorsAuthSignOutRoute, input: 'tok1', slot: 'auth', method: 'signOut', capability: 'auth' },
  { label: 'auth session', route: connectorsAuthSessionRoute, input: 'tok1', slot: 'auth', method: 'verifySession', capability: 'auth' },
  { label: 'storage put', route: connectorsStoragePutRoute, input: { key: 'k1', dataBase64: 'aGk=' }, slot: 'storage', method: 'put', capability: 'storage' },
  { label: 'storage get', route: connectorsStorageGetRoute, input: 'k1', slot: 'storage', method: 'get', capability: 'storage' },
  { label: 'storage delete', route: connectorsStorageDeleteRoute, input: 'k1', slot: 'storage', method: 'delete', capability: 'storage' },
  { label: 'storage list', route: connectorsStorageListRoute, input: undefined, slot: 'storage', method: 'list', capability: 'storage' },
  { label: 'payments charge', route: connectorsPaymentsChargeRoute, input: { amountCents: 100, currency: 'usd', customerRef: 'c1' }, slot: 'payments', method: 'charge', capability: 'payments' },
  { label: 'payments get', route: connectorsPaymentsGetRoute, input: 'ch1', slot: 'payments', method: 'getCharge', capability: 'payments' },
  { label: 'payments refund', route: connectorsPaymentsRefundRoute, input: 'ch1', slot: 'payments', method: 'refund', capability: 'payments' },
  { label: 'db insert', route: connectorsDbInsertRoute, input: { collection: 'notes', record: fakeRecord }, slot: 'db', method: 'insert', capability: 'db' },
  { label: 'db get', route: connectorsDbGetRoute, input: { collection: 'notes', id: 'r1' }, slot: 'db', method: 'get', capability: 'db' },
  { label: 'db update', route: connectorsDbUpdateRoute, input: { collection: 'notes', id: 'r1', patch: { a: 1 } }, slot: 'db', method: 'update', capability: 'db' },
  { label: 'db delete', route: connectorsDbDeleteRoute, input: { collection: 'notes', id: 'r1' }, slot: 'db', method: 'delete', capability: 'db' },
  { label: 'db query', route: connectorsDbQueryRoute, input: { collection: 'notes' }, slot: 'db', method: 'query', capability: 'db' },
  { label: 'realtime publish', route: connectorsRealtimePublishRoute, input: { channel: 'room1', event: {} }, slot: 'realtime', method: 'publish', capability: 'realtime' },
] as const;

const PROVIDER_FACTORIES = {
  auth: makeAuthProvider,
  storage: makeStorageProvider,
  payments: makePaymentsProvider,
  db: makeDbProvider,
  realtime: makeRealtimeProvider,
} as const;

describe('every connectors route', () => {
  it.each(ROUTE_MATRIX.map((entry) => [entry.label, entry] as const))(
    '%s: SEC-005 — redacts a thrown provider error behind a correlation id',
    async (_label, entry) => {
      const secret = 'live-credential-must-not-leak';
      const provider = PROVIDER_FACTORIES[entry.slot]({
        [entry.method]: vi.fn(async () => { throw new Error(`provider blew up: ${secret}`); }),
      } as never);
      const onInternalError = vi.fn();
      const result = await entry.route.handle(entry.input as never, makeDeps({ [entry.slot]: provider, onInternalError }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('an internal error occurred');
        expect(result.error.requestId).toBeDefined();
        expect(JSON.stringify(result.error)).not.toContain(secret);
      }
      expect(onInternalError).toHaveBeenCalledWith(
        expect.objectContaining({ source: entry.slot, operation: entry.method }),
      );
    },
  );

  it.each(ROUTE_MATRIX.map((entry) => [entry.label, entry] as const))(
    '%s: fails closed with NOT_CONFIGURED when its provider slot is empty',
    async (_label, entry) => {
      const result = await entry.route.handle(entry.input as never, makeDeps());
      expect(result).toEqual({
        ok: false,
        error: { code: 'NOT_CONFIGURED', message: `${entry.capability} provider not configured` },
      });
    },
  );
});

/**
 * The path-parameter parsers reject a missing/blank segment. Express itself will not route a URL with
 * an empty segment to these handlers, so these cases are only reachable by calling `parse` directly —
 * but the guards are the reason a caller that mounts these specs on its own router (which
 * `defineJsonRoute` explicitly supports) cannot end up passing `undefined` through to a provider.
 */
describe('path-parameter parsers reject a missing segment', () => {
  it.each([
    ['payments get (charge id)', connectorsPaymentsGetRoute],
    ['payments refund (charge id)', connectorsPaymentsRefundRoute],
    ['db get (collection + id)', connectorsDbGetRoute],
    ['db delete (collection + id)', connectorsDbDeleteRoute],
    ['db update (collection + id)', connectorsDbUpdateRoute],
    ['db query (collection)', connectorsDbQueryRoute],
    ['db insert (collection)', connectorsDbInsertRoute],
    ['storage get (key)', connectorsStorageGetRoute],
  ])('%s rejects empty params', (_label, route) => {
    expect(route.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
  });

  it('db routes reject a present collection but a missing id', () => {
    expect(connectorsDbGetRoute.parse({ body: {}, query: {}, params: { collection: 'notes' } }).ok).toBe(false);
    expect(connectorsDbUpdateRoute.parse({ body: {}, query: {}, params: { collection: 'notes' } }).ok).toBe(false);
    expect(connectorsDbDeleteRoute.parse({ body: {}, query: {}, params: { collection: 'notes' } }).ok).toBe(false);
  });

  it('db update rejects a non-object patch body once the params are valid', () => {
    expect(connectorsDbUpdateRoute.parse({ body: 'nope', query: {}, params: { collection: 'notes', id: 'r1' } }).ok).toBe(false);
  });

  it('db update accepts the whole body as the patch', () => {
    expect(connectorsDbUpdateRoute.parse({ body: { name: 'updated' }, query: {}, params: { collection: 'notes', id: 'r1' } })).toEqual({
      ok: true,
      value: { collection: 'notes', id: 'r1', patch: { name: 'updated' } },
    });
  });

  it('storage put rejects a non-string contentType and accepts a string one', () => {
    expect(
      connectorsStoragePutRoute.parse({ body: { dataBase64: 'aGk=', contentType: 42 }, query: {}, params: { key: 'k1' } }).ok,
    ).toBe(false);
    expect(
      connectorsStoragePutRoute.parse({ body: { dataBase64: 'aGk=', contentType: 'text/plain' }, query: {}, params: { key: 'k1' } }),
    ).toEqual({ ok: true, value: { key: 'k1', dataBase64: 'aGk=', contentType: 'text/plain' } });
  });

  it('storage put rejects a non-object body once the key is valid', () => {
    expect(connectorsStoragePutRoute.parse({ body: 'nope', query: {}, params: { key: 'k1' } }).ok).toBe(false);
  });

  it('payments charge rejects a non-string description and accepts a string one', () => {
    expect(
      connectorsPaymentsChargeRoute.parse({ body: { amountCents: 100, currency: 'usd', customerRef: 'c1', description: 9 }, query: {}, params: {} }).ok,
    ).toBe(false);
    expect(
      connectorsPaymentsChargeRoute.parse({ body: { amountCents: 100, currency: 'usd', customerRef: 'c1', description: 'tip' }, query: {}, params: {} }),
    ).toEqual({ ok: true, value: { amountCents: 100, currency: 'usd', customerRef: 'c1', description: 'tip' } });
  });

  it('db insert rejects a non-object body once the collection is valid', () => {
    expect(connectorsDbInsertRoute.parse({ body: 'nope', query: {}, params: { collection: 'notes' } }).ok).toBe(false);
  });

  it('storage put rejects a missing key before it looks at the body', () => {
    expect(connectorsStoragePutRoute.parse({ body: { dataBase64: 'aGk=' }, query: {}, params: {} })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'key must be a non-empty path parameter' },
    });
  });

  it('storage put omits contentType entirely when it is not supplied, rather than sending undefined', () => {
    expect(connectorsStoragePutRoute.parse({ body: { dataBase64: 'aGk=' }, query: {}, params: { key: 'k1' } })).toEqual({
      ok: true,
      value: { key: 'k1', dataBase64: 'aGk=' },
    });
  });

  it('storage put forwards no options object at all when contentType is absent', async () => {
    const storage = makeStorageProvider();
    await connectorsStoragePutRoute.handle({ key: 'k1', dataBase64: 'aGk=' }, makeDeps({ storage }));
    expect(storage.put).toHaveBeenCalledWith('k1', Buffer.from('aGk=', 'base64'), undefined);
  });

  it('auth signout/session reject a non-object body', () => {
    expect(connectorsAuthSignOutRoute.parse({ body: 'nope', query: {}, params: {} })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' },
    });
    expect(connectorsAuthSessionRoute.parse({ body: 42, query: {}, params: {} }).ok).toBe(false);
  });

  it('payments charge rejects a non-object body and a missing customerRef', () => {
    expect(connectorsPaymentsChargeRoute.parse({ body: 'nope', query: {}, params: {} })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' },
    });
    expect(connectorsPaymentsChargeRoute.parse({ body: { amountCents: 100, currency: 'usd' }, query: {}, params: {} })).toEqual({
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'customerRef must be a non-empty string',
        details: { kind: 'validation', issues: [{ path: 'customerRef', message: 'required non-empty string' }] },
      },
    });
  });

  // Express parses a repeated query key into an array. The first value wins — a caller cannot smuggle
  // a second `prefix` past the guard by repeating the parameter.
  it('storage list reads only the first value of a repeated prefix query parameter', () => {
    expect(connectorsStorageListRoute.parse({ body: {}, query: { prefix: ['images/', 'videos/'] }, params: {} })).toEqual({
      ok: true,
      value: 'images/',
    });
  });

  it('storage list ignores a non-string prefix value', () => {
    expect(connectorsStorageListRoute.parse({ body: {}, query: { prefix: 42 }, params: {} })).toEqual({ ok: true, value: undefined });
  });
});

/**
 * Real Express app on a real socket, one genuine HTTP round-trip per mounted route. This is the only
 * place the connectors pack is exercised as a *server* rather than as a bag of handler functions:
 * it proves the paths actually resolve (including the two overlapping `/db/:collection` shapes and
 * the three same-path/different-verb storage routes), that Express's own body parsing and param
 * extraction feed the specs' `parse` steps the shape they expect, and that each route's declared
 * success status reaches the wire.
 */
describe('registerConnectorsRoutes — real Express server on a real socket', () => {
  const servers: Server[] = [];
  const adapterRef = { resolvedPortRef: { current: 0 } };

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(deps: ConnectorsHttpDeps): Promise<string> {
    const app = express();
    app.use(express.json());
    registerConnectorsRoutes(app as never, deps, adapterRef as never);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    adapterRef.resolvedPortRef.current = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${adapterRef.resolvedPortRef.current}`;
  }

  function fullyConfigured() {
    return {
      auth: makeAuthProvider(),
      storage: makeStorageProvider(),
      payments: makePaymentsProvider(),
      db: makeDbProvider(),
      realtime: makeRealtimeProvider(),
    };
  }

  async function send(base: string, method: string, path: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  it('serves all four auth routes end to end, with signup answering 201', async () => {
    const deps = fullyConfigured();
    const base = await listen(deps);
    const credentials = { email: 'a@example.com', password: 'secret' };

    expect(await send(base, 'POST', '/api/connectors/auth/signup', credentials)).toEqual({ status: 201, body: { user: fakeUser } });
    expect(deps.auth.signUp).toHaveBeenCalledWith(credentials);

    expect(await send(base, 'POST', '/api/connectors/auth/signin', credentials)).toEqual({ status: 200, body: { session: fakeSession } });
    expect(await send(base, 'POST', '/api/connectors/auth/signout', { token: 'tok1' })).toEqual({ status: 200, body: { ok: true } });
    expect(await send(base, 'POST', '/api/connectors/auth/session', { token: 'tok1' })).toEqual({ status: 200, body: { user: fakeUser } });
  });

  it('serves all four storage routes end to end, distinguishing PUT/GET/DELETE on the same path from the list route', async () => {
    const deps = fullyConfigured();
    const base = await listen(deps);

    const put = await send(base, 'PUT', '/api/connectors/storage/k1', {
      dataBase64: Buffer.from('hello').toString('base64'),
      contentType: 'text/plain',
    });
    expect(put).toEqual({ status: 200, body: { object: fakeMeta } });
    expect(deps.storage.put).toHaveBeenCalledWith('k1', Buffer.from('hello'), { contentType: 'text/plain' });

    expect(await send(base, 'GET', '/api/connectors/storage/k1')).toEqual({
      status: 200,
      body: { dataBase64: Buffer.from([1, 2, 3]).toString('base64') },
    });
    expect(await send(base, 'GET', '/api/connectors/storage?prefix=images/')).toEqual({ status: 200, body: { objects: [fakeMeta] } });
    expect(deps.storage.list).toHaveBeenCalledWith('images/');
    expect(await send(base, 'DELETE', '/api/connectors/storage/k1')).toEqual({ status: 200, body: { ok: true } });
  });

  it('serves all three payments routes end to end, with charge answering 201', async () => {
    const deps = fullyConfigured();
    const base = await listen(deps);

    const charge = await send(base, 'POST', '/api/connectors/payments/charge', { amountCents: 500, currency: 'usd', customerRef: 'cus_1' });
    expect(charge).toEqual({ status: 201, body: { charge: fakeCharge } });

    // The GET-by-id happy path, previously only ever driven through its 404 arm.
    expect(await send(base, 'GET', '/api/connectors/payments/ch1')).toEqual({ status: 200, body: { charge: fakeCharge } });
    expect(deps.payments.getCharge).toHaveBeenCalledWith('ch1');

    const refund = await send(base, 'POST', '/api/connectors/payments/ch1/refund');
    expect(refund.status).toBe(200);
    expect((refund.body as { charge: { status: string } }).charge.status).toBe('refunded');
  });

  it('serves all five db routes end to end, resolving /db/:collection and /db/:collection/:id correctly', async () => {
    const deps = fullyConfigured();
    const base = await listen(deps);

    expect(await send(base, 'POST', '/api/connectors/db/notes', { id: 'r1', name: 'hello' })).toEqual({
      status: 201,
      body: { record: fakeRecord },
    });
    expect(deps.db.insert).toHaveBeenCalledWith('notes', { id: 'r1', name: 'hello' });

    // The GET-by-id happy path, previously only ever driven through its 404 arm.
    expect(await send(base, 'GET', '/api/connectors/db/notes/r1')).toEqual({ status: 200, body: { record: fakeRecord } });
    expect(deps.db.get).toHaveBeenCalledWith('notes', 'r1');

    expect(await send(base, 'PATCH', '/api/connectors/db/notes/r1', { name: 'updated' })).toEqual({
      status: 200,
      body: { record: fakeRecord },
    });
    expect(deps.db.update).toHaveBeenCalledWith('notes', 'r1', { name: 'updated' });

    // One fewer path segment must reach the query route, not the by-id route.
    expect(await send(base, 'GET', '/api/connectors/db/notes?where=%7B%22status%22%3A%22active%22%7D')).toEqual({
      status: 200,
      body: { records: [fakeRecord] },
    });
    expect(deps.db.query).toHaveBeenCalledWith('notes', { where: { status: 'active' } });

    expect(await send(base, 'DELETE', '/api/connectors/db/notes/r1')).toEqual({ status: 200, body: { ok: true } });
  });

  it('serves the realtime publish route end to end', async () => {
    const deps = fullyConfigured();
    const base = await listen(deps);
    expect(await send(base, 'POST', '/api/connectors/realtime/room1/publish', { event: { type: 'ping' } })).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(deps.realtime.publish).toHaveBeenCalledWith('room1', { type: 'ping' });
  });

  it('answers 404 over the wire for a missing storage object and a missing db record', async () => {
    const base = await listen({
      storage: makeStorageProvider({ get: vi.fn(async () => null) }),
      db: makeDbProvider({ get: vi.fn(async () => null) }),
    });
    expect(await send(base, 'GET', '/api/connectors/storage/missing')).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'storage object not found' } },
    });
    expect(await send(base, 'GET', '/api/connectors/db/notes/missing')).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'record not found' } },
    });
  });

  it('answers 503 over the wire for an unconfigured provider slot', async () => {
    const base = await listen({});
    expect(await send(base, 'POST', '/api/connectors/auth/signin', { email: 'a@example.com', password: 'x' })).toEqual({
      status: 503,
      body: { error: { code: 'NOT_CONFIGURED', message: 'auth provider not configured' } },
    });
  });

  it('answers 400 over the wire for a malformed body', async () => {
    const base = await listen(fullyConfigured());
    const response = await send(base, 'POST', '/api/connectors/auth/signup', { email: 'a@example.com' });
    expect(response.status).toBe(400);
  });

  it('rejects a cross-origin mutating request with 403 before reaching the provider', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const deps = fullyConfigured();
    const base = await listen(deps);
    const response = await fetch(`${base}/api/connectors/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example.com' },
      body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
    });
    expect(response.status).toBe(403);
    expect(deps.auth.signUp).not.toHaveBeenCalled();
  });
});
