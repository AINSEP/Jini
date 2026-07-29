import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
