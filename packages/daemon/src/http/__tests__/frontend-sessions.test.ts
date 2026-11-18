import { describe, expect, it, vi } from 'vitest';
import { createInMemoryServer, createRecordingOriginPolicy } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost, type FakeDaemonRouteHost } from './fakes/route-host.js';
import { readFrames } from './fakes/sse-reader.js';
import { createFrontendSessionRegistry, type FrontendSessionRegistry } from '../../index.js';
import { describeRoutes } from '../route-table.js';
import type { FrontendHookInput } from '../frontend-hook-input.js';

import {
  FRONTEND_SESSION_STREAM_ROUTE_PATH,
  frontendSessionResponseRoute,
  frontendSessionRoutes,
  parseCapabilityQuery,
  type FrontendSessionsHttpDeps,
} from '../frontend-sessions.js';

const STREAM = `http://local${FRONTEND_SESSION_STREAM_ROUTE_PATH}`;
const OWNER = { workspaceId: 'w1', principalId: 'p1', tabId: 't1' } as const;

/** A timer the test fires by hand, recording what it was asked for. */
function manualTimers() {
  const pending: { callback: () => void; delayMs: number; cancelled: boolean }[] = [];
  return {
    pending,
    setTimer: ({ callback, delayMs }: { callback: () => void; delayMs: number }) => {
      const entry = { callback, delayMs, cancelled: false };
      pending.push(entry);
      return { cancel: () => { entry.cancelled = true; } };
    },
  };
}

interface Setup { readonly deps: FrontendSessionsHttpDeps; readonly host: FakeDaemonRouteHost; readonly timers: ReturnType<typeof manualTimers>; readonly fetch: (request: Request, extra?: { locals?: Record<string, unknown>; client?: { address: string } }) => Promise<Response>; readonly routes: ReturnType<typeof frontendSessionRoutes> }

function setup({ registry, randomIds = false, ...overrides }: { registry: FrontendSessionRegistry; randomIds?: boolean } & Partial<FrontendSessionsHttpDeps>, { originPolicy }: { originPolicy?: ReturnType<typeof createRecordingOriginPolicy> } = {}): Setup {
  const timers = manualTimers();
  const deps: FrontendSessionsHttpDeps = { registry, ...(randomIds ? {} : { newSessionId: () => 'session-1' }), setTimer: timers.setTimer, ...overrides };
  const host = fakeDaemonRouteHost({}, originPolicy ? { originPolicy } : {});
  const routes = frontendSessionRoutes({ deps, host });
  const { server, fetch } = createInMemoryServer();
  for (const route of routes) server.route(route);
  return { deps, host, timers, fetch, routes };
}

const frameData = (frame: string | undefined): unknown => JSON.parse(String(frame).slice('data: '.length));

describe('frontendSessionRoutes', () => {
  it('lists the stream and the responses route, each with the gate it sits behind', () => {
    const registry = createFrontendSessionRegistry({});
    expect(describeRoutes({ routes: setup({ registry }).routes })).toEqual([
      { method: 'GET', path: '/api/frontend-sessions/stream', gates: ['same-origin'] },
      { method: 'POST', path: '/api/frontend-sessions/:sessionId/responses', gates: ['same-origin'] },
    ]);
    expect(describeRoutes({ routes: setup({ registry, routePrefix: '/api/scoped', resolveOwner: async () => OWNER }).routes })).toEqual([
      { method: 'GET', path: '/api/scoped/stream', gates: ['frontend-session-owner'] },
      { method: 'POST', path: '/api/scoped/:sessionId/responses', gates: ['frontend-session-owner'] },
    ]);
  });

  it('refuses full capacity with a quiet 429 before any stream exists', async () => {
    const registry = createFrontendSessionRegistry({}, { maxSessions: 0 });
    const { fetch, host } = setup({ registry });
    const response = await fetch(new Request(`${STREAM}?capability=page.click`));
    expect(response.status).toBe(429);
    expect(await response.text()).toBe('Too Many Requests');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(host.reports).toEqual([]);
  });

  it('serves a real stream and routes a capability call through it end to end', async () => {
    const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'inv-1', newBindToken: () => 'bind-1' });
    const { fetch } = setup({ registry });
    const controller = new AbortController();
    const response = await fetch(new Request(`${STREAM}?capability=page.click`, { signal: controller.signal }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const frames = readFrames({ response });
    expect(await frames.next()).toEqual(['data: {"type":"attached","sessionId":"session-1","bindToken":"bind-1"}']);

    registry.bindRun({ runId: 'run-1', sessionId: 'session-1' });
    const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: { element: 'save-button' } });
    expect(frameData((await frames.next())[0])).toEqual({ type: 'invocation', invocationId: 'inv-1', capabilityId: 'page.click', input: { element: 'save-button' } });

    const answer = await fetch(new Request('http://local/api/frontend-sessions/session-1/responses', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invocationId: 'inv-1', ok: true, output: { clicked: 'save-button' } }),
    }));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ settled: true });
    await expect(pending).resolves.toEqual({ clicked: 'save-button' });
    controller.abort();
  });

  it('refuses a cross-origin stream request before attaching anything', async () => {
    const registry = createFrontendSessionRegistry({});
    const attachSpy = vi.spyOn(registry, 'attach');
    const originPolicy = createRecordingOriginPolicy();
    originPolicy.set({ allow: false });
    const { fetch } = setup({ registry }, { originPolicy });
    const response = await fetch(new Request(`${STREAM}?capability=page.click`, { headers: { origin: 'http://evil.example' } }));
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).not.toBe('text/event-stream');
    expect(await response.json()).toEqual({ error: expect.objectContaining({ code: 'FORBIDDEN' }) });
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it('answers 500 with the request ID when attaching fails, and gives the real error to the host sink only', async () => {
    const registry = createFrontendSessionRegistry({});
    const failure = new Error('registry exploded');
    vi.spyOn(registry, 'attach').mockImplementation(() => { throw failure; });
    const { fetch, host } = setup({ registry });
    const response = await fetch(new Request(`${STREAM}?capability=page.click`));
    expect(response.status).toBe(500);
    expect(host.reports).toHaveLength(1);
    expect(host.reports[0]).toMatchObject({ logSource: 'frontend-sessions:stream', report: { source: 'stream', error: failure } });
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'The page connection could not be opened. Reload the page; if it keeps failing, copy the request ID and report this problem.', requestId: host.reports[0]?.requestId } });
  });

  it('detaches the surface when the client leaves, failing anything still awaiting it', async () => {
    const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'inv-1' });
    const { fetch } = setup({ registry });
    const response = await fetch(new Request(`${STREAM}?capability=page.click`));
    const frames = readFrames({ response });
    await frames.next();
    registry.bindRun({ runId: 'run-1', sessionId: 'session-1' });
    const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} });
    expect(registry.sessionFor({ runId: 'run-1' })).toEqual({ sessionId: 'session-1', capabilities: ['page.click'] });
    await frames.cancel();
    await expect(pending).rejects.toThrow('detached before answering');
    // The binding goes with it, so a later call fails closed instead of hanging.
    expect(registry.sessionFor({ runId: 'run-1' })).toBeUndefined();
  });

  it('streams a cancellation to its tab', async () => {
    const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'waiting' });
    const { fetch } = setup({ registry });
    const frames = readFrames({ response: await fetch(new Request(`${STREAM}?capability=page.click`)) });
    await frames.next();
    registry.bindRun({ runId: 'run-1', sessionId: 'session-1' });
    const controller = new AbortController();
    const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} }, { signal: controller.signal });
    await frames.next();
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(frameData((await frames.next())[0])).toEqual({ type: 'cancelled', invocationId: 'waiting' });
    await frames.cancel();
  });

  it('mints a random session id when the host supplies no generator, and never one the caller chose', async () => {
    const registry = createFrontendSessionRegistry({});
    const { fetch } = setup({ registry, randomIds: true });
    // An id chosen by the caller could collide with, or impersonate, an attached session.
    const frames = readFrames({ response: await fetch(new Request(`${STREAM}?capability=page.click&sessionId=attacker-chosen`)) });
    const attached = frameData((await frames.next())[0]) as { type: string; sessionId: string };
    expect(attached.type).toBe('attached');
    // A real UUID, not an empty or predictable placeholder.
    expect(attached.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await frames.cancel();
  });

  it('attaches with no capabilities when none are requested, so nothing can be served', async () => {
    const registry = createFrontendSessionRegistry({});
    const { fetch } = setup({ registry });
    const frames = readFrames({ response: await fetch(new Request(STREAM)) });
    await frames.next();
    registry.bindRun({ runId: 'run-1', sessionId: 'session-1' });
    expect(registry.capabilitiesFor({ runId: 'run-1' })).toEqual([]);
    await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow(/does not offer "page\.click"/);
    await frames.cancel();
  });

  it('keeps only the capabilities the host allows', async () => {
    const registry = createFrontendSessionRegistry({});
    const { fetch } = setup({ registry, allowedCapabilities: ['page.click'] });
    const frames = readFrames({ response: await fetch(new Request(`${STREAM}?capability=page.click&capability=page.fill`)) });
    await frames.next();
    registry.bindRun({ runId: 'run-1', sessionId: 'session-1' });
    expect(registry.capabilitiesFor({ runId: 'run-1' })).toEqual(['page.click']);
    await frames.cancel();
  });

  it('reports a bad capability query as one error event and closes, attaching nothing', async () => {
    const registry = createFrontendSessionRegistry({});
    const attachSpy = vi.spyOn(registry, 'attach');
    const { fetch } = setup({ registry });
    const response = await fetch(new Request(`${STREAM}?capability=%20`));
    expect(response.status).toBe(200);
    expect(await readFrames({ response }).rest()).toEqual(['data: {"type":"error","message":"each \\"capability\\" query parameter must be a non-empty string"}']);
    expect(attachSpy).not.toHaveBeenCalled();
  });

  describe('the host hooks (A10)', () => {
    it('hand the hooks the request headers and the host locals, never the socket peer, and take the capacity keys from the hook', async () => {
      const registry = createFrontendSessionRegistry({});
      const attachSpy = vi.spyOn(registry, 'attach');
      const seen: FrontendHookInput[] = [];
      const { fetch } = setup({
        registry,
        resolveOwner: async (input) => { seen.push(input); return OWNER; },
        resolveCapacityKeys: (input) => { seen.push(input); return ['ip:203.0.113.9']; },
      });
      const response = await fetch(new Request(`${STREAM}?capability=page.click`, { headers: { 'x-frontend-tab': 'tab-7' } }), { locals: { k: 1 }, client: { address: '203.0.113.7' } });
      const frames = readFrames({ response });
      await frames.next();
      expect(seen).toHaveLength(2);
      for (const input of seen) {
        expect(Object.keys(input).filter(key => key !== 'owner').sort()).toEqual(['locals', 'request']);
        expect(input.locals).toEqual({ k: 1 });
        expect(input.request.headers.get('x-frontend-tab')).toBe('tab-7');
      }
      expect(JSON.stringify(seen)).not.toContain('203.0.113.7');
      expect((seen[1] as { owner?: unknown }).owner).toEqual(OWNER);
      expect(attachSpy.mock.calls[0]?.[0].descriptor).toEqual({ sessionId: 'session-1', capabilities: ['page.click'], owner: OWNER, capacityKeys: ['ip:203.0.113.9'] });
      await frames.cancel();
    });
  });

  describe('with an owner hook', () => {
    it('refuses a request with no owner using the plain 403 words, and attaches nothing', async () => {
      const registry = createFrontendSessionRegistry({});
      const attachSpy = vi.spyOn(registry, 'attach');
      const { fetch, host } = setup({ registry, resolveOwner: async () => null });
      const response = await fetch(new Request(`${STREAM}?capability=page.click`));
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Forbidden');
      expect(attachSpy).not.toHaveBeenCalled();
      expect(host.reports).toEqual([]);
    });

    it('does not ask the daemon\'s own origin policy: the hook authenticates origin with the owner', async () => {
      const registry = createFrontendSessionRegistry({});
      const originPolicy = createRecordingOriginPolicy();
      originPolicy.set({ allow: false });
      const { fetch } = setup({ registry, resolveOwner: async () => OWNER }, { originPolicy });
      const response = await fetch(new Request(`${STREAM}?capability=page.click`, { headers: { origin: 'http://evil.example' } }));
      expect(response.status).toBe(200);
      await response.body?.cancel();
    });

    it('answers 500 with a request ID, one report and no session when the owner hook throws (A11)', async () => {
      const registry = createFrontendSessionRegistry({});
      const attachSpy = vi.spyOn(registry, 'attach');
      const failure = new Error('facts are missing');
      const { fetch, host } = setup({ registry, resolveOwner: async () => { throw failure; } });
      const response = await fetch(new Request(`${STREAM}?capability=page.click`));
      expect(response.status).toBe(500);
      expect(host.reports).toHaveLength(1);
      expect(host.reports[0]).toMatchObject({ report: { source: 'stream', error: failure } });
      expect(attachSpy).not.toHaveBeenCalled();
    });

    it('ends an owned session at its TTL, releasing the quota, and cancels the timer when the client leaves first', async () => {
      const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'inv-1' });
      const { fetch, timers } = setup({ registry, resolveOwner: async () => OWNER, sessionTtlMs: 4_000 });
      const frames = readFrames({ response: await fetch(new Request(`${STREAM}?capability=page.click`)) });
      await frames.next();
      expect(timers.pending.map(entry => entry.delayMs)).toEqual([4_000]);
      registry.bindRun({ runId: 'run-1', sessionId: 'session-1', owner: OWNER } as never);
      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} });
      timers.pending[0]?.callback();
      await expect(pending).rejects.toThrow('detached before answering');
      // The call already pushed to the tab stays in the stream; then the stream ends.
      expect(await frames.rest()).toEqual(['data: {"type":"invocation","invocationId":"inv-1","capabilityId":"page.click","input":{}}']);

      const second = readFrames({ response: await fetch(new Request(`${STREAM}?capability=page.click`)) });
      await second.next();
      await second.cancel();
      await vi.waitFor(() => { expect(timers.pending[1]?.cancelled).toBe(true); });
    });

    it('sets no timer for a session without an owner, and defaults an owned one to thirty minutes', async () => {
      const registry = createFrontendSessionRegistry({});
      const plain = setup({ registry });
      await (await plain.fetch(new Request(`${STREAM}?capability=page.click`))).body?.cancel();
      expect(plain.timers.pending).toEqual([]);
      const owned = setup({ registry: createFrontendSessionRegistry({}), resolveOwner: async () => OWNER });
      await (await owned.fetch(new Request(`${STREAM}?capability=page.click`))).body?.cancel();
      expect(owned.timers.pending.map(entry => entry.delayMs)).toEqual([1_800_000]);
    });

    describe('the responses gate', () => {
      async function openOwned({ owner = OWNER as typeof OWNER | null }: { owner?: typeof OWNER | null } = {}) {
        const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'inv-1', newBindToken: () => 'bind-1' });
        const ctx = setup({ registry, resolveOwner: async () => owner });
        const frames = readFrames({ response: await ctx.fetch(new Request(`${STREAM}?capability=page.click`)) });
        await frames.next();
        return { ...ctx, registry, frames };
      }
      const answer = ({ fetch, token }: { fetch: Setup['fetch']; token?: string }) => fetch(new Request('http://local/api/frontend-sessions/session-1/responses', {
        method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-frontend-bind-token': token } : {}) }, body: JSON.stringify({ invocationId: 'nope', ok: true }),
      }));

      it('lets the session\'s owner through with the right bind token only', async () => {
        const ctx = await openOwned();
        expect((await answer({ fetch: ctx.fetch })).status).toBe(403);
        expect((await answer({ fetch: ctx.fetch, token: 'wrong' })).status).toBe(403);
        const ok = await answer({ fetch: ctx.fetch, token: 'bind-1' });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ settled: false });
        await ctx.frames.cancel();
      });

      it('refuses a caller whose owner hook says nobody, with the plain 403 words', async () => {
        const registry = createFrontendSessionRegistry({}, { newBindToken: () => 'bind-1' });
        const { fetch } = setup({ registry, resolveOwner: async () => null });
        const response = await answer({ fetch, token: 'bind-1' });
        expect(response.status).toBe(403);
        expect(await response.text()).toBe('Forbidden');
      });

      it('answers the same 403 when the owner hook throws, and hands the error to the host sink (A11)', async () => {
        const registry = createFrontendSessionRegistry({});
        const failure = new Error('facts are missing');
        const { fetch, host } = setup({ registry, resolveOwner: async () => { throw failure; } });
        const response = await answer({ fetch, token: 'bind-1' });
        expect(response.status).toBe(403);
        expect(await response.text()).toBe('Forbidden');
        expect(host.reports).toHaveLength(1);
        expect(host.reports[0]).toMatchObject({ logSource: 'frontend-sessions:owner', message: 'Forbidden', report: { source: 'frontend-session-owner', error: failure } });
      });
    });
  });

  it('asks the daemon\'s same-origin policy for the responses route when there is no owner hook', async () => {
    const originPolicy = createRecordingOriginPolicy();
    originPolicy.set({ allow: false });
    const { fetch } = setup({ registry: createFrontendSessionRegistry({}) }, { originPolicy });
    const response = await fetch(new Request('http://local/api/frontend-sessions/session-1/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invocationId: 'i', ok: true }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.objectContaining({ code: 'FORBIDDEN' }) });
  });
});

describe('parseCapabilityQuery', () => {
  const read = (query: string) => parseCapabilityQuery({ searchParams: new URLSearchParams(query) });

  it('accepts a single value, repeated values, and none at all', () => {
    expect(read('capability=page.click')).toEqual(['page.click']);
    expect(read('capability=page.click&capability=page.fill')).toEqual(['page.click', 'page.fill']);
    expect(read('')).toEqual([]);
  });

  it('rejects rather than coerces anything that is not a non-empty string', () => {
    expect(read('capability=page.click&capability=')).toBeNull();
    expect(read('capability=page.click&capability=%20%20')).toBeNull();
    expect(read('capability=')).toBeNull();
  });

  // D-FS1: the host's old parser read the first three as a list of one (and refused an object); every bracketed spelling is refused now.
  it.each(['capability[]=a', 'capability[0]=a', 'capability[25]=a', 'capability[k]=a', 'capability=a&capability[k]=b', 'capability%5B%5D=a'])('refuses the bracketed spelling %s', (query) => {
    expect(read(query)).toBeNull();
  });

  it('counts a capability after a thousand other parameters (the old parser dropped it)', () => {
    const filler = Array.from({ length: 1000 }, (_unused, index) => `f${index}=1`).join('&');
    expect(read(`${filler}&capability=page.read`)).toEqual(['page.read']);
  });
});

describe('frontendSessionResponseRoute', () => {
  const parse = frontendSessionResponseRoute.parse;
  const input = (body: unknown, sessionId = 'session-1') => ({ body, query: {}, params: { sessionId } });
  const makeDeps = (registry: FrontendSessionRegistry): FrontendSessionsHttpDeps => ({ registry, newSessionId: () => 'session-1', setTimer: () => ({ cancel: () => undefined }) });
  const handle = async ({ registry, body }: { registry: FrontendSessionRegistry; body: unknown }) => {
    const parsed = parse(input(body));
    expect(parsed.ok).toBe(true);
    return frontendSessionResponseRoute.handle({ input: (parsed as { ok: true; value: never }).value, deps: makeDeps(registry) });
  };

  async function attached({ registry, capability }: { registry: FrontendSessionRegistry; capability: string }) {
    const { fetch } = setup({ registry });
    const frames = readFrames({ response: await fetch(new Request(`${STREAM}?capability=${capability}`)) });
    await frames.next();
    registry.bindRun({ runId: 'run-1', sessionId: 'session-1' });
    return frames;
  }

  it('relays human-wait progress without settling the call', async () => {
    const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'waiting' });
    const frames = await attached({ registry, capability: 'page.click' });
    const progress = vi.fn();
    const controller = new AbortController();
    const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: { handle: 'save' } }, { signal: controller.signal, onApprovalStateChange: progress });
    for (const phase of ['approval-pending', 'execution-started']) {
      expect(await handle({ registry, body: { invocationId: 'waiting', phase } })).toEqual({ ok: true, value: { settled: true } });
    }
    expect(progress.mock.calls).toEqual([[{ pending: true }], [{ pending: false }]]);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(await handle({ registry, body: { invocationId: 'waiting', phase: 'execution-started' } })).toEqual({ ok: true, value: { settled: false } });
    await frames.cancel();
  });

  it('settles a pending invocation with the surface\'s output', async () => {
    const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'inv-1' });
    const frames = await attached({ registry, capability: 'page.click' });
    const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} });
    expect(await handle({ registry, body: { invocationId: 'inv-1', ok: true, output: { clicked: 'x' } } })).toEqual({ ok: true, value: { settled: true } });
    await expect(pending).resolves.toEqual({ clicked: 'x' });
    await frames.cancel();
  });

  it('turns a reported failure into a rejection carrying the surface\'s message', async () => {
    const registry = createFrontendSessionRegistry({}, { newInvocationId: () => 'inv-1' });
    const frames = await attached({ registry, capability: 'page.fill' });
    const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.fill', input: {} });
    await handle({ registry, body: { invocationId: 'inv-1', ok: false, message: 'refusing to fill "password"' } });
    await expect(pending).rejects.toThrow('refusing to fill "password"');
    await frames.cancel();
  });

  it('reports settled:false for a duplicate or unknown answer instead of erroring', async () => {
    expect(await handle({ registry: createFrontendSessionRegistry({}), body: { invocationId: 'never-issued', ok: true, output: 1 } })).toEqual({ ok: true, value: { settled: false } });
  });

  it('requires a same-origin request', () => {
    expect(frontendSessionResponseRoute.requireSameOrigin).toBe(true);
  });

  describe('input validation', () => {
    it('rejects a missing or blank invocationId', () => {
      expect(parse(input({ ok: true })).ok).toBe(false);
      expect(parse(input({ invocationId: '   ', ok: true })).ok).toBe(false);
      expect(parse(input({ invocationId: 42, ok: true })).ok).toBe(false);
    });

    it('rejects a non-boolean ok', () => {
      expect(parse(input({ invocationId: 'inv-1' })).ok).toBe(false);
      expect(parse(input({ invocationId: 'inv-1', ok: 'yes' })).ok).toBe(false);
    });

    it('requires a message when ok is false', () => {
      // A failure with no reason gives the agent nothing to act on, so it retries forever.
      expect(parse(input({ invocationId: 'inv-1', ok: false })).ok).toBe(false);
      expect(parse(input({ invocationId: 'inv-1', ok: false, message: '  ' })).ok).toBe(false);
      expect(parse(input({ invocationId: 'inv-1', ok: false, message: 'why' })).ok).toBe(true);
    });

    it('rejects a non-object body and a missing sessionId', () => {
      expect(parse(input('not an object')).ok).toBe(false);
      expect(parse(input([1, 2, 3])).ok).toBe(false);
      expect(parse(input({ invocationId: 'inv-1', ok: true }, '')).ok).toBe(false);
    });

    it('accepts an absent output as a legitimate success value', () => {
      expect(parse(input({ invocationId: 'inv-1', ok: true })).ok).toBe(true);
    });
  });
});

it('validates the fixed modal decision vocabulary on progress frames', () => {
  const parse = frontendSessionResponseRoute.parse;
  const input = (decision: unknown) => ({ query: {}, params: { sessionId: 'tab' }, body: { invocationId: 'action', phase: 'execution-started', decision } });
  expect(parse(input('declined')).ok).toBe(true);
  for (const decision of ['operator secret', ['approved'], { confirmed: true }]) expect(parse(input(decision)).ok).toBe(false);
});
