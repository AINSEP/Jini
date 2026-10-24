import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { AgentLaunchResolution, RuntimeAgentDef } from '@jini-ai/agent-runtime';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle, type RunLifecycle } from '../../run-lifecycle.js';
import type { RunByteJournal } from '../../continuation/journal.js';
import { createAgentExecutor } from '../../index.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

/** A message sent during tools/background work is queued on the same session without aborting
 * anything. HTTP acceptance means queued; only UUID-attributed CLI replies confirm consumption.
 * Unsupported transports keep the host's next-turn queue; explicit Stop still cancels. */

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

interface HarnessOptions {
  observerFailure?: Error;
  /** The executor's view of `emit` rejects every event this returns an error for (the real lifecycle still records the rest). */
  emitFailure?: (input: Parameters<RunLifecycle['emit']>[0]['input']) => Error | undefined;
  journal?: RunByteJournal;
}

/** The executor's lifecycle port: the real one, with the failures a test asks for injected. */
function executorLifecycle(lifecycle: RunLifecycle, { observerFailure, emitFailure }: HarnessOptions): RunLifecycle {
  return {
    ...lifecycle,
    ...(observerFailure ? { stream: async () => { throw observerFailure; } } : {}),
    ...(emitFailure ? { emit: async (args: Parameters<RunLifecycle['emit']>[0]) => {
      const failure = emitFailure(args.input);
      if (failure) throw failure;
      return lifecycle.emit(args);
    } } : {}),
  };
}

function createHarness(def: RuntimeAgentDef, options: HarnessOptions = {}) {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const child = createFakeChild();
  const spawn = (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as unknown as typeof nodeSpawn;
  const onCleanupFailure = vi.fn();
  const executor = createAgentExecutor({ lifecycle: executorLifecycle(lifecycle, options) }, {
    ...(options.journal ? { journal: options.journal } : {}),
    resolveModelForLaunch: fixtureLaunchModel,
    getAgentDef: ({ id }) => (id === def.id ? def : null),
    resolveAgentLaunch: () => ({ selectedPath: '/fake/bin', pathResolvedPath: '/fake/bin', configuredOverridePath: null, launchPath: '/fake/bin', launchKind: 'selected', childPathPrepend: [], diagnostic: null }) as AgentLaunchResolution,
    applyAgentLaunchEnv: ({ env }) => env,
    spawn,
    listProcessSnapshots: async () => [],
    stopProcesses: async () => ({ alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }),
    onCleanupFailure,
  });
  return { lifecycle, executor, child, onCleanupFailure };
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
  it('writes screenshot pixels with the mid-run text in the same structured user message as an idle send', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    const delivery = harness.executor.sendUserMessage({ runId, text: 'see screenshot' }, {
      imageContents: [{ mimeType: 'image/png', data: 'iVBORw==' }],
    });
    await flush();
    await expect(delivery).resolves.toBe('delivered');
    expect(JSON.parse(harness.child.stdin.writes[1]!)).toEqual({ type: 'user', uuid: expect.any(String), message: { role: 'user', content: [
      { type: 'text', text: 'see screenshot' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' } },
    ] } });
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports an unavailable tool observer without stranding the terminal transition', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const error = new Error('event replay unavailable');
      const h = createHarness(createDef({}), { observerFailure: error });
      const runId = await startRun(h);
      await h.lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'text_delta', delta: 'done' } } }); // a successful run must produce output
      h.child.emit('close', 0, null);
      expect((await h.lifecycle.waitForTerminal({ runId })).state).toBe('succeeded');
      expect(h.onCleanupFailure).toHaveBeenCalledTimes(1);
      expect(h.onCleanupFailure).toHaveBeenCalledWith({ runId, phase: 'tool-cancellation', pid: 4242, error });
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('output observer unavailable'), 'event replay unavailable',
      );
      const errors: RunProtocolEvent[] = [];
      const subscription = await h.lifecycle.stream({ runId, onEvent: event => {
        if (event.kind === 'error') errors.push(event);
      } });
      if (subscription.kind === 'ok') subscription.unsubscribe();
      expect(errors).toEqual([]);
    } finally {
      warning.mockRestore();
    }
  });

  it('queues_mid_run_input_without_interrupting_parallel_tools', async () => {
    const h = createHarness(createDef({}));
    const runId = await startRun(h);
    h.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [
      { type: 'tool_use', id: 'fetch', name: 'web_fetch_page', input: {} },
      { type: 'tool_use', id: 'shot', name: 'web_screenshot_page', input: {} },
    ], stop_reason: 'tool_use' } })}\n`);
    // Delegated canonical calls enter the lifecycle directly, outside the CLI parser.
    await h.lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'tool_use', id: 'delegate', name: 'site_read', input: {} } } });
    await expect(h.executor.sendUserMessage({ runId, text: 'change course' })).resolves.toBe('delivered');
    expect(h.child.stdin.writes.slice(1).map(line => JSON.parse(line).type)).toEqual(['user']);
    await flush();
    expect((await agentPayloads(h, runId)).filter(p => (p as { type: string }).type === 'tool_result')).toEqual([]);
    expect(h.child.stdin.ended).toBe(false);
    h.child.emit('close', 0, null);
    await h.lifecycle.waitForTerminal({ runId });
  });

  it('pairs all open tool calls before the terminal event on hard cancellation', async () => {
    const h = createHarness(createDef({ promptInputFormat: 'text' }));
    const runId = await startRun(h);
    for (const id of ['done', 'open']) await h.lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'tool_use', id, name: 'Read', input: {} } } });
    await h.lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'tool_result', toolUseId: 'done', content: 'saved', isError: false } } });
    await h.lifecycle.cancel({ runId });
    h.child.emit('close', null, 'SIGTERM');
    await h.lifecycle.waitForTerminal({ runId });
    expect((await agentPayloads(h, runId)).filter(p => (p as { type?: string }).type === 'tool_result')).toEqual([
      { type: 'tool_result', toolUseId: 'done', content: 'saved', isError: false },
      { type: 'tool_result', toolUseId: 'open', content: 'Tool execution cancelled.', isError: true },
    ]);
  });

  it('reports a cancellation record the lifecycle refuses, and still pairs the other open calls', async () => {
    const refused = new Error('event log unavailable');
    const h = createHarness(createDef({ promptInputFormat: 'text' }), {
      emitFailure: (input) => {
        const data = input.data as { type?: string; toolUseId?: string };
        return input.event === 'agent' && data.type === 'tool_result' && data.toolUseId === 'lost' ? refused : undefined;
      },
    });
    const runId = await startRun(h);
    for (const id of ['lost', 'open']) await h.lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'tool_use', id, name: 'Read', input: {} } } });
    await h.lifecycle.cancel({ runId });
    h.child.emit('close', null, 'SIGTERM');
    await h.lifecycle.waitForTerminal({ runId });
    expect(h.onCleanupFailure).toHaveBeenCalledWith({ runId, phase: 'tool-cancellation', pid: 4242, error: refused });
    expect((await agentPayloads(h, runId)).filter(p => (p as { type?: string }).type === 'tool_result')).toEqual([
      { type: 'tool_result', toolUseId: 'open', content: 'Tool execution cancelled.', isError: true },
    ]);
  });

  it('journals a mid-run message as trusted host stdin bytes, without the image data', async () => {
    const recorded: unknown[] = [];
    const journal: RunByteJournal = { record: async ({ entry }) => { recorded.push(entry); }, read: async () => [] };
    const h = createHarness(createDef({}), { journal });
    const runId = await startRun(h);
    const delivery = h.executor.sendUserMessage({ runId, text: 'look again' }, { imageContents: [{ mimeType: 'image/png', data: 'iVBORw==' }] });
    await flush();
    await expect(delivery).resolves.toBe('delivered');
    await flush();
    expect(recorded).toContainEqual({ content: 'look again', provenance: { source: 'host', channel: 'stdin' }, trust: 'trusted' });
    expect(JSON.stringify(recorded)).not.toContain('iVBORw==');
    h.child.emit('close', 0, null);
    await h.lifecycle.waitForTerminal({ runId });
  });

  it('consumes_queued_input_at_next_tool_batch_boundary', async () => {
    const h = createHarness(createDef({}));
    const runId = await startRun(h);
    h.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [
      { type: 'tool_use', id: 'quick', name: 'Read', input: {} },
      { type: 'tool_use', id: 'slow', name: 'Bash', input: {} },
    ], stop_reason: 'tool_use' } })}\n`);
    await h.executor.sendUserMessage({ runId, text: 'one' });
    const id = JSON.parse(h.child.stdin.writes[1]!).uuid;
    // A completed call keeps its real result; queueing must not synthesize cancellation for slow.
    h.child.stdout.emit('data', `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'quick', content: 'read ok' }] } })}\n`);
    h.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', user_message_uuid: id, message: { id: 'm2', content: [{ type: 'text', text: 'next step' }] } })}\n`);
    await flush();
    const payloads = await agentPayloads(h, runId);
    expect(payloads.filter((p) => (p as { type: string }).type === 'user_message')).toEqual([
      { type: 'user_message', id, text: 'one', deliveryState: 'queued' },
      { type: 'user_message', id, text: 'one', deliveryState: 'consumed' },
    ]);
    expect(payloads.filter((p) => (p as { type: string }).type === 'tool_result')).toEqual([
      { type: 'tool_result', toolUseId: 'quick', content: 'read ok', isError: false },
    ]);
    expect(h.child.stdin.ended).toBe(false);
    h.child.emit('close', 0, null);
    await h.lifecycle.waitForTerminal({ runId });
  });

  it('queues one UUID-stamped user envelope and ignores unrelated control acknowledgements', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    await expect(harness.executor.sendUserMessage({ runId, text: 'also check the footer' })).resolves.toBe('delivered');
    expect(harness.child.stdin.writes).toHaveLength(2);
    const envelope = JSON.parse(harness.child.stdin.writes[1]!);
    expect(envelope).toEqual({ type: 'user', uuid: expect.any(String), message: { role: 'user', content: [{ type: 'text', text: 'also check the footer' }] } });
    harness.child.stdout.emit('data', `${JSON.stringify(controlResponse('some-other-request'))}\n`);
    await flush();
    expect(harness.child.stdin.writes).toHaveLength(2);
    expect((await agentPayloads(harness, runId)).filter((p) => (p as { type: string }).type === 'user_message')).toEqual([
      { type: 'user_message', id: envelope.uuid, text: 'also check the footer', deliveryState: 'queued' },
    ]);
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('matches a UUID consumption receipt split across stdout chunks', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    await harness.executor.sendUserMessage({ runId, text: 'next' });
    const id = JSON.parse(harness.child.stdin.writes[1]!).uuid;
    const receipt = `${JSON.stringify({ type: 'assistant', user_message_uuid: id, message: { id: 'm2', content: [] } })}\n`;
    harness.child.stdout.emit('data', receipt.slice(0, 20));
    harness.child.stdout.emit('data', receipt.slice(20));
    await flush();
    expect(await agentPayloads(harness, runId)).toContainEqual({ type: 'user_message', id, text: 'next', deliveryState: 'consumed' });
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('preserves_queued_input_order_and_images_across_turn_end', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    await harness.executor.sendUserMessage({ runId, text: 'first followup' }, { imageContents: [{ mimeType: 'image/png', data: 'pixels' }] });
    await harness.executor.sendUserMessage({ runId, text: 'second followup' });
    const envelopes = harness.child.stdin.writes.slice(1).map(line => JSON.parse(line));
    expect(envelopes.map(item => item.message.content[0].text)).toEqual(['first followup', 'second followup']);
    expect(envelopes[0].message.content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'pixels' } });
    // A prior turn's end and a later receipt may share one chunk: scan in wire order.
    harness.child.stdout.emit('data', [
      { type: 'assistant', message: { id: 'm1', content: [], stop_reason: 'end_turn' } },
      { type: 'result', user_message_uuid: envelopes[0].uuid, queued_turn_count: 1, stop_reason: 'end_turn' },
    ].map(frame => JSON.stringify(frame)).join('\n') + '\n');
    await flush();
    expect(harness.child.stdin.ended).toBe(false);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', user_message_uuid: envelopes[1].uuid, message: { id: 'm2', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } })}\n`);
    expect(harness.child.stdin.ended).toBe(false); // queued_turn_count still promises a result
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'result', user_message_uuids: envelopes.map(item => item.uuid), queued_turn_count: 0, stop_reason: 'end_turn' })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(true);
    expect((await agentPayloads(harness, runId)).filter(p => (p as { deliveryState?: string }).deliveryState === 'consumed')).toHaveLength(2);
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('keeps stdin open while consumption is unconfirmed even if the turn ends meanwhile', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    await expect(harness.executor.sendUserMessage({ runId, text: 'late but live' })).resolves.toBe('delivered');
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'finished' }], stop_reason: 'end_turn' } })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);
    expect(JSON.parse(harness.child.stdin.writes[1]!).message.content[0].text).toBe('late but live');
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('closes the held stdin at a result that neither names nor queues the message (no receipt support)', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    await harness.executor.sendUserMessage({ runId, text: 'older cli' });
    harness.child.stdout.emit('data', [
      { type: 'assistant', message: { id: 'm1', content: [], stop_reason: 'end_turn' } },
      { type: 'result', stop_reason: 'end_turn' },
    ].map(frame => JSON.stringify(frame)).join('\n') + '\n');
    await flush();
    expect(harness.child.stdin.ended).toBe(true);
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
    await expect(delivery).resolves.toBe('delivered');

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  // Owner, 2026-10-10 (plannie chat, run f8c84ba3): the turn ended `end_turn` a minute in while two
  // background subagents ran ten more minutes. stdin closed at that end, so every message sent in
  // those ten minutes came back 'not-running' and waited for the run to end — and the CLI, at EOF,
  // killed both subagents at its 10-minute background-wait ceiling.
  it('keeps_background_agent_alive_across_parent_turn_and_followup', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    const task = { task_id: 'bg-1', task_type: 'local_agent', description: 'Port pages' };
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [task] })}\n`);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Both agents are working.' }], stop_reason: 'end_turn' } })}\n`);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'result', subtype: 'success', stop_reason: 'end_turn' })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);

    // No turn is running to interrupt: the message goes straight in as the next user line.
    await expect(harness.executor.sendUserMessage({ runId, text: 'save some context' })).resolves.toBe('delivered');
    expect(harness.child.stdin.writes).toHaveLength(2);
    expect(JSON.parse(harness.child.stdin.writes[1]!).message.content[0].text).toBe('save some context');
    expect(harness.child.stdin.ended).toBe(false);

    const id = JSON.parse(harness.child.stdin.writes[1]!).uuid;
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', user_message_uuid: id, message: { id: 'followup', content: [{ type: 'text', text: 'Context saved.' }], stop_reason: 'end_turn' } })}\n`);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'result', user_message_uuid: id, queued_turn_count: 0, stop_reason: 'end_turn' })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);
    expect((await agentPayloads(harness, runId)).filter(p => (p as { type: string; status?: string }).type === 'background_task' && (p as { status: string }).status === 'stopped')).toEqual([]);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'task_notification', task_id: task.task_id, status: 'completed', summary: 'Pages ported' })}\n`);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })}\n`);
    expect(harness.child.stdin.ended).toBe(true);
    await flush();
    expect(await agentPayloads(harness, runId)).toContainEqual({ type: 'background_task', id: task.task_id, description: 'Port pages', status: 'completed', detail: 'Pages ported' });
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('closes stdin held for background tasks once the last one finishes, so the CLI can exit', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    const task = { task_id: 'bg-1', task_type: 'local_agent', description: 'Port pages' };
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [task] })}\n`);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'working' }], stop_reason: 'end_turn' } })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);

    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(true);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('does not close stdin when background tasks finish while a turn is still running', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    const task = { task_id: 'bg-1', task_type: 'local_agent', description: 'Port pages' };
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [task] })}\n`);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);

    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('ignores malformed or unrelated consumption receipts', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    await harness.executor.sendUserMessage({ runId, text: 'later' });
    const id = JSON.parse(harness.child.stdin.writes[1]!).uuid;
    for (const noise of [
      '{"user_message_uuid" is not json',
      JSON.stringify({ type: 'user', uuid: id }),
      JSON.stringify({ type: 'assistant', user_message_uuid: 7 }),
      JSON.stringify({ type: 'assistant', user_message_uuid: 'other' }),
    ]) harness.child.stdout.emit('data', `${noise}\n`);
    await flush();
    expect((await agentPayloads(harness, runId)).filter(p => (p as { type: string }).type === 'user_message')).toEqual([
      { type: 'user_message', id, text: 'later', deliveryState: 'queued' },
    ]);
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('ignores lines that only mention background_tasks_changed: the held stdin closes only on a real empty task list', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    const task = { task_id: 'bg-1', task_type: 'local_agent', description: 'Port pages' };
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [task] })}\n`);
    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'working' }], stop_reason: 'end_turn' } })}\n`);
    for (const noise of [
      '{"background_tasks_changed" is not json',
      JSON.stringify({ type: 'assistant', background_tasks_changed: true }),
      JSON.stringify({ type: 'system', subtype: 'init', background_tasks_changed: [] }),
      JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: 'none' }),
    ]) harness.child.stdout.emit('data', `${noise}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(false);

    harness.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })}\n`);
    await flush();
    expect(harness.child.stdin.ended).toBe(true);
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('writes immediately without waiting for a control acknowledgement', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    await expect(harness.executor.sendUserMessage({ runId, text: 'are you there' })).resolves.toBe('delivered');
    expect(harness.child.stdin.writes).toHaveLength(2);
    expect(JSON.parse(harness.child.stdin.writes[1]!).message.content[0].text).toBe('are you there');
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal({ runId });
  });

  it('reports not-running immediately on process close before terminal persistence finishes', async () => {
    const harness = createHarness(createDef({}));
    const runId = await startRun(harness);
    harness.child.emit('close', 0, null);
    await expect(harness.executor.sendUserMessage({ runId, text: 'too late' })).resolves.toBe('not-running');
    expect(harness.child.stdin.writes).toHaveLength(1);
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


it('reports_stopped_background_agent_on_session_exit', async () => {
  const h = createHarness(createDef({}));
  const runId = await startRun(h);
  h.child.stdout.emit('data', `${JSON.stringify({ type: 'system', subtype: 'task_started', task_id: 'background', task_type: 'local_agent', description: 'Page review' })}\n`);
  h.child.emit('close', null, 'SIGTERM');
  await h.lifecycle.waitForTerminal({ runId });
  expect((await agentPayloads(h, runId)).filter(p => (p as { type: string }).type === 'background_task')).toEqual([
    { type: 'background_task', id: 'background', status: 'running', description: 'Page review' },
    { type: 'background_task', id: 'background', status: 'stopped', description: 'Page review', detail: 'Stopped because the agent session ended' },
  ]);
});
