import { runAcpDispatch, runPiRpcDispatch } from '../index.js';
import type { ChildProcess } from 'node:child_process';
import type { attachAcpSession, attachPiRpcSession } from '@jini-ai/agent-runtime';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { expect, it, vi } from 'vitest';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import type { RunMessageRelay } from '../message-relay.js';
import { createFakeChild, stopResult, flush } from './r8a-rig.js';
import { agentRuntimeFixture } from './runtime-fixture.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture() {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'native-events' });
  const child = createFakeChild(7300);
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream({ runId: run.id, onEvent: event => { events.push(event); } });
  const input = { runId: run.id, agentId: 'native', child: child as unknown as ChildProcess,
    prompt: 'hello', cwd: '/work', model: 'held-model', imagePaths: [],
    permissionMode: undefined, envFormat: undefined, mcpBridge: null, uploadRoot: undefined };
  const deps = { lifecycle, onCleanupFailure: vi.fn(), cleanupStagedFiles: async () => {}, journal: undefined,
    classifyFailure: undefined, releaseStagedResources: async () => {},
    failBeforeSpawn: async (): Promise<never> => { throw new Error('unexpected spawn failure'); },
    listProcessSnapshots: async () => [], collectProcessTreePids: () => [], stopProcesses: async () => stopResult,
    onPermissionRequest: undefined, identityKind: agentRuntimeFixture().models.identityKind };
  return { lifecycle, child, runId: run.id, events, input, deps };
}

type Rig = Awaited<ReturnType<typeof fixture>>;
function dispatch(kind: 'acp' | 'pi', rig: Rig, attaches: {
  acp: typeof attachAcpSession; pi: typeof attachPiRpcSession;
}) {
  return kind === 'acp'
    ? runAcpDispatch({ input: rig.input, deps: { ...rig.deps, attachAcpSession: attaches.acp } })
    : runPiRpcDispatch({ input: rig.input, deps: { ...rig.deps, attachPiRpcSession: attaches.pi } });
}

function sessions(abort = vi.fn()) {
  return {
    acp: { abort, completedSuccessfully: () => true, hasFatalError: () => false, getDurableSessionId: () => null },
    pi: { abort, hasFatalError: () => true, getLastSessionPath: () => null },
  };
}

// Mutation: snapshot cancelRequested at close and pass the boolean to the async close body.
it.each(['acp', 'pi'] as const)('%s: cancel during close drain reads live cancellation', async kind => {
  const rig = await fixture();
  const gate = deferred();
  const entered = deferred();
  const emit = rig.lifecycle.emit.bind(rig.lifecycle);
  vi.spyOn(rig.lifecycle, 'emit').mockImplementation(async args => {
    if (args.input.event === 'agent' && args.input.data.type === 'status' && args.input.data.label === 'starting_model') {
      entered.resolve(); await gate.promise;
    }
    return emit(args);
  });
  const returned = sessions();
  await dispatch(kind, rig, { acp: () => returned.acp, pi: () => returned.pi });
  await entered.promise;
  rig.child.emit('close', 0, null);
  await rig.lifecycle.cancel({ runId: rig.runId });
  gate.resolve();
  expect((await rig.lifecycle.waitForTerminal({ runId: rig.runId })).state).toBe('cancelled');
  expect(rig.events.at(-1)).toMatchObject({ kind: 'end', payload: { status: 'canceled' } });
});

// Mutations: register close after attach, snapshot controller outcome before drain,
// or register ACP's relay after enqueueing starting_model.
it.each(['acp', 'pi'] as const)('%s: synchronous attach re-entry drains text before its terminal outcome', async kind => {
  const rig = await fixture();
  const returned = sessions();
  let relay: RunMessageRelay | undefined;
  const registerMessageRelay = (value: RunMessageRelay) => {
    relay = value;
    expect(value.enqueue({ id: 'early', text: 'queued first', hasAttachments: false })).toBe('delivered');
  };
  const acp: typeof attachAcpSession = ({ send }) => {
    send({ event: 'agent', payload: { type: 'text_delta', delta: 'visible' } });
    rig.child.emit('close', 0, null);
    expect(relay?.enqueue({ id: 'late', text: 'too late', hasAttachments: false })).toBe('not-running');
    return returned.acp;
  };
  const pi: typeof attachPiRpcSession = ({ send }) => {
    send({ event: 'agent', payload: { type: 'text_delta', delta: 'visible' } });
    rig.child.emit('close', 0, null);
    return returned.pi;
  };
  if (kind === 'acp') await runAcpDispatch({ input: rig.input, deps: { ...rig.deps, registerMessageRelay, attachAcpSession: acp } });
  else await dispatch(kind, rig, { acp, pi });
  expect((await rig.lifecycle.waitForTerminal({ runId: rig.runId })).state).toBe(kind === 'acp' ? 'succeeded' : 'failed');
  const text = rig.events.findIndex(event => event.kind === 'agent' && event.payload.type === 'text_delta');
  expect(text).toBeGreaterThan(-1);
  expect(rig.events.at(-1)?.kind).toBe('end');
  if (kind === 'acp') {
    const receipt = rig.events.findIndex(event => event.kind === 'agent' && event.payload.type === 'user_message');
    const starting = rig.events.findIndex(event => event.kind === 'agent' && event.payload.type === 'status' && event.payload.label === 'starting_model');
    expect(receipt).toBeGreaterThan(-1);
    expect(starting).toBeGreaterThan(receipt);
  }
});

// Mutation: subscribe to cancellation after attach, aborting the returned session on replay.
it.each(['acp', 'pi'] as const)('%s: replays pre-existing cancellation before attach', async kind => {
  const rig = await fixture();
  await rig.lifecycle.cancel({ runId: rig.runId });
  const order: string[] = [];
  rig.deps.listProcessSnapshots = async () => { order.push('snapshot'); return []; };
  const abort = vi.fn();
  const returned = sessions(abort);
  await dispatch(kind, rig, {
    acp: () => { order.push('attach'); return returned.acp; },
    pi: () => { order.push('attach'); return returned.pi; },
  });
  expect(order).toEqual(['snapshot', 'attach']);
  expect(abort).not.toHaveBeenCalled();
  rig.child.emit('close', 0, null);
  expect((await rig.lifecycle.waitForTerminal({ runId: rig.runId })).state).toBe('cancelled');
});

// Mutations: drop the awaited teardown/release, or replace failBeforeSpawn's rejection.
it.each(['acp', 'pi'] as const)('%s: attach failure awaits teardown and release and preserves error identity', async kind => {
  const rig = await fixture();
  const stop = deferred();
  const release = deferred();
  const released = deferred();
  const stopError = new Error('distinct tree stop sentinel');
  const failure = new Error('failBeforeSpawn sentinel');
  const order: string[] = [];
  rig.deps.onCleanupFailure.mockImplementation(() => { order.push('report'); });
  rig.child.kill = vi.fn(() => { order.push('kill'); return true; });
  rig.deps.stopProcesses = async () => { order.push('stop'); await stop.promise; return stopResult; };
  rig.deps.releaseStagedResources = async () => { order.push('release'); released.resolve(); await release.promise; };
  const failBeforeSpawn = vi.fn(async (_args: { runId: string; code: string; message: string }): Promise<never> => {
    order.push('fail'); throw failure;
  });
  const deps = { ...rig.deps, failBeforeSpawn };
  const attach = () => { throw new Error('original attach message'); };
  const pending = kind === 'acp'
    ? runAcpDispatch({ input: rig.input, deps: { ...deps, attachAcpSession: attach } })
    : runPiRpcDispatch({ input: rig.input, deps: { ...deps, attachPiRpcSession: attach } });
  const rejection = pending.catch(error => error);
  await flush();
  expect(order).toEqual(['stop']);
  expect(failBeforeSpawn).not.toHaveBeenCalled();
  stop.reject(stopError);
  await released.promise;
  expect(rig.deps.onCleanupFailure).toHaveBeenCalledWith({ runId: rig.runId, pid: 7300,
    phase: kind === 'acp' ? 'acp-attach-failure' : 'pi-rpc-attach-failure', error: stopError });
  expect(rig.deps.onCleanupFailure.mock.calls[0]![0].error).toBe(stopError);
  expect(order).toEqual(['stop', 'report', 'kill', 'release']);
  expect(failBeforeSpawn).not.toHaveBeenCalled();
  release.resolve();
  expect(await rejection).toBe(failure);
  expect(order).toEqual(['stop', 'report', 'kill', 'release', 'fail']);
  expect(failBeforeSpawn).toHaveBeenCalledWith({ runId: rig.runId, code: 'AGENT_SPAWN_FAILED',
    message: `AgentExecutor: could not attach ${kind === 'acp' ? 'ACP' : 'pi-rpc'} session for agent "native": original attach message` });
  rig.child.emit('close', 0, null);
  await rig.lifecycle.waitForTerminal({ runId: rig.runId });
});

it('ACP reports failure to stop recorded descendants without rewriting the completed run outcome', async () => {
  const rig = await fixture();
  const failure = new Error('process group could not be stopped');
  const processes = [{ pid: 7301, ppid: 7300, command: 'worker' }, { pid: 7302, ppid: 7301, command: 'child' }];
  type AcpDeps = Parameters<typeof runAcpDispatch>[0]['deps'];
  const stop = vi.fn<AcpDeps['stopProcesses']>(async () => { throw failure; });
  const collect = vi.fn<AcpDeps['collectProcessTreePids']>(() => [7301, 7302]);
  let beforeRelease: (() => Promise<void>) | undefined;
  await runAcpDispatch({ input: rig.input, deps: { ...rig.deps,
    listProcessSnapshots: async () => processes, collectProcessTreePids: collect, stopProcesses: stop,
    attachAcpSession: ({ send }, options) => {
      beforeRelease = options?.beforeRelease;
      send({ event: 'agent', payload: { type: 'text_delta', delta: 'completed document' } });
      return sessions().acp;
    },
  } });
  if (!beforeRelease) throw new Error('ACP session did not receive a beforeRelease hook');
  await beforeRelease();
  rig.child.emit('close', 0, null);
  expect((await rig.lifecycle.waitForTerminal({ runId: rig.runId })).state).toBe('succeeded');
  expect(collect.mock.calls).toEqual([[{ processes, rootPids: [7300] }]]);
  expect(stop.mock.calls).toEqual([[{ pids: [7301, 7302] }]]);
  expect(rig.deps.onCleanupFailure.mock.calls).toEqual([[{ runId: rig.runId, phase: 'acp-release', pid: 7300, error: failure }]]);
});
