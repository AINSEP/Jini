import { afterEach, expect, it, vi } from 'vitest';
import { createFrontendSessionBridge, openFetchFrontendStream } from '../frontend-session-bridge.js';
import type { PageDriver } from '@jini-ai/agentic';

afterEach(() => { vi.unstubAllGlobals(); });

it('retains the published stream fetch default for hosts upgrading within 0.6.x', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response('', { status: 429 }));
  vi.stubGlobal('fetch', send);
  // Deliberately omit injection only in compatibility tests; production hosts inject it.
  const stream = openFetchFrontendStream({ url: '/stream', headers: () => ({ 'x-tab': 'credential' }) });
  try {
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith('/stream', expect.objectContaining({ headers: { 'x-tab': 'credential' }, signal: expect.any(AbortSignal) }));
  } finally { stream.close(); }
});

it('fetch streams back off transient failures and stop on 429', async () => {
  vi.useFakeTimers();
  const send = vi.fn(async () => new Response('', { status: 503 }));
  const stream = openFetchFrontendStream({ url: '/stream', headers: () => ({}) }, { fetch: send as typeof fetch });
  try {
    await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999); expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(send).toHaveBeenCalledTimes(3);
    stream.close();
    const limited = vi.fn(async () => new Response('', { status: 429 }));
    const stopped = openFetchFrontendStream({ url: '/stream', headers: () => ({}) }, { fetch: limited as typeof fetch });
    await vi.advanceTimersByTimeAsync(60_000); expect(limited).toHaveBeenCalledTimes(1);
    stopped.close();
  } finally { stream.close(); vi.useRealTimers(); }
});

it('both widget hosts use explicit claims, header authentication, live tokens and ordered acknowledgement', async () => {
  const events = new EventTarget(); const calls: { url: string; init: RequestInit }[] = []; const order: string[] = [];
  let opened = '';
  const bridge = createFrontendSessionBridge({ baseUrl: '', endpointPrefix: '/public/frontend', headers: () => ({ 'x-tab': 'credential' }),
    openStream: ({ url, headers }) => { opened = url; expect(headers).toEqual({ 'x-tab': 'credential' }); return { addEventListener: events.addEventListener.bind(events) as EventSource['addEventListener'], close() {} }; },
    fetch: vi.fn(async (url, init) => { calls.push({ url: String(url), init: init! }); order.push('acknowledged'); return new Response('{"settled":true}'); }) as typeof fetch,
  }, { capabilityIds: ['page.click'], pageDriver: {
    findElements: async () => [{ handle: 'menu', label: 'Menu', labelTruncated: false }], listPages: async () => [],
    click: async () => { order.push('clicked'); }, scrollTo: async () => {},
  } as unknown as PageDriver,
    onBeforeResponse: () => { order.push('persisted'); }, onAfterResponse: () => { order.push('after'); },
  });
  expect(opened).toBe('/public/frontend/stream?capability=page.click');
  const frame = (data: unknown) => events.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  frame({ type: 'attached', sessionId: 's', bindToken: 'one' }); await bridge.ready;
  frame({ type: 'attached', sessionId: 's2', bindToken: 'two' });
  frame({ type: 'invocation', invocationId: 'i', capabilityId: 'page.click', input: { handle: 'menu' } });
  await vi.waitFor(() => expect(order).toEqual(['clicked', 'persisted', 'acknowledged', 'after']));
  expect(calls[0]!.url).toBe('/public/frontend/s2/responses');
  expect(calls[0]!.init.headers).toMatchObject({ 'x-tab': 'credential', 'x-frontend-bind-token': 'two' });
  frame({ type: 'invocation', invocationId: 'i', capabilityId: 'page.click', input: { handle: 'menu' } });
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(order.filter(item => item === 'clicked')).toHaveLength(1);
  events.dispatchEvent(new Event('error')); expect(bridge.bindToken()).toBeUndefined(); bridge.close();
});

it('oversized output sends valid refusal JSON and cannot trigger an accepted terminal effect', async () => {
  const events = new EventTarget(); const after = vi.fn(); const error = vi.fn();
  const bodies: string[] = [];
  const bridge = createFrontendSessionBridge({ baseUrl: '', headers: () => ({ 'x-tab': 'credential' }),
    openStream: () => ({ addEventListener: events.addEventListener.bind(events) as EventSource['addEventListener'], close() {} }),
    fetch: vi.fn(async (_url, init) => { bodies.push(String(init!.body)); return new Response('{"settled":true}'); }) as typeof fetch,
  }, { capabilityIds: ['fixture.read'], executors: { 'fixture.': async () => 'x'.repeat(1000) }, maxResponseBytes: 180,
    onAfterResponse: after, onError: error });
  const frame = (data: unknown) => events.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  frame({ type: 'attached', sessionId: 's', bindToken: 'one' }); await bridge.ready;
  frame({ type: 'invocation', invocationId: 'large', capabilityId: 'fixture.read', input: {} });
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(JSON.parse(bodies[0]!)).toMatchObject({ invocationId: 'large', ok: false });
  expect(new TextEncoder().encode(bodies[0]!).length).toBeLessThanOrEqual(180);
  expect(after).not.toHaveBeenCalled(); bridge.close();
});
