import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import type { RunProgress, RunSettlement, RunDaemonClient, Scheduler } from '../ports.js';
import { createAssistantRunFinalizer } from '../entry.js';
import { notices } from '../../../core/run-events/__tests__/fixture.js';

// Port-based adaptations of the host finalizer HTTP/restart characterization suite.
const frame = (kind: string, payload: unknown) => `event: ${kind}\ndata: ${JSON.stringify({ runId: 'run-1', kind, payload })}\n\n`;
const text = (delta: string) => frame('agent', { type: 'text_delta', delta });
const streamOf = (...frames: string[]) => new Response(frames.join(''), { status: 200 });
const stub: ChatMessage = { id: 'a1', role: 'assistant', content: '', runId: 'run-1', runStatus: 'running' };
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start: c => { controller = c; } }));
  return { response, push: (chunk: string) => controller.enqueue(new TextEncoder().encode(chunk)), close: () => controller.close() };
}
function harness(daemon: RunDaemonClient, options: { interval?: number; maxReconnects?: number } = {}) {
  const progress: RunProgress[] = [];
  const settlements: RunSettlement[] = [];
  let time = 1_000;
  const timers = new Map<object, { task: () => void; delayMs: number }>();
  const scheduler: Scheduler = {
    schedule: ({ task, delayMs }) => { const handle = {}; timers.set(handle, { task, delayMs }); return handle; },
    cancel: ({ handle }) => { timers.delete(handle as object); },
    sleep: async ({ delayMs }) => { time += delayMs; },
  };
  const ledger = {
    checkpoint: vi.fn(async (input: RunProgress) => { progress.push(input); return true; }),
    settle: vi.fn(async (input: RunSettlement) => { settlements.push(input); return true; }),
  };
  const finalizer = createAssistantRunFinalizer({
    daemon, ledger, clock: { nowMs: () => time }, scheduler, notices,
    runIdClassifier: { isDaemonRunId: ({ runId }) => !runId.startsWith('external:') },
    onError: vi.fn(),
  }, { reconnectDelayMs: 0, maxReconnects: options.maxReconnects ?? 2, checkpointIntervalMs: options.interval ?? 0 });
  return { finalizer, ledger, progress, settlements, timers, tick: (ms: number) => { time += ms; },
    watch: (message: ChatMessage = stub) => finalizer.watch({ principalId: 'p', conversationId: 'c', message }) };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}
const daemonFor = (events: () => Response | Promise<Response>, status: number | null = 200): RunDaemonClient => ({
  openEvents: vi.fn(async () => events()), runStatus: vi.fn(async () => status),
});

describe('run finalizer with host ports', () => {
  it('saves the full answer without a browser, compacting deltas and retaining tool boundaries', async () => {
    const h = harness(daemonFor(() => streamOf(text('Autumn '), text('wind '),
      frame('agent', { type: 'tool_use', id: 't1', name: 'search', input: {} }),
      frame('agent', { type: 'tool_result', toolUseId: 't1', content: '3 results' }),
      text('rattles the gate'), frame('end', { status: 'succeeded', code: 0 }))));
    h.watch(); await h.finalizer.idle({});
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]).toMatchObject({ conversationId: 'c', messageId: 'a1', runId: 'run-1',
      status: 'succeeded', content: 'Autumn wind \n\nrattles the gate', endedAt: 1000 });
    expect(h.settlements[0]?.events).toEqual([
      { kind: 'text', text: 'Autumn wind ' }, { kind: 'tool_use', id: 't1', name: 'search', input: {} },
      { kind: 'tool_result', toolUseId: 't1', content: '3 results', isError: false }, { kind: 'text', text: 'rattles the gate' },
    ]);
  });
  it('keeps partial output and adds the injected notice when status confirms a forgotten run', async () => {
    const h = harness(daemonFor(() => streamOf(text('Half an ans')), 404));
    h.watch(); await h.finalizer.idle({});
    expect(h.settlements[0]).toMatchObject({ status: 'canceled', content: 'Half an ans', events: [{ kind: 'text', text: 'Half an ans' }, notices.interrupted] });
  });
  it('replays from zero exactly once after reconnect and forwards run/principal identity', async () => {
    let n = 0;
    const daemon = daemonFor(() => ++n === 1 ? streamOf(text('First ')) : streamOf(text('First '), text('second'), frame('end', { status: 'succeeded' })));
    const h = harness(daemon); h.watch(); await h.finalizer.idle({});
    expect(h.settlements[0]?.content).toBe('First second');
    expect(h.settlements[0]?.events).toEqual([{ kind: 'text', text: 'First second' }]);
    expect(daemon.openEvents).toHaveBeenNthCalledWith(2, { runId: 'run-1', principalId: 'p' });
  });
  it('leaves an unproven run unsettled after reconnect exhaustion', async () => {
    const daemon = daemonFor(() => streamOf(text('Partial')), null);
    const h = harness(daemon); h.watch(); await h.finalizer.idle({});
    expect(daemon.openEvents).toHaveBeenCalledTimes(3);
    expect(h.settlements).toEqual([]);
    expect(h.progress.at(-1)?.content).toBe('Partial');
    expect(h.finalizer.activeCount({})).toBe(0);
  });
  it('never lets an error frame followed by successful end become a successful settlement', async () => {
    const h = harness(daemonFor(() => streamOf(frame('error', { message: 'refused' }), frame('end', { status: 'succeeded' }))));
    h.watch(); await h.finalizer.idle({}); expect(h.settlements[0]?.status).toBe('failed');
  });
  it('classifies failed, canceled and never-started ends without losing their notices', async () => {
    for (const status of ['failed', 'canceled'] as const) {
      const h = harness(daemonFor(() => streamOf(frame('end', { status }))));
      h.watch(); await h.finalizer.idle({}); expect(h.settlements[0]?.status).toBe(status);
      expect(h.settlements[0]?.events).toEqual(status === 'failed' ? [notices.neverStarted] : [{ kind: 'status', label: notices.canceledLabel, detail: 'exit code none, signal none, resumable no' }]);
    }
  });
  it('ignores user, terminal, missing-status and externally held runs, and deduplicates watches', async () => {
    const s = controllableStream(); const daemon = daemonFor(() => s.response); const h = harness(daemon);
    for (const change of [{ role: 'user' as const }, { runStatus: 'succeeded' as const }, { runId: 'external:r' }]) h.watch({ ...stub, ...change });
    const { runStatus: _status, ...withoutStatus } = stub; h.watch(withoutStatus);
    expect(h.finalizer.activeCount({})).toBe(0);
    h.watch(); h.watch(); expect(h.finalizer.activeCount({})).toBe(1);
    s.push(frame('end', { status: 'succeeded' })); s.close(); await h.finalizer.idle({});
    expect(daemon.openEvents).toHaveBeenCalledTimes(1);
  });
  it('checkpoints a quiet run at the trailing deadline without changing its status', async () => {
    const s = controllableStream(); const h = harness(daemonFor(() => s.response), { interval: 40 }); h.watch();
    s.push(text('Still ')); await until(() => h.progress.length === 1);
    s.push(text('writ')); await until(() => h.timers.size === 1);
    expect(h.progress.map(p => p.content)).toEqual(['Still ']);
    const [handle, timer] = [...h.timers.entries()][0]!;
    expect(timer.delayMs).toBe(40); h.tick(40); h.timers.delete(handle); timer.task();
    await until(() => h.progress.length === 2);
    expect(h.progress.map(p => p.content)).toEqual(['Still ', 'Still writ']); expect(h.settlements).toEqual([]);
    s.push(frame('end', { status: 'succeeded' })); s.close(); await h.finalizer.idle({});
    expect(h.timers.size).toBe(0);
  });
  it('settles without awaiting a blocked checkpoint; the ledger rejects that late checkpoint', async () => {
    const s = controllableStream(); const h = harness(daemonFor(() => s.response));
    let finish!: () => void; let terminal = false; let saved = ''; let checkpointFinished = false;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    h.ledger.checkpoint.mockImplementation(async input => { await blocked; checkpointFinished = true; if (terminal) return false; saved = input.content; return true; });
    h.ledger.settle.mockImplementation(async input => { terminal = true; saved = input.content; return true; });
    h.watch(); s.push(text('Partial')); await until(() => h.ledger.checkpoint.mock.calls.length === 1);
    s.push(text(' answer')); s.push(frame('end', { status: 'succeeded' })); s.close(); await h.finalizer.idle({});
    expect(saved).toBe('Partial answer'); finish(); await until(() => checkpointFinished);
    expect(saved).toBe('Partial answer');
  });
  it('honors a ledger that already settled the row in the browser', async () => {
    const h = harness(daemonFor(() => streamOf(text('Server'), frame('end', { status: 'succeeded' }))));
    const browserContent = 'Browser'; let saved = browserContent;
    let alreadyTerminal = true;
    h.ledger.settle.mockImplementation(async input => {
      if (alreadyTerminal) return false;
      saved = input.content; alreadyTerminal = true; return true;
    });
    h.ledger.checkpoint.mockImplementation(async input => {
      if (alreadyTerminal) return false;
      saved = input.content; return true;
    });
    h.watch(); await h.finalizer.idle({}); expect(saved).toBe(browserContent);
    expect(h.ledger.settle).toHaveBeenCalledOnce();
  });
});

it('reports settlement errors, clears the watch, and tolerates a throwing reporter', async () => {
  const daemon = daemonFor(() => streamOf(frame('end', { status: 'succeeded' })));
  const seen: unknown[] = [];
  const failure = new Error('storage unavailable');
  const f = createAssistantRunFinalizer({ daemon,
    ledger: { checkpoint: async () => true, settle: async () => { throw failure; } },
    clock: { nowMs: () => 1000 },
    scheduler: { schedule: () => ({}), cancel: () => undefined, sleep: async () => undefined },
    runIdClassifier: { isDaemonRunId: () => true }, notices,
    onError: input => { seen.push(input); throw new Error('reporter failed'); },
  });
  f.watch({ principalId: 'p', conversationId: 'c', message: stub }); await f.idle({});
  expect(seen).toEqual([{ operation: 'watch', runId: 'run-1', error: failure }]);
  expect(f.activeCount({})).toBe(0);
});

it('does not reschedule progress after exhaustion while a checkpoint is still pending', async () => {
  const h = harness(daemonFor(() => streamOf(text('A'), text('B')), null), { maxReconnects: 0, interval: 50 });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  h.ledger.checkpoint.mockImplementation(async () => { await blocked; return true; });
  h.watch(); await h.finalizer.idle({});
  expect(h.ledger.checkpoint).toHaveBeenCalledOnce(); expect(h.timers.size).toBe(0);
  release(); await blocked; for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(h.timers.size).toBe(0); expect(h.ledger.checkpoint).toHaveBeenCalledOnce();
});

it('settles split CRLF frames and cancels the finalizer reader at the complete terminal record', async () => {
  let canceled = false;
  const bytes = new TextEncoder().encode((text('café') + frame('end', { status: 'succeeded' })).replace(/\n/g, '\r\n'));
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); },
    cancel() { canceled = true; },
  });
  const h = harness(daemonFor(() => new Response(body)));
  h.watch(); await h.finalizer.idle({});
  expect(h.settlements).toHaveLength(1);
  expect(h.settlements[0]).toMatchObject({ status: 'succeeded', content: 'café', events: [{ kind: 'text', text: 'café' }] });
  expect(canceled).toBe(true); expect(body.locked).toBe(false);
});

it('does not settle a truncated terminal record even when its JSON is complete', async () => {
  const wire = text('Partial') + frame('end', { status: 'succeeded' }).slice(0, -1);
  const h = harness(daemonFor(() => streamOf(wire), null), { maxReconnects: 0 });
  h.watch(); await h.finalizer.idle({});
  expect(h.progress.at(-1)?.content).toBe('Partial');
  expect(h.settlements).toEqual([]);
  expect(h.finalizer.activeCount({})).toBe(0);
});
