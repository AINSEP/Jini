import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Express, Request, Response } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { ClientFacingError, defineJsonRoute, mountJsonRoute, type AdapterContext } from '../adapter.js';
import { err, ok, type JsonRouteSpec } from '../types.js';

type Spec = JsonRouteSpec<string, string, { tag: string }, { id: string }>;
type Mounted = (req: Request, res: Response) => Promise<void>;

function fixture({ spec }: { readonly spec: Spec }, { adapter, closable = true, origin = 'http://localhost:7456' }: {
  readonly adapter?: AdapterContext | undefined;
  readonly closable?: boolean;
  readonly origin?: string;
} = {}) {
  let mounted!: Mounted;
  const post = vi.fn((_path: string, handler: Mounted) => { mounted = handler; });
  const app = { post } as unknown as Express;
  const events = new EventEmitter();
  const status = vi.fn<(code: number) => Response>();
  const json = vi.fn<(body: unknown) => Response>();
  const response = { status, json };
  const res = Object.assign(response, closable ? {
    on: events.on.bind(events), off: events.off.bind(events),
  } : {}) as unknown as Response;
  status.mockReturnValue(res);
  json.mockReturnValue(res);
  const req: Partial<Request> = {
    body: 'body', query: { key: 'value' }, params: { id: 'target' },
    headers: { host: 'localhost:7456', origin },
  };
  const deps = { tag: 'injected' };
  mountJsonRoute({ app, spec, deps, ...(adapter === undefined ? {} : { adapter }) });
  return { run: () => mounted(req as Request, res), events, status, json, post, deps, res };
}

function route({ handle = () => ok({ value: 'response' }) }: { readonly handle?: Spec['handle'] }, options: Partial<Spec> = {}): Spec {
  return { method: 'post', path: '/pin', parse: () => ok({ value: 'parsed' }), handle, ...options };
}

const originContext: AdapterContext = {
  env: {}, allowedOriginsEnvVar: 'PIN_ALLOWED_ORIGINS', webPortEnvVar: 'PIN_WEB_PORT',
  bindHostEnvVar: 'PIN_BIND_HOST', resolvedPortRef: { current: 7456 },
};

afterEach(() => { vi.restoreAllMocks(); });

describe('adapter characterization before complexity refactor', () => {
  it('creates a fresh route spec with optional settings taking precedence and no input mutation', () => {
    const required = route({}, { successStatus: 202, requireSameOrigin: true });
    const optional = { successStatus: 201, requireSameOrigin: false };
    const spec = defineJsonRoute(required, optional);
    expect(spec).toEqual({ ...required, successStatus: 201, requireSameOrigin: false });
    expect(spec).not.toBe(required);
    expect(required.successStatus).toBe(202);
    expect(required.requireSameOrigin).toBe(true);
    expect(optional).toEqual({ successStatus: 201, requireSameOrigin: false });
    expect(defineJsonRoute(required)).toEqual(required);
    expect(defineJsonRoute(required)).not.toBe(required);
  });

  it.each([true, false])('supports a response with close listeners: %s', async (closable) => {
    const f = fixture({ spec: route({}) }, { closable });
    expect(f.post).toHaveBeenCalledWith('/pin', expect.any(Function));
    await f.run();
    expect(f.status.mock.calls).toEqual([[200]]);
    expect(f.json.mock.calls).toEqual([['response']]);
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it('runs workspace, origin, authentication, parsing and route-selected authorization in order', async () => {
    const seen: string[] = [];
    const authorize = vi.fn<NonNullable<NonNullable<Spec['ports']>['authorize']>>(() => { seen.push('authorize'); });
    const spec = route({ handle: async ({ input, deps, context, authorize: authorizeRoute }, { signal } = {}) => {
      seen.push('handle');
      expect({ input, deps, context }).toEqual({ input: 'parsed', deps: { tag: 'injected' }, context: { id: 'caller' } });
      expect(signal?.aborted).toBe(false);
      await authorizeRoute!({ permission: 'write', entityType: 'setting' });
      return ok({ value: 'created' });
    } }, {
      requireSameOrigin: true, successStatus: 201,
      parse: (raw) => { seen.push('parse'); expect(raw).toEqual({ body: 'body', query: { key: 'value' }, params: { id: 'target' } }); return ok({ value: 'parsed' }); },
      ports: {
        workspace: ({ raw, deps }) => { seen.push('workspace'); expect({ raw, deps }).toEqual({ raw: { body: 'body', query: { key: 'value' }, params: { id: 'target' } }, deps: { tag: 'injected' } }); },
        authenticate: () => { seen.push('authenticate'); return { id: 'caller' }; }, authorize,
      },
    });
    const f = fixture({ spec }, { adapter: originContext });
    await f.run();
    expect(seen).toEqual(['workspace', 'authenticate', 'parse', 'handle', 'authorize']);
    expect(authorize.mock.calls).toEqual([[{ context: { id: 'caller' }, deps: f.deps, permission: 'write', entityType: 'setting' }]]);
    expect(f.status.mock.calls).toEqual([[201]]);
    expect(f.json.mock.calls).toEqual([['created']]);
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it('rejects cross-origin traffic after workspace and before authentication or parsing', async () => {
    const workspace = vi.fn();
    const authenticate = vi.fn(() => ({ id: 'caller' }));
    const parse = vi.fn(() => ok({ value: 'parsed' }));
    const handle = vi.fn(() => ok({ value: 'response' }));
    const onError = vi.fn();
    const f = fixture({ spec: route({ handle }, { requireSameOrigin: true, parse, ports: { workspace, authenticate, onError } }) }, {
      adapter: originContext, origin: 'http://evil.example',
    });
    await f.run();
    expect(workspace).toHaveBeenCalledOnce();
    expect(authenticate).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(f.status.mock.calls).toEqual([[403]]);
    expect(f.json.mock.calls).toEqual([[{ error: { code: 'FORBIDDEN', message: 'cross-origin request rejected' } }]]);
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it.each(['origin', 'authorize'] as const)('retains the missing %s dependency guard and sends its exception to the host', async (guard) => {
    const authenticate = vi.fn(() => ({ id: 'caller' }));
    const onError = vi.fn<NonNullable<NonNullable<Spec['ports']>['onError']>>(({ res }) => { res.status(503).json('host error'); });
    const spec = route({ handle: async ({ authorize }) => { await authorize!({ permission: 'write', entityType: 'setting' }); return ok({ value: 'response' }); } }, {
      requireSameOrigin: guard === 'origin', ports: { authenticate, onError },
    });
    const f = fixture({ spec });
    await f.run();
    expect(onError).toHaveBeenCalledWith({ res: f.res, error: expect.objectContaining({
      message: guard === 'origin' ? 'same-origin adapter context is required' : 'JSON route authorizer is required',
    }) });
    expect(authenticate).toHaveBeenCalledTimes(guard === 'origin' ? 0 : 1);
    expect(f.status.mock.calls).toEqual([[503]]);
    expect(f.json.mock.calls).toEqual([['host error']]);
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it.each(['workspace', 'authenticate', 'parse', 'authorize', 'handle'] as const)('gives the host the exact thrown %s error and stops later phases', async (phase) => {
    const error = new Error('private driver failure');
    const seen: string[] = [];
    const step = ({ name }: { readonly name: string }, _optional: Record<string, never> = {}) => { seen.push(name); if (name === phase) throw error; };
    const onError = vi.fn<NonNullable<NonNullable<Spec['ports']>['onError']>>(({ res }) => { res.status(409).json('host rejection'); });
    const spec = route({ handle: async ({ authorize }) => {
      await authorize!({ permission: 'write', entityType: 'setting' }); step({ name: 'handle' }); return ok({ value: 'response' });
    } }, {
      parse: () => { step({ name: 'parse' }); return ok({ value: 'parsed' }); },
      ports: {
        workspace: () => step({ name: 'workspace' }),
        authenticate: () => { step({ name: 'authenticate' }); return { id: 'caller' }; },
        authorize: () => step({ name: 'authorize' }), onError,
      },
    });
    const f = fixture({ spec });
    await f.run();
    const order = ['workspace', 'authenticate', 'parse', 'authorize', 'handle'];
    expect(seen).toEqual(order.slice(0, order.indexOf(phase) + 1));
    expect(onError.mock.calls).toEqual([[{ res: f.res, error }]]);
    expect(f.status.mock.calls).toEqual([[409]]);
    expect(f.json.mock.calls).toEqual([['host rejection']]);
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it.each(['parse', 'handle'] as const)('serializes a %s Result failure without invoking the host exception port', async (phase) => {
    const apiError = createApiError({ code: 'NOT_FOUND', message: 'missing' });
    const onError = vi.fn();
    const handle = vi.fn(() => phase === 'handle' ? err({ error: apiError }) : ok({ value: 'response' }));
    const f = fixture({ spec: route({ handle }, {
      parse: () => phase === 'parse' ? err({ error: apiError }) : ok({ value: 'parsed' }), ports: { onError },
    }) });
    await f.run();
    expect(handle).toHaveBeenCalledTimes(phase === 'parse' ? 0 : 1);
    expect(f.status.mock.calls).toEqual([[404]]);
    expect(f.json.mock.calls).toEqual([[{ error: apiError }]]);
    expect(onError).not.toHaveBeenCalled();
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it.each([true, false])('lets the host error port take precedence over caller-safe errors: %s', async (hostErrorPort) => {
    const apiError = createApiError({ code: 'CONFLICT', message: 'safe conflict' });
    const error = new ClientFacingError({ apiError });
    const onInternalError = vi.fn();
    const onError = vi.fn<NonNullable<NonNullable<Spec['ports']>['onError']>>(({ res }) => { res.status(418).json('host handled'); });
    const f = fixture({ spec: route({ handle: () => { throw error; } }, { ports: hostErrorPort ? { onError } : {} }) }, {
      adapter: { ...originContext, onInternalError },
    });
    await f.run();
    expect(f.status.mock.calls).toEqual([[hostErrorPort ? 418 : 409]]);
    expect(f.json.mock.calls).toEqual([[hostErrorPort ? 'host handled' : { error: apiError }]]);
    expect(onError).toHaveBeenCalledTimes(hostErrorPort ? 1 : 0);
    expect(onInternalError).not.toHaveBeenCalled();
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it.each([true, false])('redacts unknown thrown values with a correlated injected sink: %s', async (injectedSink) => {
    const error = 'secret=/private/database';
    const onInternalError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = fixture({ spec: route({ handle: () => { throw error; } }) }, {
      adapter: injectedSink ? { ...originContext, onInternalError } : undefined,
    });
    await f.run();
    expect(f.status.mock.calls).toEqual([[500]]);
    expect(f.json.mock.calls).toEqual([[{ error: {
      code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    } }]]);
    const body = f.json.mock.calls[0]![0] as { error: { requestId: string } };
    if (injectedSink) {
      expect(onInternalError.mock.calls).toEqual([[{ method: 'post', path: '/pin', correlationId: body.error.requestId, error }]]);
      expect(consoleError).not.toHaveBeenCalled();
    } else {
      expect(consoleError.mock.calls).toEqual([[`[@jini-ai/http-kit] internal error (POST /pin, correlationId=${body.error.requestId})`, error]]);
    }
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it.each([true, false])('does not serialize a settled Result after disconnect (success: %s)', async (success) => {
    let signal: AbortSignal | undefined;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const onInternalError = vi.fn();
    const f = fixture({ spec: route({ handle: async (_required, { signal: received } = {}) => {
      signal = received; await pending;
      return success ? ok({ value: 'response' }) : err({ error: createApiError({ code: 'NOT_FOUND', message: 'gone' }) });
    } }) }, { adapter: { ...originContext, onInternalError } });
    const done = f.run();
    expect(signal?.aborted).toBe(false);
    expect(f.events.listenerCount('close')).toBe(1);
    f.events.emit('close');
    expect(signal?.aborted).toBe(true);
    release();
    await done;
    expect(f.status).not.toHaveBeenCalled();
    expect(f.json).not.toHaveBeenCalled();
    expect(onInternalError).not.toHaveBeenCalled();
    expect(f.events.listenerCount('close')).toBe(0);
  });

  it('detaches the close listener even if the host error port itself throws', async () => {
    const secondary = new Error('error port failed');
    const onError = () => { throw secondary; };
    const f = fixture({ spec: route({ handle: () => { throw new Error('initial failure'); } }, { ports: { onError } }) });
    await expect(f.run()).rejects.toBe(secondary);
    expect(f.status).not.toHaveBeenCalled();
    expect(f.events.listenerCount('close')).toBe(0);
  });
});
