import { afterEach, expect, it, vi } from 'vitest';
import { createFrontendSessionBridge, openFetchFrontendStream } from '../frontend-session-bridge.js';
import type { PageDriver } from '@jini-ai/agentic';

afterEach(() => { vi.unstubAllGlobals(); });

function bridgeHarness() {
  const sources: Array<EventTarget & { close: ReturnType<typeof vi.fn> }> = [];
  const bridge = createFrontendSessionBridge({ baseUrl: '', fetch: vi.fn() as typeof fetch,
    openStream: () => {
      const source = Object.assign(new EventTarget(), { close: vi.fn() });
      sources.push(source);
      return { addEventListener: source.addEventListener.bind(source) as EventSource['addEventListener'], close: source.close };
    },
  });
  const frame = (index: number, data: unknown) => sources[index]!.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  return { bridge, sources, frame };
}

it('park closes the stream and clears the token', async () => {
  vi.useFakeTimers();
  const { bridge, sources, frame } = bridgeHarness();
  try {
    frame(0, { type: 'attached', sessionId: 'old', bindToken: 'old-token' });
    await bridge.ready;
    sources[0]!.dispatchEvent(new MessageEvent('parked', { data: '{}' }));
    expect(sources[0]!.close).toHaveBeenCalledOnce();
    expect(bridge.bindToken()).toBeUndefined();
    // A delayed frame from the closed transport cannot restore a revoked token.
    frame(0, { type: 'attached', sessionId: 'late', bindToken: 'stale-token' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bridge.bindToken()).toBeUndefined();
    expect(sources).toHaveLength(1);
  } finally { bridge.close(); vi.useRealTimers(); }
});

it('rebind waits for a fresh attached frame after prior readiness', async () => {
  const { bridge, sources, frame } = bridgeHarness();
  try {
    frame(0, { type: 'attached', sessionId: 'old', bindToken: 'old-token' });
    await bridge.ready;
    sources[0]!.dispatchEvent(new Event('error'));
    const waiting = bridge.rebind({}, {});
    let settled = false;
    void waiting.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(sources[0]!.close).toHaveBeenCalledOnce();
    expect(sources).toHaveLength(2);
    frame(0, { type: 'attached', sessionId: 'late', bindToken: 'stale-token' });
    expect(bridge.bindToken()).toBeUndefined();
    frame(1, { type: 'attached', sessionId: 'new', bindToken: 'new-token' });
    await expect(waiting).resolves.toEqual({ sessionId: 'new', bindToken: 'new-token' });
    expect(bridge.bindToken()).toBe('new-token');
    await expect(bridge.ready).resolves.toEqual({ sessionId: 'old', bindToken: 'old-token' });
  } finally { bridge.close(); }
});

it('concurrent rebinds share one stream and Stop cancels only its own wait', async () => {
  const { bridge, sources, frame } = bridgeHarness();
  const stop = new AbortController();
  const stopped = bridge.rebind({ signal: stop.signal }, {});
  const rejected = expect(stopped).rejects.toThrow('stopped');
  const waiting = bridge.rebind({}, {});
  stop.abort(new Error('stopped'));
  await rejected;
  expect(sources).toHaveLength(1);
  frame(0, { type: 'attached', sessionId: 'new', bindToken: 'live' });
  await expect(waiting).resolves.toMatchObject({ bindToken: 'live' });
  await expect(bridge.rebind({}, {})).resolves.toMatchObject({ bindToken: 'live' });
  bridge.close();
  await expect(bridge.rebind({}, {})).rejects.toThrow(/closed/);
  expect(sources).toHaveLength(1);
});

it('a visibility suspension invalidates the token and retains transport ownership', async () => {
  const { bridge, sources, frame } = bridgeHarness();
  frame(0, { type: 'attached', sessionId: 'old', bindToken: 'old-token' });
  await bridge.ready;
  sources[0]!.dispatchEvent(new Event('suspended'));
  expect(bridge.bindToken()).toBeUndefined();
  expect(sources[0]!.close).not.toHaveBeenCalled();
  const waiting = bridge.rebind({}, {});
  expect(sources).toHaveLength(1);
  frame(0, { type: 'attached', sessionId: 'visible', bindToken: 'visible-token' });
  await expect(waiting).resolves.toMatchObject({ bindToken: 'visible-token' });
  bridge.close();
});

it('park aborts page work before a fresh attachment can execute it', async () => {
  const events: EventTarget[] = [];
  let approve!: (value: { confirmed: true }) => void;
  let approvalSignal: AbortSignal | undefined;
  const click = vi.fn(async () => {});
  const send = vi.fn(async () => new Response('{"settled":true}'));
  const bridge = createFrontendSessionBridge({ baseUrl: '', fetch: send as typeof fetch,
    openStream: () => {
      const source = new EventTarget(); events.push(source);
      return { addEventListener: source.addEventListener.bind(source) as EventSource['addEventListener'], close() {} };
    },
  }, { pageDriver: { click } as unknown as PageDriver, pageApproval: {
    isDirect: () => false,
    request: ({ signal }) => { approvalSignal = signal; return new Promise(resolve => { approve = resolve; }); },
  } });
  const frame = (index: number, data: unknown) => events[index]!.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  frame(0, { type: 'attached', sessionId: 'old', bindToken: 'old-token' });
  await bridge.ready;
  frame(0, { type: 'invocation', invocationId: 'pending', capabilityId: 'page.click', input: { handle: 'save' } });
  await vi.waitFor(() => expect(approvalSignal).toBeDefined());
  events[0]!.dispatchEvent(new Event('parked'));
  expect(approvalSignal!.aborted).toBe(true);
  const waiting = bridge.rebind({}, {});
  frame(1, { type: 'attached', sessionId: 'fresh', bindToken: 'fresh-token' });
  await waiting;
  approve({ confirmed: true });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  // Drain the abandoned invocation's continuations; neither a click nor an answer may cross binds.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(click).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
  bridge.close();
});

it('park cannot acknowledge an old result into a fresh session', async () => {
  const events: EventTarget[] = [];
  let finish!: () => void;
  const preparing = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const send = vi.fn(async () => new Response('{"settled":true}'));
  const bridge = createFrontendSessionBridge({ baseUrl: '', fetch: send as typeof fetch,
    openStream: () => {
      const source = new EventTarget(); events.push(source);
      return { addEventListener: source.addEventListener.bind(source) as EventSource['addEventListener'], close() {} };
    },
  }, { executors: { 'fixture.': async () => 'old-result' }, onBeforeResponse: preparing });
  const frame = (index: number, data: unknown) => events[index]!.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  frame(0, { type: 'attached', sessionId: 'old', bindToken: 'old-token' });
  await bridge.ready;
  frame(0, { type: 'invocation', invocationId: 'pending', capabilityId: 'fixture.read', input: {} });
  await vi.waitFor(() => expect(preparing).toHaveBeenCalledOnce());
  events[0]!.dispatchEvent(new Event('parked'));
  const waiting = bridge.rebind({}, {});
  frame(1, { type: 'attached', sessionId: 'fresh', bindToken: 'fresh-token' });
  await waiting;
  finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(send).not.toHaveBeenCalled();
  bridge.close();
});

it.each(['parked', 'error', 'close'])('%s rejects a pending current attachment wait', async kind => {
  const { bridge, sources } = bridgeHarness();
  // This surface never attached; observe ready only to prevent a refusal becoming unhandled.
  const waiting = bridge.rebind({}, {});
  const rejected = expect(waiting).rejects.toThrow();
  if (kind === 'close') bridge.close();
  else sources[0]!.dispatchEvent(new Event(kind));
  await rejected;
  expect(bridge.bindToken()).toBeUndefined();
  bridge.close();
});

it('a parked fetch stream stays closed without scheduling native reconnect', async () => {
  vi.useFakeTimers();
  let streamSignal: AbortSignal | undefined;
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    streamSignal = init?.signal ?? undefined;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"attached","sessionId":"s","bindToken":"old"}\n\nevent: parked\ndata: {}\n\n'));
      // Keep the server stream open: only delivery of parked may end this connection.
      streamSignal?.addEventListener('abort', () => controller.close(), { once: true });
    } }));
  });
  const bridge = createFrontendSessionBridge({ baseUrl: '', fetch: send as typeof fetch,
    openStream: ({ url }) => openFetchFrontendStream({ url, headers: () => ({}) }, { fetch: send as typeof fetch }),
  });
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(streamSignal?.aborted).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(bridge.bindToken()).toBeUndefined();
  } finally { bridge.close(); vi.useRealTimers(); }
});

it('fetch transport retains existing named application frames as messages', async () => {
  const send = vi.fn(async () => new Response('event: attached\ndata: {"type":"attached","sessionId":"s","bindToken":"live"}\n\n'));
  const stream = openFetchFrontendStream({ url: '/stream', headers: () => ({}) }, { fetch: send as typeof fetch });
  const frames: string[] = [];
  stream.addEventListener('message', event => frames.push((event as MessageEvent<string>).data));
  try {
    await vi.waitFor(() => expect(frames).toEqual(['{"type":"attached","sessionId":"s","bindToken":"live"}']));
  } finally { stream.close(); }
});

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
