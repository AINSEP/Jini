import { wireChildLifecycle } from '../child-lifecycle.js';
import type { ChildProcess } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { delegatedResultMarker } from '@jini-ai/protocol';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import type { ToolExecutionResult } from '../../tool-executor-types.js';
import { createFakeChild, createDef, stopResult, flush } from './r8a-rig.js';
import { agentRuntimeFixture } from './runtime-fixture.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(overrides: Partial<Parameters<typeof wireChildLifecycle>[0]> = {}) {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'child-events' });
  const child = createFakeChild(7100);
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream({ runId: run.id, onEvent: event => { events.push(event); } });
  const ctx: Parameters<typeof wireChildLifecycle>[0] = {
    runId: run.id, lifecycle, child: child as unknown as ChildProcess,
    streams: agentRuntimeFixture().streams, strategies: agentRuntimeFixture().strategies, identityKind: agentRuntimeFixture().models.identityKind,
    def: createDef({ streamFormat: 'claude-stream-json', promptInputFormat: 'stream-json' }),
    streamFormat: 'claude-stream-json', onCleanupFailure: vi.fn(), cleanupStagedFiles: async () => {},
    journal: undefined, continuation: undefined, classifyFailure: undefined,
    bufferedStdoutMaxBytes: 1024, expectsJiniBridge: false, bridgeProbeEntry: undefined,
    probeMcpBridge: vi.fn(), listProcessSnapshots: async () => [],
    collectProcessTreePids: () => [], stopProcesses: async () => stopResult, ...overrides,
  };
  return { ctx, child, lifecycle, runId: run.id, events };
}

// Mutation: snapshot cancelRequested when close fires instead of reading the live state after drain.
it('child: cancel during close drain cancels the run and pairs unresolved tools', async () => {
  const rig = await fixture({ startingModel: 'held-model' });
  const gate = deferred();
  const entered = deferred();
  const emit = rig.lifecycle.emit.bind(rig.lifecycle);
  vi.spyOn(rig.lifecycle, 'emit').mockImplementation(async args => {
    if (args.input.event === 'agent' && args.input.data.type === 'status' && args.input.data.label === 'starting_model') {
      entered.resolve(); await gate.promise;
    }
    return emit(args);
  });
  wireChildLifecycle(rig.ctx);
  rig.child.stdout.emit('data', JSON.stringify({ type: 'assistant', message: {
    id: 'm', content: [{ type: 'tool_use', id: 'unresolved', name: 'Bash', input: {} }],
  } }) + '\n');
  await entered.promise;
  rig.child.emit('close', 0, null);
  await rig.lifecycle.cancel({ runId: rig.runId });
  gate.resolve();
  expect((await rig.lifecycle.waitForTerminal({ runId: rig.runId })).state).toBe('cancelled');
  expect(rig.events).toContainEqual(expect.objectContaining({ kind: 'agent', payload: {
    type: 'tool_result', toolUseId: 'unresolved', content: 'Tool execution cancelled.', isError: true,
  } }));
  expect(rig.events.at(-1)).toMatchObject({ kind: 'end', payload: { status: 'canceled' } });
});

// Mutations: read child.pid or compute projectEcho before enqueueing its task.
it('reads PID and delegated echo projection only when their FIFO tasks execute', async () => {
  let matches = false;
  const rig = await fixture({ startingModel: 'held-model', delegatedResultCorrelation: {
    record() {}, matches: () => matches, clearRun() {},
  } });
  const gate = deferred();
  const entered = deferred();
  const emit = rig.lifecycle.emit.bind(rig.lifecycle);
  vi.spyOn(rig.lifecycle, 'emit').mockImplementation(async args => {
    if (args.input.event === 'agent' && args.input.data.type === 'status' && args.input.data.label === 'starting_model') {
      entered.resolve(); await gate.promise;
    }
    return emit(args);
  });
  wireChildLifecycle(rig.ctx);
  await entered.promise;
  rig.child.stdout.emit('data', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session' }) + '\n');
  rig.child.stdout.emit('data', JSON.stringify({ type: 'user', message: { content: [{
    type: 'tool_result', tool_use_id: 'C', content: [delegatedResultMarker({ toolUseId: 'B' }), { type: 'text', text: 'result' }],
  }] } }) + '\n');
  rig.child.pid = 7200;
  matches = true;
  rig.child.emit('close', 0, null);
  gate.resolve();
  await rig.lifecycle.waitForTerminal({ runId: rig.runId });
  const init = rig.events.findIndex(event => event.kind === 'agent' && event.payload.type === 'status' && event.payload.label === 'initializing');
  const echo = rig.events.findIndex(event => event.kind === 'agent' && event.payload.type === 'tool_result');
  expect(rig.events[init]).toMatchObject({ payload: { childPid: 7200 } });
  expect(rig.events[echo]).toMatchObject({ payload: { content: 'Result shown by delegated call B.' } });
  expect(init).toBeGreaterThan(-1);
  expect(echo).toBeGreaterThan(init);
  expect(rig.events.at(-1)?.kind).toBe('end');
});

// Mutation: capture the queue tail before flushBufferedStdout.
it('journals raw bytes and flushes sanitized stdout before reading the close FIFO tail', async () => {
  const record = vi.fn(async () => {});
  const rig = await fixture({ streamFormat: 'plain', def: createDef({ stdoutPolicy: {
    buffering: 'until-close', sanitize: ({ fullText }) => fullText.replace('private', 'safe'),
  } }), journal: { record, read: async () => [] } });
  const gate = deferred();
  const entered = deferred();
  const emit = rig.lifecycle.emit.bind(rig.lifecycle);
  vi.spyOn(rig.lifecycle, 'emit').mockImplementation(async args => {
    if (args.input.event === 'stdout') { entered.resolve(); await gate.promise; }
    return emit(args);
  });
  const finish = vi.spyOn(rig.lifecycle, 'finish');
  wireChildLifecycle(rig.ctx);
  rig.child.stdout.emit('data', 'private');
  rig.child.emit('close', 0, null);
  await entered.promise;
  await flush();
  expect(record).toHaveBeenCalledWith({ runId: rig.runId, entry: {
    content: 'private', provenance: { source: 'agent', channel: 'stdout' }, trust: 'untrusted',
  } });
  expect(finish).not.toHaveBeenCalled();
  gate.resolve();
  await rig.lifecycle.waitForTerminal({ runId: rig.runId });
  expect(rig.events.filter(event => ['stdout', 'agent', 'end'].includes(event.kind))).toMatchObject([
    { kind: 'stdout', payload: { chunk: 'safe' } },
    { kind: 'agent', payload: { type: 'text_delta', delta: 'safe' } },
    { kind: 'end' },
  ]);
});

// Mutations: remove finally/resume or inject stdin before awaiting the result append.
it('resumes the watchdog after tool rejection and persists the error before injecting stdin', async () => {
  const tool = deferred<ToolExecutionResult>();
  const entered = deferred();
  const gate = deferred();
  const order: string[] = [];
  const rig = await fixture({ continuation: { principal: { id: 'test' }, autonomousToolNames: new Set(['Bash']),
    toolExecutor: {
      execute: async () => { order.push('execute'); return tool.promise; },
      resumeConfirmation() {}, cancel() {}, getAuditRecord: () => null,
    },
  } });
  vi.spyOn(rig.lifecycle, 'suspendSlowRunNotice').mockImplementation(() => { order.push('suspend'); });
  vi.spyOn(rig.lifecycle, 'resumeSlowRunNotice').mockImplementation(() => { order.push('resume'); });
  const emit = rig.lifecycle.emit.bind(rig.lifecycle);
  vi.spyOn(rig.lifecycle, 'emit').mockImplementation(async args => {
    if (args.input.event === 'agent' && args.input.data.type === 'tool_result') {
      order.push('append'); entered.resolve(); await gate.promise;
    }
    return emit(args);
  });
  const write = vi.fn((_line: string) => { order.push('write'); return true; });
  Object.assign(rig.child.stdin, { write });
  wireChildLifecycle(rig.ctx);
  rig.child.stdout.emit('data', JSON.stringify({ type: 'assistant', message: {
    id: 'm1', content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } }], stop_reason: 'tool_use',
  } }) + '\n');
  await flush();
  expect(order).toEqual(['suspend', 'execute']);
  tool.reject(new Error('tool rejected'));
  await entered.promise;
  expect(order).toEqual(['suspend', 'execute', 'resume', 'append']);
  expect(write).not.toHaveBeenCalled();
  gate.resolve();
  await flush();
  expect(order).toEqual(['suspend', 'execute', 'resume', 'append', 'write']);
  expect(write).toHaveBeenCalledTimes(1);
  expect(JSON.parse(write.mock.calls[0]![0])).toMatchObject({ type: 'user', message: {
    content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'tool rejected', is_error: true }],
  } });
  rig.child.emit('close', 0, null);
  await rig.lifecycle.waitForTerminal({ runId: rig.runId });
});

it('parses the final complete Claude event even without a newline before process close', async () => {
  const rig = await fixture({ def: createDef({
    streamFormat: 'claude-stream-json', promptViaStdin: true, promptInputFormat: 'stream-json',
  }) });
  wireChildLifecycle(rig.ctx);
  const text = 'whole final reply';
  const packet = JSON.stringify({ type: 'assistant', message: { id: 'last', content: [{ type: 'text', text }] } });
  rig.child.stdout.emit('data', packet.slice(0, 17));
  rig.child.stdout.emit('data', packet.slice(17));
  rig.child.emit('close', 0, null);
  expect((await rig.lifecycle.waitForTerminal({ runId: rig.runId })).state).toBe('succeeded');
  expect(rig.events.filter(event => event.kind === 'agent' && event.payload.type === 'text_delta').map(event => event.payload))
    .toEqual([{ type: 'text_delta', delta: text }]);
  expect(rig.events.at(-1)?.kind).toBe('end');
});

it('reports structured stdout truncation even if the sanitizer produces no parser output', async () => {
  const rig = await fixture({ bufferedStdoutMaxBytes: 4, def: createDef({
    streamFormat: 'claude-stream-json', stdoutPolicy: { buffering: 'until-close', sanitize: () => '' },
  }) });
  wireChildLifecycle(rig.ctx);
  rig.child.stdout.emit('data', '1234');
  rig.child.stdout.emit('data', 'discarded');
  rig.child.emit('close', 0, null);
  await rig.lifecycle.waitForTerminal({ runId: rig.runId });
  expect(rig.events.filter(event => event.kind === 'error').map(event => event.payload)).toContainEqual({
    message: '\n[jini] agent stdout truncated: 9 byte(s) dropped after the 4-byte buffer limit was reached.\n',
  });
  expect(rig.events.filter(event => event.kind === 'stdout')).toEqual([]);
});

it('reports a failed tool-event subscription without stranding the child lifecycle', async () => {
  const rig = await fixture();
  const failure = new Error('event replay failed');
  const stream = vi.spyOn(rig.lifecycle, 'stream').mockRejectedValueOnce(failure);
  wireChildLifecycle(rig.ctx);
  rig.child.stdout.emit('data', JSON.stringify({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'done' }] } }) + '\n');
  rig.child.emit('close', 0, null);
  expect((await rig.lifecycle.waitForTerminal({ runId: rig.runId })).state).toBe('succeeded');
  expect(stream.mock.calls[0]?.[0]).toEqual({ runId: rig.runId, onEvent: expect.any(Function) });
  expect(rig.ctx.onCleanupFailure).toHaveBeenCalledExactlyOnceWith({ runId: rig.runId, phase: 'tool-cancellation', pid: 7100, error: failure });
  expect(rig.events.at(-1)).toMatchObject({ kind: 'end', payload: { status: 'succeeded' } });
});
