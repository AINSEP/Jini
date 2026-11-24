import { describe, expect, it } from 'vitest';
import { createInMemoryServer } from '@jini-ai/core/contracts/server/testing';
import { parseRendererToAgentMessage } from '@jini-ai/protocol/a2ui';
import { createSurfaceExchangeStore } from '../../surface-exchanges.js';
import { createTimeoutScheduler } from '../../scheduler.js';
import { a2uiActionsRoutes, answerA2uiAction } from '../a2ui-actions.js';
import { answerSurfaceCallback, surfaceCallbackRoutes, type SurfaceCallbackRouteDeps } from '../surface-callback-route.js';
import { fakeDaemonRouteHost } from './fakes/route-host.js';

/**
 * Wire pins for the two surface endpoints as daemon routes: exact status and body of every refusal
 * (no principal, wrong principal, malformed body, not on the allowlist) and of a delivery.
 */
const HEADER = 'x-neutral-principal';
const makeStore = () => createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}), clock: { nowMs: () => Date.now() }, idGenerator: { newId: () => globalThis.crypto.randomUUID() }, defaultChannel: 'mcp-ui' });
const action = (surfaceId: string) => ({ version: 'v1.0', action: { name: 'go', surfaceId, sourceComponentId: 'b', timestamp: '2026-01-01T00:00:00Z', context: {} } });
const send = (fetch: (request: Request) => Promise<Response>, path: string, body: unknown, principal?: string) => fetch(new Request(`http://local${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(principal === undefined ? {} : { [HEADER]: principal }) }, body: JSON.stringify(body),
}));
const answered = async (response: Response) => ({ status: response.status, body: await response.json() });
/**
 * A principal-less post whose body would fail the read (malformed JSON, over the 16-byte cap the
 * route host is given below): only a route that checks the principal FIRST answers 401 and leaves
 * the body stream untouched. A route that reads first answers 400/413 and consumes the stream.
 */
const unreadableAnonymousPost = (path: string, raw: string) => new Request(`http://local${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
const UNREADABLE_BODIES = ['{not json', JSON.stringify({ exchangeId: 'e'.repeat(64), toolName: 'allowed' })];
/** A host-parsed body that records whether the handler looked at it before refusing. */
const watchedBody = () => {
  const touched: string[] = [];
  const request = { headers: new Headers(), signal: new AbortController().signal, get body(): unknown { touched.push('body'); return { exchangeId: 'e', toolName: 'allowed' }; } };
  return { request, touched };
};

describe('A2UI actions route', () => {
  const setup = (store = makeStore()) => {
    const { server, fetch } = createInMemoryServer();
    for (const route of a2uiActionsRoutes({ path: '/a2ui', host: fakeDaemonRouteHost({}), deps: { surfaceExchanges: store, principalHeader: HEADER, parseRendererMessage: parseRendererToAgentMessage } })) server.route(route);
    return { fetch, store };
  };
  const UNAUTHENTICATED = { status: 401, body: { error: `${HEADER} is required`, code: 'UNAUTHENTICATED' } };

  it('answers 401 before it reads the body: a malformed or oversize anonymous post is never parsed', async () => {
    const { server, fetch } = createInMemoryServer();
    for (const route of a2uiActionsRoutes({ path: '/a2ui', host: fakeDaemonRouteHost({}, { jsonBodyMaxBytes: 16 }), deps: { surfaceExchanges: makeStore(), principalHeader: HEADER, parseRendererMessage: parseRendererToAgentMessage } })) server.route(route);
    for (const raw of UNREADABLE_BODIES) {
      const request = unreadableAnonymousPost('/a2ui', raw);
      expect(await answered(await fetch(request))).toEqual(UNAUTHENTICATED);
      expect(request.bodyUsed).toBe(false);
    }
  });

  it('answerA2uiAction refuses a host-parsed post with no principal before touching its body', async () => {
    const { request, touched } = watchedBody();
    const deps = { surfaceExchanges: makeStore(), principalHeader: HEADER, parseRendererMessage: parseRendererToAgentMessage };
    expect(await answered(await answerA2uiAction({ request, deps }))).toEqual(UNAUTHENTICATED);
    expect(touched).toEqual([]);
  });

  it('answerA2uiAction answers a host-parsed post exactly as the route does', async () => {
    const store = makeStore();
    const exchange = store.open({ binding: { toolId: 't', principalId: 'alice', channel: 'a2ui' }, emit: async () => undefined });
    const answer = exchange.receive({});
    const deps = { surfaceExchanges: store, principalHeader: HEADER, parseRendererMessage: parseRendererToAgentMessage };
    const as = (principal: string, body: unknown) => ({ headers: new Headers({ [HEADER]: principal }), body, signal: new AbortController().signal });
    expect(await answered(await answerA2uiAction({ request: as('alice', {}), deps }))).toEqual({ status: 400, body: { error: "'exchangeId' must be a non-empty string", code: 'VALIDATION_ERROR' } });
    const post = { exchangeId: exchange.id, message: action(exchange.id) };
    expect(await answered(await answerA2uiAction({ request: as('mallory', post), deps }))).toEqual({ status: 409, body: { error: 'that surface is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'binding-mismatch' } });
    expect(await answered(await answerA2uiAction({ request: as('alice', post), deps }))).toEqual({ status: 202, body: { delivered: true } });
    expect((await answer).status).toBe('received');
  });

  it('answers 401 before it judges the body', async () => {
    const { fetch } = setup();
    for (const body of [{}, { exchangeId: 'e', message: action('e') }]) {
      expect(await answered(await send(fetch, '/a2ui', body))).toEqual({ status: 401, body: { error: `${HEADER} is required`, code: 'UNAUTHENTICATED' } });
    }
  });

  it('answers 400 with the flat validation body, 409 for another principal, then 202 for the owner', async () => {
    const store = makeStore();
    const exchange = store.open({ binding: { toolId: 't', principalId: 'alice', channel: 'a2ui' }, emit: async () => undefined });
    const answer = exchange.receive({});
    const { fetch } = setup(store);
    expect(await answered(await send(fetch, '/a2ui', {}, 'alice'))).toEqual({ status: 400, body: { error: "'exchangeId' must be a non-empty string", code: 'VALIDATION_ERROR' } });
    const post = { exchangeId: exchange.id, message: action(exchange.id) };
    expect(await answered(await send(fetch, '/a2ui', post, 'mallory'))).toEqual({ status: 409, body: { error: 'that surface is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'binding-mismatch' } });
    expect(await Promise.race([answer, Promise.resolve('waiting')])).toBe('waiting');
    expect(await answered(await send(fetch, '/a2ui', post, 'alice'))).toEqual({ status: 202, body: { delivered: true } });
    expect((await answer).status).toBe('received');
  });

  it('lets an unanticipated failure reach the host instead of leaking it as a reply', async () => {
    const { server, fetch } = createInMemoryServer();
    const boom = () => { throw new Error('parser blew up'); };
    for (const route of a2uiActionsRoutes({ path: '/a2ui', host: fakeDaemonRouteHost({}), deps: { surfaceExchanges: makeStore(), principalHeader: HEADER, parseRendererMessage: boom as never } })) server.route(route);
    await expect(send(fetch, '/a2ui', { exchangeId: 'e', message: action('e') }, 'alice')).rejects.toThrow('parser blew up');
  });
});

describe('surface callback route', () => {
  const setup = (overrides: Partial<SurfaceCallbackRouteDeps> = {}) => {
    const store = makeStore();
    const executed: string[] = [];
    const deps: SurfaceCallbackRouteDeps = {
      toolExecutor: { execute: async ({ toolId }) => { executed.push(toolId); return { executionId: 'x', status: 'completed', output: { ran: toolId } }; } },
      surfaceExchanges: store, scheduler: { setInterval: () => ({ cancel: () => undefined }) } as never, idGenerator: { newId: () => 'id-1' },
      principalHeader: HEADER, admit: ({ toolName }) => toolName === 'allowed', ...overrides,
    };
    const { server, fetch } = createInMemoryServer();
    for (const route of surfaceCallbackRoutes({ path: '/cb', host: fakeDaemonRouteHost({}), deps })) server.route(route);
    return { fetch, store, executed, deps };
  };

  it('answers 401 before it reads the body: a malformed or oversize anonymous post is never parsed', async () => {
    const { deps, executed } = setup();
    const { server, fetch } = createInMemoryServer();
    for (const route of surfaceCallbackRoutes({ path: '/cb', host: fakeDaemonRouteHost({}, { jsonBodyMaxBytes: 16 }), deps })) server.route(route);
    for (const raw of UNREADABLE_BODIES) {
      const request = unreadableAnonymousPost('/cb', raw);
      expect(await answered(await fetch(request))).toEqual({ status: 401, body: { error: `${HEADER} is required`, code: 'UNAUTHENTICATED' } });
      expect(request.bodyUsed).toBe(false);
    }
    expect(executed).toEqual([]);
  });

  it('answerSurfaceCallback refuses a host-parsed callback with no principal before touching its body', async () => {
    const { deps, executed } = setup();
    const { request, touched } = watchedBody();
    expect(await answered(await answerSurfaceCallback({ request, deps }))).toMatchObject({ status: 401 });
    expect(touched).toEqual([]);
    expect(executed).toEqual([]);
  });

  it('answers 401 before the body is judged and executes nothing', async () => {
    const { fetch, executed } = setup();
    expect(await answered(await send(fetch, '/cb', { toolName: 'allowed' }))).toEqual({ status: 401, body: { error: `${HEADER} is required`, code: 'UNAUTHENTICATED' } });
    expect(await answered(await send(fetch, '/cb', {}))).toMatchObject({ status: 401 });
    expect(executed).toEqual([]);
  });

  it('answers 400 for a bad toolName and 403 for a tool the allowlist refuses, executing nothing', async () => {
    const { fetch, executed } = setup();
    expect(await answered(await send(fetch, '/cb', {}, 'alice'))).toEqual({ status: 400, body: { error: "'toolName' must be a non-empty string", code: 'VALIDATION_ERROR' } });
    expect(await answered(await send(fetch, '/cb', { toolName: 'nope' }, 'alice'))).toEqual({ status: 403, body: { error: "'nope' is not an MCP-UI-redeemable tool", code: 'TOOL_NOT_ALLOWLISTED' } });
    expect(executed).toEqual([]);
  });

  it('redeems an allowlisted tool with no exchange as the header principal', async () => {
    const { fetch, executed } = setup();
    expect(await answered(await send(fetch, '/cb', { toolName: 'allowed', params: {} }, 'alice'))).toEqual({ status: 200, body: { ran: 'allowed' } });
    expect(executed).toEqual(['allowed']);
  });

  it('answers 409 for another principal and 202 for the owner of an exchange', async () => {
    const { fetch, store } = setup();
    const exchange = store.open({ binding: { toolId: 'allowed', principalId: 'alice' }, emit: async () => undefined });
    const answer = exchange.receive({});
    const body = { toolName: 'allowed', exchangeId: exchange.id, params: { v: 1 } };
    expect(await answered(await send(fetch, '/cb', body, 'mallory'))).toEqual({ status: 409, body: { error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'binding-mismatch' } });
    expect(await Promise.race([answer, Promise.resolve('waiting')])).toBe('waiting');
    expect(await answered(await send(fetch, '/cb', body, 'alice'))).toEqual({ status: 202, body: { delivered: true } });
  });

  it('answers 409 for a typed answer when nothing is outstanding instead of executing the tool', async () => {
    const { fetch, executed } = setup({ admit: () => true });
    const res = await answered(await send(fetch, '/cb', { toolName: 'allowed', params: { __typedAnswer: 'hi' } }, 'alice'));
    expect(res).toEqual({ status: 409, body: { error: 'that dialog is no longer waiting for an answer', code: 'SURFACE_NOT_PENDING', reason: 'unknown-or-closed' } });
    expect(executed).toEqual([]);
  });
});
