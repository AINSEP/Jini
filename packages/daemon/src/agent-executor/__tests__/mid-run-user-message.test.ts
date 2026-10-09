import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { AgentLaunchResolution, RuntimeAgentDef } from '@jini-ai/agent-runtime';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createAgentExecutor } from '../../index.js';
import { INTERRUPT_ACK_TIMEOUT_MS } from '../events.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

/**
 * A message the human sends while a run is going must reach the live agent, not wait for the run
 * to end. A stream-json stdin agent (Claude Code) is first sent an `interrupt` control request —
 * the CLI stops generating at once — and, once the CLI acknowledges it, the message goes in as the
 * next user line, so the agent answers it straight away in the same session. Every other agent
 * reports `'unsupported'` so the host can interrupt and resume instead; a run with no live process
 * reports `'not-running'`.
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

/** Claude Code's acknowledgement of a control request, as it prints it on stdout. */
function controlResponse(requestId: string): unknown {
  return { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { still_queued: [] } } };
}

describe('AgentExecutor.sendUserMessage — a message sent during a run reaches the live agent', () => {
  it('interrupts the running turn first and writes the message only once the CLI acknowledges the interrupt', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);

    const delivery = harness.executor.sendUserMessage({ runId, text: 'also check the footer' });
    await flush();
    const interrupt = JSON.parse(harness.child.stdin.writes[1]!);
    expect(interrupt).toEqual({ type: 'control_request', request_id: expect.any(String), request: { subtype: 'interrupt' } });
    expect(harness.child.stdin.writes).toHaveLength(2);

    harness.child.stdout.emit('data', `${JSON.stringify(controlResponse('some-other-request'))}\n`);
    await flush();
    expect(harness.child.stdin.writes).toHaveLength(2);

    harness.child.stdout.emit('data', `${JSON.stringify(controlResponse(interrupt.request_id))}\n`);
    await expect(delivery).resolves.toBe('delivered');

    expect(harness.child.stdin.writes.slice(2).map((line) => JSON.parse(line))).toEqual([
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'also check the footer' }] } },
    ]);
    expect(harness.child.stdin.ended).toBe(false);
    const userMessages = (await agentPayloads(harness, runId)).filter((payload) => (payload as { type?: string }).type === 'user_message');
    expect(userMessages).toEqual([{ type: 'user_message', id: expect.any(String), text: 'also check the footer' }]);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('matches an acknowledgement split across stdout chunks', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);

    const delivery = harness.executor.sendUserMessage({ runId, text: 'next' });
    await flush();
    const ack = `${JSON.stringify(controlResponse(JSON.parse(harness.child.stdin.writes[1]!).request_id))}\n`;
    harness.child.stdout.emit('data', ack.slice(0, 20));
    harness.child.stdout.emit('data', ack.slice(20));

    await expect(delivery).resolves.toBe('delivered');
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('keeps stdin open through the interrupted turn\'s own end, and closes it when the answer to the message ends', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);

    const delivery = harness.executor.sendUserMessage({ runId, text: 'stop at 10' });
    await flush();
    harness.child.stdout.emit('data', `${JSON.stringify(controlResponse(JSON.parse(harness.child.stdin.writes[1]!).request_id))}\n`);
    await expect(delivery).resolves.toBe('delivered');

    // Claude Code ends the interrupted turn with this result frame, after the acknowledgement.
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, stop_reason: null, terminal_reason: 'aborted_streaming' })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);

    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(true);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('keeps stdin open while the interrupt is unacknowledged even if the turn ends on its own meanwhile', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);

    const delivery = harness.executor.sendUserMessage({ runId, text: 'late but live' });
    await flush();
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'finished' }], stop_reason: 'end_turn' } })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);

    harness.child.stdout.emit('data', `${JSON.stringify(controlResponse(JSON.parse(harness.child.stdin.writes[1]!).request_id))}\n`);
    await expect(delivery).resolves.toBe('delivered');
    expect(JSON.parse(harness.child.stdin.writes[2]!).message.content[0].text).toBe('late but live');

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('keeps stdin open after a tool call, so a message sent while a tool runs still reaches the agent', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'sleep 10' } }], stop_reason: 'tool_use' } })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);

    const delivery = harness.executor.sendUserMessage({ runId, text: 'never mind' });
    await flush();
    harness.child.stdout.emit('data', `${JSON.stringify(controlResponse(JSON.parse(harness.child.stdin.writes[1]!).request_id))}\n`);
    await expect(delivery).resolves.toBe('delivered');

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('still writes the message when the CLI never acknowledges the interrupt', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    vi.useFakeTimers();
    try {
      const delivery = harness.executor.sendUserMessage({ runId, text: 'are you there' });
      await vi.advanceTimersByTimeAsync(INTERRUPT_ACK_TIMEOUT_MS);
      await expect(delivery).resolves.toBe('delivered');
      expect(JSON.parse(harness.child.stdin.writes[2]!).message.content[0].text).toBe('are you there');
    } finally {
      vi.useRealTimers();
    }
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports not-running, writing no message, when the process exits before acknowledging', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);

    const delivery = harness.executor.sendUserMessage({ runId, text: 'too late' });
    await flush();
    harness.child.emit('close', 0, null);

    await expect(delivery).resolves.toBe('not-running');
    expect(harness.child.stdin.writes).toHaveLength(2);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports not-running once the turn ended and stdin closed, and writes nothing', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(true);

    await expect(harness.executor.sendUserMessage({ runId, text: 'too late' })).resolves.toBe('not-running');
    expect(harness.child.stdin.writes).toHaveLength(1);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports unsupported for a live agent that takes its prompt as plain text', async () => {
    const harness = createHarness(createDef({ streamFormat: 'json-event-stream', eventParser: 'codex', promptInputFormat: 'text' }));
    const runId = await startRun(harness);

    await expect(harness.executor.sendUserMessage({ runId, text: 'steer' })).resolves.toBe('unsupported');
    expect(harness.child.stdin.writes).toEqual(['first']);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports not-running for an unknown run and for a run whose process has exited', async () => {
    const harness = createHarness(createDef({}));
    await expect(harness.executor.sendUserMessage({ runId: 'no-such-run', text: 'hello' })).resolves.toBe('not-running');

    const runId = await startRun(harness);
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
    await expect(harness.executor.sendUserMessage({ runId, text: 'hello' })).resolves.toBe('not-running');
  });
});
