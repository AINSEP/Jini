import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import type { RunDaemonClient, RunLedger, RunProgress, RunSettlement, Scheduler } from '../ports.js';
import { createAssistantRunFinalizer, type AssistantRunFinalizerArgs } from '../entry.js';
import { notices } from '../../../core/run-events/__tests__/fixture.js';

const frame = (kind: string, payload: unknown) => `event: ${kind}\ndata: ${JSON.stringify({ runId: 'run-1', kind, payload })}\n\n`;
const text = (delta: string) => frame('agent', { type: 'text_delta', delta });
const message: ChatMessage = { id: 'a1', role: 'assistant', content: '', runId: 'run-1', runStatus: 'running' };

interface Setup {
  readonly open: () => Promise<Response>;
  readonly status?: number | null;
  readonly checkpoint?: RunLedger['checkpoint'];
  readonly maxReconnects?: number;
  readonly interval?: number;
  readonly clock?: { nowMs(): number };
}

function setup({ open, status = null, checkpoint, maxReconnects = 0, interval = 0, clock = { nowMs: () => 1_000 } }: Setup) {
  const settlements: RunSettlement[] = [];
  const progress: RunProgress[] = [];
  const errors: Parameters<AssistantRunFinalizerArgs['onError']>[0][] = [];
  const statusQueries: string[] = [];
  const sleeps: number[] = [];
  const canceled: unknown[] = [];
  const scheduled: { handle: object; task: () => void; delayMs: number }[] = [];
  const daemon: RunDaemonClient = { openEvents: open, runStatus: async ({ runId }) => { statusQueries.push(runId); return status; } };
  const scheduler: Scheduler = {
    schedule: ({ task, delayMs }) => { const handle = {}; scheduled.push({ handle, task, delayMs }); return handle; },
    cancel: ({ handle }) => { canceled.push(handle); },
    sleep: async ({ delayMs }) => { sleeps.push(delayMs); },
  };
  const ledger: RunLedger = {
    checkpoint: checkpoint ?? (async (input) => { progress.push(input); return true; }),
    settle: async (input) => { settlements.push(input); return true; },
  };
  const finalizer = createAssistantRunFinalizer({
    daemon, ledger, scheduler, notices, clock,
    runIdClassifier: { isDaemonRunId: () => true }, onError: (input) => { errors.push(input); },
  }, { reconnectDelayMs: 7, maxReconnects, checkpointIntervalMs: interval });
  const run = async () => { finalizer.watch({ principalId: 'p', conversationId: 'c', message }); await finalizer.idle({}); };
  return { run, finalizer, settlements, progress, errors, statusQueries, sleeps, canceled, scheduled };
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}

function trackedBody(chunks: string[] = [], { open = false }: { open?: boolean } = {}) {
  const state = { canceled: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); if (!open) controller.close(); },
    cancel() { state.canceled = true; },
  });
  return { body, state };
}

describe('run finalizer boundaries: unusable event streams', () => {
  it('settles a 404 stream as interrupted without asking the run status', async () => {
    const { body, state } = trackedBody([], { open: true });
    const h = setup({ open: async () => new Response(body, { status: 404 }) });
    await h.run();
    expect(h.statusQueries).toEqual([]);
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]).toMatchObject({ status: 'canceled', events: [notices.interrupted] });
    expect(state.canceled).toBe(true);
  });

  it('cancels a non-success body and treats it as a dropped connection', async () => {
    const { body, state } = trackedBody([], { open: true });
    const h = setup({ open: async () => new Response(body, { status: 503 }) });
    await h.run();
    expect(state.canceled).toBe(true);
    expect(h.statusQueries).toEqual(['run-1']);
    expect(h.settlements).toEqual([]);
  });

  it('treats a successful response without a body as dropped', async () => {
    const h = setup({ open: async () => new Response(null, { status: 200 }) });
    await h.run();
    expect(h.statusQueries).toEqual(['run-1']);
    expect(h.settlements).toEqual([]);
  });

  it('tolerates a body whose cancel rejects', async () => {
    const body = new ReadableStream<Uint8Array>({ cancel() { throw new Error('already gone'); } });
    const h = setup({ open: async () => new Response(body, { status: 500 }) });
    await h.run();
    expect(h.errors).toEqual([]);
    expect(h.settlements).toEqual([]);
  });

  it('treats a rejected openEvents as dropped and sleeps the reconnect delay', async () => {
    let opens = 0;
    const h = setup({ maxReconnects: 1, open: async () => { opens += 1; throw new Error('connection refused'); } });
    await h.run();
    expect(opens).toBe(2);
    expect(h.sleeps).toEqual([7, 7]);
    expect(h.errors).toEqual([]);
  });

  it('settles as interrupted when the status check confirms the run is gone', async () => {
    const h = setup({ status: 404, open: async () => new Response(null, { status: 502 }) });
    await h.run();
    expect(h.settlements[0]).toMatchObject({ status: 'canceled', events: [notices.interrupted] });
    expect(h.sleeps).toEqual([]);
  });
});

describe('run finalizer boundaries: terminal frames', () => {
  it('settles a canceled end even after an error frame', async () => {
    const { body } = trackedBody([frame('error', { message: 'refused' }), frame('end', { status: 'canceled' })]);
    const h = setup({ open: async () => new Response(body) });
    await h.run();
    expect(h.settlements[0]?.status).toBe('canceled');
  });

  it('cancels a pending trailing checkpoint when the run settles', async () => {
    const { body } = trackedBody([text('A'), text('B'), frame('end', { status: 'succeeded' })]);
    const h = setup({ interval: 1_000_000, open: async () => new Response(body) });
    await h.run();
    expect(h.progress).toHaveLength(1);
    expect(h.scheduled).toHaveLength(1);
    expect(h.canceled).toEqual([h.scheduled[0]!.handle]);
    expect(h.settlements[0]?.content).toBe('AB');
  });
});

describe('run finalizer boundaries: checkpoints', () => {
  it('reports a rejected checkpoint without stopping the watch', async () => {
    const failure = new Error('disk full');
    const { body } = trackedBody([text('A'), frame('end', { status: 'succeeded' })]);
    const h = setup({ open: async () => new Response(body), checkpoint: async () => { throw failure; } });
    await h.run();
    expect(h.errors).toEqual([{ operation: 'checkpoint', runId: 'run-1', error: failure }]);
    expect(h.settlements[0]?.status).toBe('succeeded');
  });

  it('schedules a single trailing timer while the interval has not elapsed', async () => {
    const { body } = trackedBody([text('A'), text('B'), text('C')]);
    const h = setup({ interval: 1_000_000, open: async () => new Response(body) });
    await h.run();
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]!.delayMs).toBe(1_000_000);
  });

  it('replaces the trailing timer with an immediate checkpoint once the interval elapses', async () => {
    let time = 1_000;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
    const push = (chunk: string) => controller.enqueue(new TextEncoder().encode(chunk));
    const h = setup({ interval: 40, clock: { nowMs: () => time }, open: async () => new Response(body) });
    const done = h.run();
    push(text('A')); await until(() => h.progress.length === 1);
    push(text('B')); await until(() => h.scheduled.length === 1);
    time += 40;
    push(text('C')); await until(() => h.progress.length === 2);
    expect(h.canceled).toEqual([h.scheduled[0]!.handle]);
    expect(h.progress.map((p) => p.content)).toEqual(['A', 'ABC']);
    push(frame('end', { status: 'succeeded' })); controller.close(); await done;
  });

  it('uses the documented defaults when no options are passed', async () => {
    const sleeps: number[] = [];
    let opens = 0;
    const finalizer = createAssistantRunFinalizer({
      daemon: { openEvents: async () => { opens += 1; return new Response(null, { status: 500 }); }, runStatus: async () => null },
      ledger: { checkpoint: async () => true, settle: async () => true },
      scheduler: { schedule: () => ({}), cancel: () => {}, sleep: async ({ delayMs }) => { sleeps.push(delayMs); } },
      clock: { nowMs: () => 0 }, notices, runIdClassifier: { isDaemonRunId: () => true }, onError: () => {},
    });
    finalizer.watch({ principalId: 'p', conversationId: 'c', message });
    await finalizer.idle({});
    expect(opens).toBe(31);
    expect(new Set(sleeps)).toEqual(new Set([2_000]));
  });
});
