import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle, type DriverEmittableInput, type RunLifecycle } from '../../run-lifecycle.js';
import { observeRunOutput } from '../run-output.js';

async function startRun(): Promise<{ lifecycle: RunLifecycle; runId: string }> {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'run-output' });
  return { lifecycle, runId: run.id };
}

async function emitAll(lifecycle: RunLifecycle, runId: string, inputs: readonly DriverEmittableInput[]): Promise<void> {
  for (const input of inputs) await lifecycle.emit({ runId, input });
}

async function errorMessages(lifecycle: RunLifecycle, runId: string): Promise<string[]> {
  const messages: string[] = [];
  await lifecycle.stream({ runId, onEvent: event => { if (event.kind === 'error') messages.push(event.payload.message); } });
  return messages;
}

const text = (delta: string): DriverEmittableInput => ({ event: 'agent', data: { type: 'text_delta', delta } });
const stderr = (chunk: string): DriverEmittableInput => ({ event: 'stderr', data: { chunk } });
const stdout = (chunk: string): DriverEmittableInput => ({ event: 'stdout', data: { chunk } });

afterEach(() => { vi.restoreAllMocks(); });

describe('observeRunOutput settle', () => {
  it('keeps a success that produced assistant text', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [text('hello')]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('succeeded');
    expect(await errorMessages(lifecycle, runId)).toEqual([]);
  });

  it('keeps a success that only used a tool', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [{ event: 'agent', data: { type: 'tool_result', toolUseId: 't1', content: 'done' } }]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('succeeded');
  });

  it('fails a success whose only text is whitespace and tells the user to retry', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [text('   \n')]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('failed');
    expect(await errorMessages(lifecycle, runId)).toEqual(['Fixture returned no assistant text or tool activity. Please retry.']);
  });

  it('fails a success that also reported an error event', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [text('partial'), { event: 'error', data: { message: 'upstream broke' } }]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('failed');
    expect(await errorMessages(lifecycle, runId)).toEqual(['upstream broke', 'Fixture ended with an error.']);
  });

  it('leaves a cancelled run cancelled even with a failure diagnostic', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [stderr('error: no output produced.\n')]);
    expect(await guard.settle({ status: 'cancelled' })).toBe('cancelled');
    expect(await errorMessages(lifecycle, runId)).toEqual([]);
  });

  it('leaves an ordinary failure alone when no diagnostic was seen', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    expect(await guard.settle({ status: 'failed' })).toBe('failed');
    expect(await errorMessages(lifecycle, runId)).toEqual([]);
  });

  it('explains a failure with the no-output diagnostic line from stderr', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [stderr('booting\r\njetski: no output produced — gave up\n')]);
    expect(await guard.settle({ status: 'failed' })).toBe('failed');
    expect(await errorMessages(lifecycle, runId)).toEqual(['Fixture failed: no output produced. jetski: no output produced — gave up']);
  });

  it('overrides real text when stderr shows a headless permission denial', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [text('working'), stderr('agy: permission denied for mcp in headless mode\n')]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('failed');
    expect(await errorMessages(lifecycle, runId)).toEqual(['Fixture failed: permission denied in headless mode. agy: permission denied for mcp in headless mode']);
  });

  it('ignores a diagnostic split across two stderr chunks until it is whole', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [text('ok'), stderr('fatal: headless'), stderr(' call was auto-denied\n')]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('failed');
    expect(await errorMessages(lifecycle, runId)).toEqual(['Fixture failed: permission denied in headless mode. fatal: headless call was auto-denied']);
  });

  it('does not treat an assistant explanation of the error text as a diagnostic', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [text('ok'), stderr('Note: no output produced — just explaining\n')]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('succeeded');
  });

  it('ignores stdout diagnostics unless the agent streams plain stdout', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [text('ok'), stdout('error: no output produced.\n')]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('succeeded');
  });

  it('reads stdout diagnostics for a plain-stdout agent', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' }, { plainStdout: true });
    await emitAll(lifecycle, runId, [stdout('ok\nerror: no output produced.\n')]);
    expect(await guard.settle({ status: 'succeeded' })).toBe('failed');
    expect(await errorMessages(lifecycle, runId)).toEqual(['Fixture failed: no output produced. error: no output produced.']);
  });

  it('caps the emitted message at 1200 characters', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await emitAll(lifecycle, runId, [stderr(`error: no output produced: ${'x'.repeat(3000)}\n`)]);
    await guard.settle({ status: 'failed' });
    const [message = ''] = await errorMessages(lifecycle, runId);
    expect(message).toHaveLength(1200);
    expect(message.startsWith('Fixture failed: no output produced. error: no output produced: xxx')).toBe(true);
  });

  it('still returns failed when the run was already settled and the error cannot be recorded', async () => {
    const { lifecycle, runId } = await startRun();
    const guard = observeRunOutput({ lifecycle, runId, agentName: 'Fixture' });
    await lifecycle.finish({ runId, status: 'succeeded', code: 0, signal: null, resumable: false });
    expect(await guard.settle({ status: 'succeeded' })).toBe('failed');
    expect(await errorMessages(lifecycle, runId)).toEqual([]);
  });
});

describe('observeRunOutput without an observer', () => {
  it('keeps the real outcome and warns when the event stream cannot be opened', async () => {
    const { lifecycle, runId } = await startRun();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: RunLifecycle = { ...lifecycle, stream: async () => { throw new Error('log offline'); } };
    const guard = observeRunOutput({ lifecycle: broken, runId, agentName: 'Fixture' });
    expect(await guard.settle({ status: 'succeeded' })).toBe('succeeded');
    expect(warn).toHaveBeenCalledWith(`[@jini-ai/daemon] agent-executor: output observer unavailable for run "${runId}"`, 'log offline');
    expect(await errorMessages(lifecycle, runId)).toEqual([]);
  });

  it('warns with a non-Error rejection as text', async () => {
    const { lifecycle, runId } = await startRun();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: RunLifecycle = { ...lifecycle, stream: () => Promise.reject('plain reason') };
    await observeRunOutput({ lifecycle: broken, runId, agentName: 'Fixture' }).settle({ status: 'succeeded' });
    expect(warn).toHaveBeenCalledWith(expect.any(String), 'plain reason');
  });

  it('keeps the real outcome when the stream reports a replay gap', async () => {
    const { lifecycle, runId } = await startRun();
    const broken: RunLifecycle = { ...lifecycle, stream: async () => ({ kind: 'replay-gap', requestedCursor: '9', oldestAvailableCursor: '1' } as const) };
    expect(await observeRunOutput({ lifecycle: broken, runId, agentName: 'Fixture' }).settle({ status: 'succeeded' })).toBe('succeeded');
  });
});
