import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { INTERNAL_FAILURE_MARKER, startRouteHarness, type RouteHarness } from './harness.js';
import { FOREIGN_ORIGIN, probe } from './probes.js';
import { openStream } from './stream-reader.js';
import { runAnthropicToolTurn, runAzureToolTurn, runGoogleToolTurn, runOllamaToolTurn, runOpenAiToolTurn } from '@jini-ai/agent-runtime';

/**
 * The life of each event stream the daemon serves, recorded from today's code on a real socket:
 * what is answered before a stream exists, the bytes that open it, what is sent while it idles,
 * how a replay arrives, how it ends, and what is released when the client leaves. The five kinds
 * (run events, memory events, terminal output, frontend sessions, model proxy) differ in each of
 * these, so each kind has its own block. Only the stream's own collaborator is real; every other
 * dependency throws.
 */

const EVENT_STREAM_HEADERS = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform' };

/** The bytes the cursor-carrying streams (runs, memory, terminals) write for one event. */
const frame = (event: { opaqueCursor: string; kind: string }): string => `id: ${event.opaqueCursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}`;

const expectHeaders = (response: Response, expected: Record<string, string>): void => {
  for (const [name, value] of Object.entries(expected)) expect(response.headers.get(name)).toBe(value);
};

/** Only intervals are faked: the socket, the client and the read deadlines keep real time. */
const fakeIntervals = (): void => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); };
afterEach(() => { vi.useRealTimers(); });

const settle = (ms = 40): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('run event stream (GET /api/runs/:runId/events)', () => {
  type RunEvent = { opaqueCursor: string; kind: string; text?: string };
  type StreamResult = { kind: 'ok'; unsubscribe: () => void } | { kind: 'unknown-run' } | { kind: 'invalid-cursor'; requestedCursor: string } | { kind: 'replay-gap'; requestedCursor: string; oldestAvailableCursor: string };
  type StreamCall = { runId: string; onEvent: (event: RunEvent) => void; afterCursor: string | null };
  const route = 'GET /api/runs/:runId/events';
  const calls: StreamCall[] = [];
  let script: (call: StreamCall) => Promise<StreamResult> = () => Promise.resolve({ kind: 'unknown-run' });
  let harness: RouteHarness;

  beforeAll(async () => {
    harness = await startRouteHarness({}, { familyDeps: { runs: { lifecycle: {
      stream: ({ runId, onEvent }: Omit<StreamCall, 'afterCursor'>, { afterCursor }: { afterCursor: string | null }) => {
        const call = { runId, onEvent, afterCursor };
        calls.push(call);
        return script(call);
      },
    } } } });
  });
  afterAll(async () => { await harness.close(); });
  afterEach(() => { calls.length = 0; });

  const subscribed = (unsubscribe: () => void = () => undefined): StreamResult => ({ kind: 'ok', unsubscribe });

  it('opens with the event-stream headers and writes each event as id, event and data lines', async () => {
    const first: RunEvent = { opaqueCursor: 'c-1', kind: 'delta', text: 'héllo' };
    script = async ({ onEvent }) => { onEvent(first); return subscribed(); };
    const stream = await openStream({ harness, route });
    expect(stream.response.status).toBe(200);
    expectHeaders(stream.response, EVENT_STREAM_HEADERS);
    expect(await stream.next()).toEqual([frame(first)]);
    expect(calls[0]?.runId).toBe('x1');
    stream.abort();
  });

  it('a run with no history still opens the stream, empty, once it is subscribed', async () => {
    script = async () => subscribed();
    const stream = await openStream({ harness, route });
    expect(stream.response.status).toBe(200);
    expectHeaders(stream.response, EVENT_STREAM_HEADERS);
    calls[0]?.onEvent({ opaqueCursor: 'c-live', kind: 'delta' });
    expect(await stream.next()).toEqual([frame({ opaqueCursor: 'c-live', kind: 'delta' })]);
    stream.abort();
  });

  it.each([
    ['no cursor', {}, '', null],
    ['the Last-Event-ID header', { 'last-event-id': 'cursor-h' }, '', 'cursor-h'],
    ['the afterCursor query value', {}, '?afterCursor=cursor-q', 'cursor-q'],
    ['the header when both are sent', { 'last-event-id': 'cursor-h' }, '?afterCursor=cursor-q', 'cursor-h'],
    ['nothing when afterCursor is repeated', {}, '?afterCursor=a&afterCursor=b', null],
    ['nothing when afterCursor is empty', {}, '?afterCursor=', null],
  ] as const)('replays from %s', async (_label, headers, query, expected) => {
    script = async () => subscribed();
    const stream = await openStream({ harness, route }, { headers, query });
    expect(calls[0]?.afterCursor).toBe(expected);
    stream.abort();
  });

  it('a 1,167-event replay delivered in one synchronous burst arrives whole, in order, and the stream stays open for live events', async () => {
    const replay = Array.from({ length: 1167 }, (_unused, index): RunEvent => ({ opaqueCursor: `c-${index}`, kind: 'delta', text: `chunk ${index}` }));
    const unsubscribe = vi.fn();
    script = async ({ onEvent }) => { for (const event of replay) onEvent(event); return subscribed(unsubscribe); };
    const stream = await openStream({ harness, route });
    const frames = await stream.next(1167);
    expect(frames[0]).toBe(frame(replay[0]!));
    expect(frames[1166]).toBe(frame(replay[1166]!));
    expect(frames).toEqual(replay.map(frame));
    expect(unsubscribe).not.toHaveBeenCalled();
    calls[0]?.onEvent({ opaqueCursor: 'c-live', kind: 'delta' });
    expect(await stream.next()).toEqual([frame({ opaqueCursor: 'c-live', kind: 'delta' })]);
    stream.abort();
  });

  it('the end event is delivered and then closes the stream and the subscription; later events are not sent', async () => {
    const unsubscribe = vi.fn();
    script = async () => subscribed(unsubscribe);
    const stream = await openStream({ harness, route });
    const emit = calls[0]!.onEvent;
    emit({ opaqueCursor: 'c-1', kind: 'delta' });
    emit({ opaqueCursor: 'c-2', kind: 'end' });
    emit({ opaqueCursor: 'c-3', kind: 'delta' });
    expect(await stream.rest()).toEqual([frame({ opaqueCursor: 'c-1', kind: 'delta' }), frame({ opaqueCursor: 'c-2', kind: 'end' })]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an unknown run', { kind: 'unknown-run' }, 404, { error: { code: 'NOT_FOUND', message: 'run was not found' } }],
    ['a cursor the log cannot read', { kind: 'invalid-cursor', requestedCursor: 'zz' }, 400, { error: { code: 'BAD_REQUEST', message: 'invalid replay cursor "zz"' } }],
    ['a cursor older than the log keeps', { kind: 'replay-gap', requestedCursor: 'c-0', oldestAvailableCursor: 'c-9' }, 409, { error: { code: 'CONFLICT', message: 'replay gap after cursor "c-0"', details: { oldestAvailableCursor: 'c-9' } } }],
  ] as const)('%s is answered as JSON, not as a stream', async (_label, result, status, body) => {
    script = async () => result;
    const answer = await probe({ harness, route });
    expect(answer.status).toBe(status);
    expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(answer.json).toEqual(body);
  });

  it('a failure before any event is answered as a JSON 500 that carries a request ID and not the failure text', async () => {
    const before = harness.internalErrors.length;
    script = async () => { throw new Error(INTERNAL_FAILURE_MARKER); };
    const answer = await probe({ harness, route });
    expect(answer.summary).toBe('500 INTERNAL_ERROR');
    expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const requestId = (answer.json as { error: { requestId: string } }).error.requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(harness.internalErrors).toHaveLength(before + 1);
    expect(harness.internalErrors.at(-1)).toMatchObject({ source: 'run-stream', runId: 'x1', error: expect.objectContaining({ message: INTERNAL_FAILURE_MARKER }) });
  });

  it('a failure after the first event ends the stream: the event is kept, nothing else is written', async () => {
    script = async ({ onEvent }) => { onEvent({ opaqueCursor: 'c-1', kind: 'delta' }); throw new Error(INTERNAL_FAILURE_MARKER); };
    const stream = await openStream({ harness, route });
    expect(stream.response.status).toBe(200);
    expect(await stream.rest()).toEqual([frame({ opaqueCursor: 'c-1', kind: 'delta' })]);
  });

  it('a client that leaves an open stream is unsubscribed once', async () => {
    const unsubscribe = vi.fn();
    script = async () => subscribed(unsubscribe);
    const stream = await openStream({ harness, route });
    stream.abort();
    await vi.waitFor(() => { expect(unsubscribe).toHaveBeenCalledTimes(1); });
    await settle();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('a client that leaves while the subscription is still being made is unsubscribed once, when it resolves', async () => {
    const unsubscribe = vi.fn();
    let resolveSubscription: (result: StreamResult) => void = () => undefined;
    script = () => new Promise((resolve) => { resolveSubscription = resolve; });
    const controller = new AbortController();
    const pending = harness.fetch(new Request('http://harness.invalid/api/runs/x1/events', { signal: controller.signal }));
    await vi.waitFor(() => { expect(calls).toHaveLength(1); });
    controller.abort();
    await expect(pending).rejects.toThrow();
    await settle();
    resolveSubscription(subscribed(unsubscribe));
    await vi.waitFor(() => { expect(unsubscribe).toHaveBeenCalledTimes(1); });
    await settle();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while idle: no timer is scheduled and a minute later the next bytes are the next event', async () => {
    fakeIntervals();
    script = async () => subscribed();
    const stream = await openStream({ harness, route });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    calls[0]?.onEvent({ opaqueCursor: 'c-live', kind: 'delta' });
    expect(await stream.next()).toEqual([frame({ opaqueCursor: 'c-live', kind: 'delta' })]);
    stream.abort();
  });
});

describe('memory event stream (GET /api/memory/events)', () => {
  const route = 'GET /api/memory/events';
  const notes = new EventEmitter();
  const extractions = new EventEmitter();
  const verifications = new EventEmitter();
  const listeners = (): number[] => [notes.listenerCount('change'), extractions.listenerCount('attempt'), verifications.listenerCount('verify')];
  let harness: RouteHarness;
  beforeAll(async () => {
    harness = await startRouteHarness({}, { familyDeps: { memory: { notes: { events: notes }, extractions: { events: extractions }, verifications: { events: verifications } } } });
  });
  afterAll(async () => { await harness.close(); });

  it('opens with a connected event, numbers its events from 0 and carries each source under its own kind', async () => {
    const stream = await openStream({ harness, route });
    expect(stream.response.status).toBe(200);
    expectHeaders(stream.response, EVENT_STREAM_HEADERS);
    const [connected] = await stream.next();
    expect(connected).toMatch(/^id: 0\nevent: connected\ndata: \{"opaqueCursor":"0","kind":"connected","data":\{"at":\d+\}\}$/);
    notes.emit('change', { id: 'n1' });
    extractions.emit('attempt', { id: 'e1' });
    verifications.emit('verify', { id: 'v1' });
    expect(await stream.next(3)).toEqual([
      frame({ opaqueCursor: '1', kind: 'change', data: { id: 'n1' } } as never),
      frame({ opaqueCursor: '2', kind: 'extraction', data: { id: 'e1' } } as never),
      frame({ opaqueCursor: '3', kind: 'verify', data: { id: 'v1' } } as never),
    ]);
    stream.abort();
    await vi.waitFor(() => { expect(listeners()).toEqual([0, 0, 0]); });
  });

  it('holds one listener per source while open and none after the client leaves', async () => {
    const stream = await openStream({ harness, route });
    await stream.next();
    expect(listeners()).toEqual([1, 1, 1]);
    stream.abort();
    await vi.waitFor(() => { expect(listeners()).toEqual([0, 0, 0]); });
  });

  it('a foreign origin is refused before anything is subscribed', async () => {
    const answer = await probe({ harness, route }, { origin: FOREIGN_ORIGIN });
    expect(answer.summary).toBe('403 FORBIDDEN');
    expect(listeners()).toEqual([0, 0, 0]);
  });

  it('sends nothing while idle: no timer is scheduled and a minute later the next bytes are the next event', async () => {
    fakeIntervals();
    const stream = await openStream({ harness, route });
    await stream.next();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    notes.emit('change', { id: 'after-idle' });
    expect(await stream.next()).toEqual([frame({ opaqueCursor: '1', kind: 'change', data: { id: 'after-idle' } } as never)]);
    stream.abort();
    await vi.waitFor(() => { expect(listeners()).toEqual([0, 0, 0]); });
  });

  it('a consumer that never reads is disconnected by a burst of live events, and its listeners are released', async () => {
    // The answer is opened but its body is never read, so the connection backs up; the stream
    // then holds at most 1000 undelivered events and drops the consumer on the next one.
    const controller = new AbortController();
    const response = await harness.fetch(new Request('http://harness.invalid/api/memory/events', { signal: controller.signal }));
    expect(response.status).toBe(200);
    expect(listeners()).toEqual([1, 1, 1]);
    const large = { blob: 'x'.repeat(64 * 1024) };
    let sent = 0;
    while (notes.listenerCount('change') > 0 && sent < 20_000) {
      notes.emit('change', large);
      sent += 1;
    }
    expect(listeners()).toEqual([0, 0, 0]);
    // More than the cap had to pile up first: a stream that dropped on the first slow write would stop far earlier.
    expect(sent).toBeGreaterThan(1000);
    expect(sent).toBeLessThan(20_000);
    controller.abort();
  });
});

describe('terminal output stream (GET /api/terminals/:id/stream)', () => {
  type Sink = { send(event: string, data: unknown, eventId: number): void; end(): void };
  type AttachCall = { principal: unknown; id: string; lastEventId: number; sink: Sink };
  const route = 'GET /api/terminals/:id/stream';
  const attachCalls: AttachCall[] = [];
  const detach = vi.fn();
  let attach: (call: AttachCall) => 'attached' | 'ended' | 'not-found' = () => 'not-found';
  let harness: RouteHarness;
  beforeAll(async () => {
    harness = await startRouteHarness({}, { familyDeps: { terminals: {
      principal: { id: 'principal-1' },
      manager: { attach: (call: AttachCall) => { attachCalls.push(call); return attach(call); }, detach },
    } } });
  });
  afterAll(async () => { await harness.close(); });
  afterEach(() => { attachCalls.length = 0; detach.mockClear(); });

  const output = (eventId: number, kind = 'output'): string => frame({ opaqueCursor: String(eventId), kind, data: `line ${eventId}` } as never);

  it('attaching to a session that already exited delivers every replay frame, then the exit, then ends', async () => {
    attach = ({ sink }) => {
      for (const eventId of [1, 2, 3]) sink.send('output', `line ${eventId}`, eventId);
      sink.send('exit', 'line 4', 4);
      sink.end();
      return 'ended';
    };
    const stream = await openStream({ harness, route });
    expect(stream.response.status).toBe(200);
    expectHeaders(stream.response, EVENT_STREAM_HEADERS);
    expect(await stream.rest()).toEqual([output(1), output(2), output(3), output(4, 'exit')]);
  });

  it('a replay that ends without an exit event still delivers every frame before the stream ends', async () => {
    attach = ({ sink }) => {
      for (const eventId of [1, 2]) sink.send('output', `line ${eventId}`, eventId);
      sink.end();
      return 'ended';
    };
    const stream = await openStream({ harness, route });
    expect(await stream.rest()).toEqual([output(1), output(2)]);
  });

  it('an unknown terminal is answered as a JSON 404, not as a stream', async () => {
    attach = () => 'not-found';
    const answer = await probe({ harness, route });
    expect(answer.status).toBe(404);
    expect(answer.json).toEqual({ error: { code: 'NOT_FOUND', message: 'terminal "x1" was not found' } });
  });

  it.each([
    ['no cursor', {}, '', 0],
    ['the Last-Event-ID header', { 'last-event-id': '17' }, '', 17],
    ['the afterCursor query value', {}, '?afterCursor=9', 9],
  ] as const)('replays from %s, as a number', async (_label, headers, query, expected) => {
    attach = () => 'attached';
    const stream = await openStream({ harness, route }, { headers, query });
    expect(attachCalls[0]).toMatchObject({ id: 'x1', lastEventId: expected, principal: { id: 'principal-1' } });
    stream.abort();
    await vi.waitFor(() => { expect(detach).toHaveBeenCalledTimes(1); });
  });

  it('a live session streams what the manager sends, and a client that leaves is detached once with its own sink', async () => {
    attach = () => 'attached';
    const stream = await openStream({ harness, route });
    const { sink } = attachCalls[0]!;
    sink.send('output', 'line 5', 5);
    expect(await stream.next()).toEqual([output(5)]);
    expect(detach).not.toHaveBeenCalled();
    stream.abort();
    await vi.waitFor(() => { expect(detach).toHaveBeenCalledTimes(1); });
    expect(detach).toHaveBeenCalledWith({ id: 'x1', sink });
  });

  it('a foreign origin is refused before the session is attached', async () => {
    const answer = await probe({ harness, route }, { origin: FOREIGN_ORIGIN });
    expect(answer.summary).toBe('403 FORBIDDEN');
    expect(attachCalls).toHaveLength(0);
  });

  it('sends nothing while idle: no timer is scheduled and a minute later the next bytes are the next event', async () => {
    fakeIntervals();
    attach = () => 'attached';
    const stream = await openStream({ harness, route });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    attachCalls[0]!.sink.send('output', 'line 6', 6);
    expect(await stream.next()).toEqual([output(6)]);
    stream.abort();
    await vi.waitFor(() => { expect(detach).toHaveBeenCalledTimes(1); });
  });
});

describe('frontend session stream (GET /api/frontend-sessions/stream)', () => {
  type AttachArgs = { descriptor: { sessionId: string; capabilities: readonly string[] }; deliver: (invocation: Record<string, unknown>) => void; cancel: (required: { invocationId: string }) => void };
  const route = 'GET /api/frontend-sessions/stream';
  const attached: AttachArgs[] = [];
  const detach = vi.fn();
  let harness: RouteHarness;
  beforeAll(async () => {
    harness = await startRouteHarness({}, { familyDeps: { 'frontend-sessions': {
      newSessionId: () => 'session-1',
      allowedCapabilities: undefined,
      resolveCapacityKeys: undefined,
      sessionTtlMs: undefined,
      registry: { attach: (args: AttachArgs) => { attached.push(args); return { sessionId: args.descriptor.sessionId, bindToken: 'bind-1', detach }; } },
    } } });
  });
  afterAll(async () => { await harness.close(); });
  afterEach(() => { attached.length = 0; detach.mockClear(); });

  it('opens with its own headers (no charset) and an attached event carrying the session and its bind token', async () => {
    const stream = await openStream({ harness, route }, { query: '?capability=page.read&capability=page.click' });
    expect(stream.response.status).toBe(200);
    expectHeaders(stream.response, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' });
    expect(await stream.next()).toEqual(['data: {"type":"attached","sessionId":"session-1","bindToken":"bind-1"}']);
    expect(attached[0]?.descriptor).toEqual({ sessionId: 'session-1', capabilities: ['page.read', 'page.click'] });
    stream.abort();
    await vi.waitFor(() => { expect(detach).toHaveBeenCalledTimes(1); });
  });

  it('delivers invocations and cancellations as data-only frames', async () => {
    const stream = await openStream({ harness, route });
    await stream.next();
    attached[0]!.deliver({ invocationId: 'i-1', capabilityId: 'page.read', input: { a: 1 } });
    attached[0]!.cancel({ invocationId: 'i-1' });
    expect(await stream.next(2)).toEqual([
      'data: {"type":"invocation","invocationId":"i-1","capabilityId":"page.read","input":{"a":1}}',
      'data: {"type":"cancelled","invocationId":"i-1"}',
    ]);
    stream.abort();
    await vi.waitFor(() => { expect(detach).toHaveBeenCalledTimes(1); });
  });

  it('an empty capability value opens the stream, says why in one error event, and closes without attaching', async () => {
    const stream = await openStream({ harness, route }, { query: '?capability=' });
    expect(stream.response.status).toBe(200);
    expect(await stream.rest()).toEqual(['data: {"type":"error","message":"each \\"capability\\" query parameter must be a non-empty string"}']);
    expect(attached).toHaveLength(0);
  });

  // A12: what each `capability` query shape does. The rows marked D-FS1 are the ones the plan's section 12.4 changed on purpose
  // (the host app's `qs` parser used to decide; the daemon now reads the URL itself and refuses every bracketed spelling);
  // every other row stayed as it was written before the change.
  const ERROR_EVENT = 'data: {"type":"error","message":"each \\"capability\\" query parameter must be a non-empty string"}';
  const filler = Array.from({ length: 1000 }, (_unused, index) => `f${index}=1`).join('&');
  for (const [name, query, capabilities] of [
    ['one key', '?capability=page.read', ['page.read']],
    ['repeated plain keys, in order', '?capability=page.read&capability=page.click', ['page.read', 'page.click']],
    ['no key at all', '', []],
    ['D-FS1: a key after 1000 other parameters is counted', `?${filler}&capability=page.read`, ['page.read']],
  ] as const) it(`capability query, ${name}: attached with ${JSON.stringify(capabilities)}`, async () => {
    const stream = await openStream({ harness, route }, { query });
    expect(await stream.next()).toEqual(['data: {"type":"attached","sessionId":"session-1","bindToken":"bind-1"}']);
    expect(attached[0]?.descriptor.capabilities).toEqual(capabilities);
    stream.abort();
    await vi.waitFor(() => { expect(detach).toHaveBeenCalledTimes(1); });
  });
  for (const [name, query] of [
    ['D-FS1: an empty-bracket key is refused', '?capability[]=page.read'],
    ['D-FS1: an indexed key is refused', '?capability[0]=page.read'],
    ['D-FS1: a high index is refused', '?capability[25]=page.read'],
    ['a nested key', '?capability[k]=page.read'],
    ['a plain key next to a nested one', '?capability=page.read&capability[k]=page.click'],
    ['an empty value', '?capability='],
    ['a blank value among good ones', '?capability=page.read&capability=%20'],
  ] as const) it(`capability query, ${name}: one error event, nothing attached`, async () => {
    const stream = await openStream({ harness, route }, { query });
    expect(await stream.rest()).toEqual([ERROR_EVENT]);
    expect(attached).toHaveLength(0);
  });

  it('pings every 15 seconds while idle, and stops when the client leaves', async () => {
    fakeIntervals();
    const stream = await openStream({ harness, route });
    await stream.next();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(14_999);
    attached[0]!.deliver({ invocationId: 'before-ping' });
    expect(await stream.next()).toEqual(['data: {"type":"invocation","invocationId":"before-ping"}']);
    vi.advanceTimersByTime(1);
    expect(await stream.next()).toEqual([': ping']);
    vi.advanceTimersByTime(15_000);
    expect(await stream.next()).toEqual([': ping']);
    stream.abort();
    await vi.waitFor(() => { expect(detach).toHaveBeenCalledTimes(1); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a foreign origin is refused before a session is attached', async () => {
    const answer = await probe({ harness, route }, { origin: FOREIGN_ORIGIN });
    expect(answer.summary).toBe('403 FORBIDDEN');
    expect(attached).toHaveLength(0);
  });
});

describe('model proxy streams (POST /api/proxy/<provider>/stream)', () => {
  const route = 'POST /api/proxy/ollama/stream';
  const validBody = JSON.stringify({ apiKey: 'characterization-key', model: 'llama3', baseUrl: 'http://127.0.0.1:11434', messages: [{ role: 'user', content: 'hi' }] });
  let harness: RouteHarness;
  let transportCalls = 0;
  beforeAll(async () => {
    harness = await startRouteHarness({}, { familyDeps: { 'model-proxy': {
      toolTurns: { anthropic: runAnthropicToolTurn, openai: runOpenAiToolTurn, azure: runAzureToolTurn, google: runGoogleToolTurn, ollama: runOllamaToolTurn },
      dnsLookup: undefined,
      fetchImpl: async () => { transportCalls += 1; throw new Error(INTERNAL_FAILURE_MARKER); },
    } } });
  });
  afterAll(async () => { await harness.close(); });

  it('a body the provider cannot read is answered as a JSON 400 before any stream exists and before the provider is called', async () => {
    const answer = await probe({ harness, route }, { body: '{}' });
    expect(answer.summary).toBe('400 BAD_REQUEST');
    expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(transportCalls).toBe(0);
  });

  // DM-R3-3 (owner decision 2026-11-17): the upstream's own text never reaches the client; it goes to the host's error sink.
  it('a transport failure after the stream is open is reported inside it as fixed words plus a request ID, and the real text goes to the host sink', async () => {
    // The host's injected reporter hands every route incident to the harness's record.
    const before = harness.internalErrors.length;
    const stream = await openStream({ harness, route }, { body: validBody });
    expect(stream.response.status).toBe(200);
    expectHeaders(stream.response, EVENT_STREAM_HEADERS);
    const frames = await stream.rest();
    const proxyIncidents = harness.internalErrors.slice(before) as Array<{ correlationId: string; provider: string; error: unknown }>;
    expect(proxyIncidents).toHaveLength(1);
    const [incident] = proxyIncidents;
    expect(frames).toEqual([
      frame({ opaqueCursor: '0', kind: 'error', data: { type: 'error', message: 'The assistant response stopped. Review any completed actions before starting another turn. Copy the request ID and report this problem.', code: incident!.correlationId } } as never),
      frame({ opaqueCursor: '1', kind: 'end', data: { type: 'end', reason: 'error' } } as never),
    ]);
    expect(JSON.stringify(frames)).not.toContain(INTERNAL_FAILURE_MARKER);
    expect(incident).toMatchObject({ provider: 'ollama', error: expect.objectContaining({ message: INTERNAL_FAILURE_MARKER }) });
    expect(transportCalls).toBeGreaterThanOrEqual(1);
  });

  it('sends nothing but its events: no timer is scheduled for a proxy stream', async () => {
    fakeIntervals();
    const stream = await openStream({ harness, route }, { body: validBody });
    expect(vi.getTimerCount()).toBe(0);
    await stream.rest();
  });
});
