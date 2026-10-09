import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { AgentLaunchResolution, RuntimeAgentDef } from '@jini-ai/agent-runtime';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createAgentExecutor } from '../../index.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

/**
 * A message the human sends while a run is going must reach the live agent, not wait for the run
 * to end. A stream-json stdin agent (Claude Code) takes it as one more user line on the open stdin
 * — the CLI folds it into the running turn. Every other agent reports `'unsupported'` so the host
 * can interrupt and resume instead; a run with no live process reports `'not-running'`.
 */

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { writes: string[]; ended: boolean; write: (chunk: string) => boolean; end: () => void };
  kill: () => boolean;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const stdin = new EventEmitter() as FakeChild['stdin'];
  stdin.writes = [];
  stdin.ended = false;
  stdin.write = (chunk: string) => { stdin.writes.push(String(chunk)); return true; };
  stdin.end = () => { stdin.ended = true; };
  child.stdin = stdin;
  child.kill = () => true;
  return child;
}

function createDef(overrides: Partial<RuntimeAgentDef>): RuntimeAgentDef {
  return {
    ...fixtureModelDiscovery,
    id: 'fake-agent', name: 'Fake Agent', bin: 'fake-bin', versionArgs: ['--version'], fallbackModels: [],
    buildArgs: () => [], streamFormat: 'claude-stream-json', promptViaStdin: true, promptInputFormat: 'stream-json',
    ...overrides,
  };
}

function createHarness(def: RuntimeAgentDef) {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const child = createFakeChild();
  const spawn = (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as unknown as typeof nodeSpawn;
  const executor = createAgentExecutor({ lifecycle }, {
    resolveModelForLaunch: fixtureLaunchModel,
    getAgentDef: ({ id }) => (id === def.id ? def : null),
    resolveAgentLaunch: () => ({ selectedPath: '/fake/bin', pathResolvedPath: '/fake/bin', configuredOverridePath: null, launchPath: '/fake/bin', launchKind: 'selected', childPathPrepend: [], diagnostic: null }) as AgentLaunchResolution,
    applyAgentLaunchEnv: ({ env }) => env,
    spawn,
    listProcessSnapshots: async () => [],
    stopProcesses: async () => ({ alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }),
    onCleanupFailure: vi.fn(),
  });
  return { lifecycle, executor, child };
}

async function startRun(harness: ReturnType<typeof createHarness>): Promise<string> {
  const { run } = await harness.lifecycle.start({ contextRef: 'ctx' });
  await harness.executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'first', cwd: '/work' });
  return run.id;
}

async function agentPayloads(harness: ReturnType<typeof createHarness>, runId: string): Promise<unknown[]> {
  const events: RunProtocolEvent[] = [];
  const subscribed = await harness.lifecycle.stream({ runId, onEvent: (event) => events.push(event) });
  if (subscribed.kind === 'ok') subscribed.unsubscribe();
  return events.filter((event) => event.kind === 'agent').map((event) => event.payload);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AgentExecutor.sendUserMessage — a message sent during a run reaches the live agent', () => {
  it('writes the message to a stream-json agent\'s open stdin and records it in the run', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);

    expect(harness.executor.sendUserMessage({ runId, text: 'also check the footer' })).toBe('delivered');
    await flush();

    expect(harness.child.stdin.writes.map((line) => JSON.parse(line))).toEqual([
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'first' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'also check the footer' }] } },
    ]);
    expect(harness.child.stdin.ended).toBe(false);
    const userMessages = (await agentPayloads(harness, runId)).filter((payload) => (payload as { type?: string }).type === 'user_message');
    expect(userMessages).toEqual([{ type: 'user_message', id: expect.any(String), text: 'also check the footer' }]);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports not-running once the turn ended and stdin closed, and writes nothing', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(true);

    expect(harness.executor.sendUserMessage({ runId, text: 'too late' })).toBe('not-running');
    expect(harness.child.stdin.writes).toHaveLength(1);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports unsupported for a live agent that takes its prompt as plain text', async () => {
    const harness = createHarness(createDef({ streamFormat: 'json-event-stream', eventParser: 'codex', promptInputFormat: 'text' }));
    const runId = await startRun(harness);

    expect(harness.executor.sendUserMessage({ runId, text: 'steer' })).toBe('unsupported');
    expect(harness.child.stdin.writes).toEqual(['first']);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports not-running for an unknown run and for a run whose process has exited', async () => {
    const harness = createHarness(createDef({}));
    expect(harness.executor.sendUserMessage({ runId: 'no-such-run', text: 'hello' })).toBe('not-running');

    const runId = await startRun(harness);
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
    expect(harness.executor.sendUserMessage({ runId, text: 'hello' })).toBe('not-running');
  });
});
