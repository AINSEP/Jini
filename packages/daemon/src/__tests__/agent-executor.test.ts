import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { RunAgentPayload, RunErrorPayload, RunProtocolEvent } from '@injini/protocol';
import {
  attachAcpSession,
  attachPiRpcSession,
  preparePromptFileForAgent,
  type AcpSessionController,
  type AgentLaunchResolution,
  type PiRpcSession,
  type RuntimeAgentDef,
} from '@injini/agent-runtime';
import type { Principal, RunRef } from '@injini/core';
import type { JournalEntry } from '@injini/protocol';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle, type RunLifecycle } from '../run-lifecycle.js';
import { createRunByteJournal, type RunByteJournal } from '../continuation/journal.js';
import type { ToolExecutionResult, ToolExecutor } from '../tool-executor.js';
import {
  AgentExecutorError,
  buildMcpJsonServerEntry,
  createAgentExecutor,
  isSupportedStreamFormat,
  mergeMcpJsonContent,
  translateAgentRuntimeEvent,
  type AgentExecutor,
  type ClassifyFailure,
  type ContinuationOptions,
  type McpJsonInjectionOptions,
} from '../agent-executor.js';

const TEST_PRINCIPAL: Principal = { id: 'test-principal' };

/** A fake `ToolExecutor` whose `execute` is fully caller-controlled — no real tool registry needed for gap 3's injection tests. */
function createFakeToolExecutor(
  executeImpl: (toolId: string, input: unknown) => Promise<ToolExecutionResult> | ToolExecutionResult,
): { toolExecutor: ToolExecutor; calls: Array<{ principal: Principal; run: RunRef; toolId: string; input: unknown }> } {
  const calls: Array<{ principal: Principal; run: RunRef; toolId: string; input: unknown }> = [];
  return {
    calls,
    toolExecutor: {
      async execute(principal: Principal, run: RunRef, toolId: string, input: unknown) {
        calls.push({ principal, run, toolId, input });
        return executeImpl(toolId, input);
      },
      async resumeConfirmation() {
        throw new Error('not used in these tests');
      },
      async cancel() {
        throw new Error('not used in these tests');
      },
      getAuditRecord() {
        return undefined;
      },
    } as unknown as ToolExecutor,
  };
}

/** Records every `record()` call in order, alongside a real `createRunByteJournal` so read-back is also exercised. */
function createSpyJournal(): { journal: RunByteJournal; calls: Array<{ runId: string; entry: JournalEntry }> } {
  const real = createRunByteJournal(createInMemoryEventLog());
  const calls: Array<{ runId: string; entry: JournalEntry }> = [];
  return {
    calls,
    journal: {
      async record(runId, entry) {
        calls.push({ runId, entry });
        await real.record(runId, entry);
      },
      read: (runId) => real.read(runId),
    },
  };
}

// ---------------------------------------------------------------------------
// Fake child-process harness — extends the .stdout/.stderr sub-EventEmitter +
// .kill(signal)-emitting-'close' shape from
// packages/agent-runtime/src/__tests__/terminal-launch.test.ts's
// vi.mock('node:child_process', ...) pattern, but wired via AgentExecutor's
// own injectable `spawn` seam instead of a module mock — no real subprocess,
// no real filesystem access, matching this package's established
// dependency-injection convention (see tool-executor.ts/run-lifecycle.ts).
// ---------------------------------------------------------------------------

interface FakeWritable extends EventEmitter {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  writes: string[];
  ended: boolean;
}

function createFakeStdin(): FakeWritable {
  const stdin = new EventEmitter() as FakeWritable;
  stdin.writes = [];
  stdin.ended = false;
  stdin.write = vi.fn((chunk: string) => {
    stdin.writes.push(String(chunk));
    return true;
  });
  stdin.end = vi.fn(() => {
    stdin.ended = true;
  });
  return stdin;
}

interface FakeChild extends EventEmitter {
  pid: number | undefined;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: FakeWritable | undefined;
  killed: boolean;
  kill: ReturnType<typeof vi.fn>;
}

// No default parameter here on purpose: `createFakeChild(undefined)` (the
// harness's explicit "no pid assigned yet" test case) must actually leave
// `child.pid` as `undefined`, which a JS default parameter would silently
// override back to a fallback since default parameters trigger on an
// `undefined` argument, not just an omitted one.
function createFakeChild(pid: number | undefined, options: { omitStdin?: boolean } = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = options.omitStdin ? undefined : createFakeStdin();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createFakeDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    id: 'fake-agent',
    name: 'Fake Agent',
    bin: 'fake-bin',
    versionArgs: ['--version'],
    fallbackModels: [],
    buildArgs: () => ['--flag'],
    streamFormat: 'json-event-stream',
    eventParser: 'codex',
    promptViaStdin: true,
    ...overrides,
  };
}

interface SpawnCall {
  command: string;
  args: string[];
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: unknown };
}

interface HarnessOptions {
  def?: RuntimeAgentDef | null;
  launchPath?: string | null;
  spawnThrows?: unknown;
  spawnErrorEvent?: unknown;
  childPid?: number | undefined;
  omitStdin?: boolean;
  /** SEC-007: makes `stopProcesses` reject (e.g. simulating EPERM) instead of succeeding. */
  stopProcessesRejects?: unknown;
  /** SEC-007: makes `listProcessSnapshots` reject instead of succeeding. */
  listProcessSnapshotsRejects?: unknown;
  /** Overrides the real `@injini/agent-runtime` prompt-file stager (default: real — touches real disk under `os.tmpdir()`, a no-op for every def without `promptViaFile: true`). */
  preparePromptFileForAgent?: typeof preparePromptFileForAgent;
  /** Gap 1's byte-journal — omitted by default, matching `CreateAgentExecutorOptions.journal`'s own opt-in default. */
  journal?: RunByteJournal;
  /** Gap 3's stdin-tool-result injection config — omitted by default, matching `CreateAgentExecutorOptions.continuation`'s own opt-in default. */
  continuation?: ContinuationOptions;
  /** Gap 4's failure classifier — omitted by default, matching `CreateAgentExecutorOptions.classifyFailure`'s own opt-in default. */
  classifyFailure?: ClassifyFailure;
  /** Gap 3 part 2's spawn-time `.mcp.json` injection — omitted by default, matching `CreateAgentExecutorOptions.mcpJsonInjection`'s own opt-in default. */
  mcpJsonInjection?: McpJsonInjectionOptions;
}

interface Harness {
  lifecycle: RunLifecycle;
  executor: AgentExecutor;
  child: FakeChild;
  spawnCalls: SpawnCall[];
  stopProcessesCalls: Array<Array<number | null | undefined>>;
  onCleanupFailure: ReturnType<typeof vi.fn>;
}

/** Builds a real in-memory `RunLifecycle` (matching run-lifecycle.test.ts's precedent) plus an `AgentExecutor` wired entirely to injected fakes — no real subprocess, filesystem, or PATH lookup. */
function createHarness(options: HarnessOptions = {}): Harness {
  const eventLog = createInMemoryEventLog();
  const lifecycle = createRunLifecycle({ eventLog });
  const child = createFakeChild('childPid' in options ? options.childPid : 4242, {
    ...(options.omitStdin !== undefined ? { omitStdin: options.omitStdin } : {}),
  });
  const spawnCalls: SpawnCall[] = [];
  const stopProcessesCalls: Array<Array<number | null | undefined>> = [];

  const def = options.def === undefined ? createFakeDef() : options.def;
  const launchPath = options.launchPath === undefined ? '/fake/bin' : options.launchPath;

  const fakeSpawn = ((command: string, args: readonly string[], spawnOptions: unknown) => {
    spawnCalls.push({ command, args: [...args], options: spawnOptions as SpawnCall['options'] });
    if (options.spawnThrows) {
      throw options.spawnThrows;
    }
    if (options.spawnErrorEvent) {
      queueMicrotask(() => child.emit('error', options.spawnErrorEvent));
    } else {
      queueMicrotask(() => child.emit('spawn'));
    }
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;

  const onCleanupFailure = vi.fn();

  const executor = createAgentExecutor({
    lifecycle,
    getAgentDef: (id: string) => (def && def.id === id ? def : null),
    resolveAgentLaunch: () =>
      ({
        selectedPath: launchPath,
        pathResolvedPath: launchPath,
        configuredOverridePath: null,
        launchPath,
        launchKind: 'selected',
        childPathPrepend: [],
        diagnostic: null,
      }) as AgentLaunchResolution,
    applyAgentLaunchEnv: (env) => env,
    spawn: fakeSpawn,
    ...(options.preparePromptFileForAgent !== undefined
      ? { preparePromptFileForAgent: options.preparePromptFileForAgent }
      : {}),
    listProcessSnapshots: async () => {
      if (options.listProcessSnapshotsRejects !== undefined) throw options.listProcessSnapshotsRejects;
      const pid = child.pid ?? 0;
      return [
        { pid, ppid: 1, command: 'fake-bin' },
        { pid: pid + 1, ppid: pid, command: 'fake-bin --mcp-helper' },
      ];
    },
    stopProcesses: async (pids) => {
      stopProcessesCalls.push(pids);
      if (options.stopProcessesRejects !== undefined) throw options.stopProcessesRejects;
      const numericPids = pids.filter((pid): pid is number => typeof pid === 'number');
      return { alreadyStopped: false, forcedPids: [], matchedPids: numericPids, remainingPids: [], stoppedPids: numericPids };
    },
    onCleanupFailure,
    ...(options.journal !== undefined ? { journal: options.journal } : {}),
    ...(options.continuation !== undefined ? { continuation: options.continuation } : {}),
    ...(options.classifyFailure !== undefined ? { classifyFailure: options.classifyFailure } : {}),
    ...(options.mcpJsonInjection !== undefined ? { mcpJsonInjection: options.mcpJsonInjection } : {}),
  });

  return { lifecycle, executor, child, spawnCalls, stopProcessesCalls, onCleanupFailure };
}

async function collectEvents(lifecycle: RunLifecycle, runId: string): Promise<RunProtocolEvent[]> {
  const events: RunProtocolEvent[] = [];
  await lifecycle.stream(runId, (event) => events.push(event));
  return events;
}

function agentPayloadTypes(events: RunProtocolEvent[]): string[] {
  return events.filter((event) => event.kind === 'agent').map((event) => (event.payload as RunAgentPayload).type);
}

describe('AgentExecutor — successful run end-to-end', () => {
  it('spawns the resolved binary, streams a realistic codex-shaped turn, and finishes succeeded', async () => {
    const { lifecycle, executor, child, spawnCalls } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.command).toBe('/fake/bin');
    expect(spawnCalls[0]?.args).toEqual(['--flag']);
    expect(spawnCalls[0]?.options.cwd).toBe('/work');
    expect(spawnCalls[0]?.options.stdio).toEqual(['pipe', 'pipe', 'pipe']);

    // status (thread.started) — a line deliberately split mid-object across
    // two 'data' events to prove the parser's own buffering (and this
    // driver's chunk-by-chunk forwarding) survives a split-chunk delivery.
    child.stdout.emit('data', Buffer.from('{"type":"thread.started",'));
    child.stdout.emit('data', '"thread_id":"sess-abc"}\n');
    // status (turn.started -> "thinking")
    child.stdout.emit('data', '{"type":"turn.started"}\n');
    // tool_use (Bash)
    child.stdout.emit(
      'data',
      '{"type":"item.started","item":{"id":"call-1","type":"command_execution","command":"echo hi"}}\n',
    );
    // tool_result for the same call id (tool_use already emitted, guarded against re-emission)
    child.stdout.emit(
      'data',
      '{"type":"item.completed","item":{"id":"call-1","type":"command_execution","command":"echo hi","aggregated_output":"hi\\n","exit_code":0}}\n',
    );
    // text_delta
    child.stdout.emit('data', '{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}\n');
    // usage
    child.stdout.emit('data', '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n');
    // raw stderr forwarding
    child.stderr.emit('data', 'warning: low disk space\n');

    child.emit('close', 0, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('succeeded');

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['status', 'status', 'tool_use', 'tool_result', 'text_delta', 'usage']);

    const stdoutChunks = events.filter((e) => e.kind === 'stdout').map((e) => (e.payload as { chunk: string }).chunk);
    expect(stdoutChunks.join('')).toContain('"thread_id":"sess-abc"');
    expect(stdoutChunks.some((chunk) => chunk === '{"type":"thread.started",')).toBe(true);

    const stderrEvents = events.filter((e) => e.kind === 'stderr');
    expect(stderrEvents).toHaveLength(1);
    expect((stderrEvents[0]?.payload as { chunk: string }).chunk).toBe('warning: low disk space\n');

    const toolUseEvent = events.find((e) => e.kind === 'agent' && (e.payload as RunAgentPayload).type === 'tool_use');
    expect(toolUseEvent?.payload).toMatchObject({ id: 'call-1', name: 'Bash', input: { command: 'echo hi' } });

    const endEvent = events[events.length - 1];
    expect(endEvent).toMatchObject({ kind: 'end', payload: { status: 'succeeded', code: 0, signal: null } });
  });

  it('forwards the host-selected model, reasoning, images, and allowed directories to argv-based runtime buildArgs', async () => {
    const buildArgs = vi.fn(() => ['--flag']);
    const { lifecycle, executor } = createHarness({ def: createFakeDef({ buildArgs }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-model' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'do the thing',
      cwd: '/work',
      model: 'model-picked-in-composer',
      reasoning: 'high',
      imagePaths: ['/uploads/reference.png'],
      extraAllowedDirs: ['/uploads'],
    });
    await flushAsync();
    await runPromise;

    expect(buildArgs).toHaveBeenCalledWith(
      'do the thing',
      ['/uploads/reference.png'],
      ['/uploads'],
      { model: 'model-picked-in-composer', reasoning: 'high' },
      undefined,
    );
  });
});

describe('AgentExecutor — pre-spawn failure paths never bare-throw', () => {
  it('rejects with AGENT_NOT_FOUND for an unknown agentId and finishes the run failed', async () => {
    const { lifecycle, executor } = createHarness({ def: null });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'nope', prompt: 'x', cwd: '/work' })).rejects.toThrow(
      AgentExecutorError,
    );
    const status = await lifecycle.get(run.id);
    expect(status?.state).toBe('failed');

    try {
      await executor.run({ runId: run.id, agentId: 'nope', prompt: 'x', cwd: '/work' });
    } catch (err) {
      expect(err).toBeInstanceOf(AgentExecutorError);
      expect((err as AgentExecutorError).code).toBe('AGENT_NOT_FOUND');
    }
  });

  it('rejects with AGENT_RUNTIME_UNSUPPORTED for a def whose streamFormat has no implemented driver', async () => {
    const { lifecycle, executor } = createHarness({ def: createFakeDef({ streamFormat: 'made-up-format' }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_UNSUPPORTED',
    });
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('rejects with AGENT_RUNTIME_UNSUPPORTED for antigravity specifically, even though it otherwise satisfies every plain-format guard (streamFormat + promptViaStdin)', async () => {
    const { lifecycle, executor } = createHarness({
      def: createFakeDef({ id: 'antigravity', streamFormat: 'plain', promptViaStdin: true }),
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'antigravity', prompt: 'x', cwd: '/work' }),
    ).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_UNSUPPORTED',
      message: expect.stringContaining('antigravity'),
    });
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('rejects with AGENT_RUNTIME_UNSUPPORTED for a def that does not deliver its prompt via stdin', async () => {
    const { lifecycle, executor } = createHarness({ def: createFakeDef({ promptViaStdin: false }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_UNSUPPORTED',
    });
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('rejects with AGENT_BINARY_NOT_RESOLVED when the launch resolver finds no executable', async () => {
    const { lifecycle, executor } = createHarness({ launchPath: null });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_BINARY_NOT_RESOLVED',
    });
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });
});

describe('AgentExecutor — spawn failure paths never bare-throw', () => {
  it('rejects with AGENT_SPAWN_FAILED when spawn() throws synchronously', async () => {
    const { lifecycle, executor } = createHarness({ spawnThrows: new Error('EACCES') });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
    });
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('stringifies a non-Error synchronous spawn throw', async () => {
    const { lifecycle, executor } = createHarness({ spawnThrows: 'plain string failure' });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('plain string failure'),
    });
  });

  it('rejects with AGENT_SPAWN_FAILED when the child emits "error" before "spawn"', async () => {
    const { lifecycle, executor } = createHarness({ spawnErrorEvent: new Error('ENOENT') });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
    });
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });
});

describe('AgentExecutor — prompt delivery over stdin', () => {
  it('a text-format def writes the raw prompt and closes stdin immediately at spawn', async () => {
    const { lifecycle, executor, child } = createHarness({ def: createFakeDef({ promptInputFormat: 'text' }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hello there', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(child.stdin!.writes).toEqual(['hello there']);
    expect(child.stdin!.end).toHaveBeenCalledTimes(1);
  });

  it('a stream-json def writes one wrapped JSONL user-message line and does NOT close stdin until turn_end', async () => {
    const { lifecycle, executor, child } = createHarness({ def: createFakeDef({ promptInputFormat: 'stream-json' }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hello there', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(child.stdin!.writes).toHaveLength(1);
    expect(JSON.parse(child.stdin!.writes[0]!.trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello there' }] },
    });
    expect(child.stdin!.end).not.toHaveBeenCalled();

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('a def whose child.stdin is unexpectedly absent no-ops instead of throwing', async () => {
    const { lifecycle, executor, child } = createHarness({ omitStdin: true });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })).resolves.toBeUndefined();

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });
});

describe('AgentExecutor — turn_end closes stdin exactly once', () => {
  it('closes stdin on the first turn_end and is idempotent against a second one', async () => {
    const def = createFakeDef({ streamFormat: 'claude-stream-json', promptInputFormat: 'stream-json' });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await runPromise;
    expect(child.stdin!.end).not.toHaveBeenCalled();

    const assistantTurnEnd =
      '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn"}}\n';
    child.stdout.emit('data', assistantTurnEnd);
    await flushAsync();
    expect(child.stdin!.end).toHaveBeenCalledTimes(1);

    // A buggy/duplicate second turn_end must not double-close.
    child.stdout.emit('data', assistantTurnEnd.replace('"id":"m1"', '"id":"m2"'));
    await flushAsync();
    expect(child.stdin!.end).toHaveBeenCalledTimes(1);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('closes stdin when current Claude emits the terminal reason only on its result frame', async () => {
    const def = createFakeDef({ streamFormat: 'claude-stream-json', promptInputFormat: 'stream-json' });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    expect(child.stdin!.end).not.toHaveBeenCalled();

    child.stdout.emit(
      'data',
      [
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'msg_result_only' } },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            id: 'msg_result_only',
            content: [{ type: 'text', text: 'JINI_WIRING_OK' }],
            stop_reason: null,
          },
        }),
        JSON.stringify({
          type: 'result',
          stop_reason: 'end_turn',
          terminal_reason: 'completed',
        }),
      ].join('\n') + '\n',
    );
    await flushAsync();

    expect(child.stdin!.end).toHaveBeenCalledTimes(1);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });
});

describe('AgentExecutor — stream-format dispatch covers every supported parser', () => {
  it('dispatches copilot-stream-json to the copilot parser', async () => {
    const { lifecycle, executor, child } = createHarness({ def: createFakeDef({ streamFormat: 'copilot-stream-json' }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit('data', '{"type":"assistant.message_delta","data":{"deltaContent":"hi"}}\n');
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['text_delta']);
  });

  it('dispatches qoder-stream-json to the qoder parser', async () => {
    const { lifecycle, executor, child } = createHarness({ def: createFakeDef({ streamFormat: 'qoder-stream-json' }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit(
      'data',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n',
    );
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['text_delta']);
  });

  it('a json-event-stream def with no eventParser degrades to that parser\'s own raw fallback rather than throwing', async () => {
    const { eventParser: _omitted, ...rest } = createFakeDef();
    const { lifecycle, executor, child } = createHarness({ def: rest as RuntimeAgentDef });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit('data', '{"type":"thread.started","thread_id":"sess-abc"}\n');
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['raw']);
  });
});

describe('AgentExecutor — a parsed error-typed stream event routes to the error run-event, not agent', () => {
  it('does not forward the error event as an "agent" run event', async () => {
    const { lifecycle, executor, child } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit('data', '{"type":"error","message":"boom"}\n');
    child.emit('close', 1, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const errorEvent = events.find((e) => e.kind === 'error');
    expect(errorEvent?.payload).toEqual({ message: 'boom' });
    expect(events.some((e) => e.kind === 'agent')).toBe(false);
  });
});

describe('AgentExecutor — a single failed queued emit does not block the run from reaching a terminal state', () => {
  it('swallows an emit() race against an already-terminal run instead of leaving an unhandled rejection', async () => {
    const { lifecycle, executor, child } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    // Artificially finish the run out-of-band (simulating a real race
    // where 'close' already ran and called finish() before a straggling
    // 'data' event is delivered) so the next emit() call is guaranteed to
    // throw ("cannot emit on terminal run") — proves enqueueEmit's
    // per-task try/catch isolates that failure rather than propagating an
    // unhandled rejection.
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    expect(() => child.stdout.emit('data', '{"type":"turn.started"}\n')).not.toThrow();
    await flushAsync();

    // A second 'close' (the real one, arriving after our synthetic early
    // finish()) must still complete without throwing — finish() is
    // idempotent, matching RunLifecycle's own contract.
    expect(() => child.emit('close', 0, null)).not.toThrow();
    await flushAsync();

    const status = await lifecycle.get(run.id);
    expect(status?.state).toBe('succeeded');
  });
});

describe('AgentExecutor — cancellation', () => {
  it('escalates to the full descendant process tree via stopProcesses and finishes cancelled', async () => {
    const { lifecycle, executor, child, stopProcessesCalls } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.cancel({ runId: run.id, reason: 'user requested' });
    await flushAsync();

    expect(stopProcessesCalls).toHaveLength(1);
    expect(stopProcessesCalls[0]).toEqual(expect.arrayContaining([4242, 4243]));

    child.emit('close', null, 'SIGTERM');
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('cancelled');
  });

  it('is a no-op when the child has no pid yet (cancelled before spawn ever assigned one)', async () => {
    const { lifecycle, executor, stopProcessesCalls } = createHarness({ childPid: undefined });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await lifecycle.cancel({ runId: run.id });
    await flushAsync();

    expect(stopProcessesCalls).toHaveLength(0);
    await runPromise.catch(() => {});
  });

  it('a cancellation requested before run() is even called is still observed via onCancelRequested replay', async () => {
    const { lifecycle, executor, stopProcessesCalls } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await lifecycle.cancel({ runId: run.id });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(stopProcessesCalls).toHaveLength(1);
  });

  it('SEC-007: a rejecting stopProcesses during cancellation does not become an unhandled rejection, is reported redacted, and falls back to a direct child kill', async () => {
    const { lifecycle, executor, child, onCleanupFailure } = createHarness({
      stopProcessesRejects: new Error('EPERM: operation not permitted at /proc/4243/status'),
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.cancel({ runId: run.id, reason: 'user requested' });
    await flushAsync();

    expect(onCleanupFailure).toHaveBeenCalledTimes(1);
    const [context] = onCleanupFailure.mock.calls[0]!;
    expect(context).toMatchObject({ runId: run.id, phase: 'cancel', pid: 4242 });
    expect(context.error).toBeInstanceOf(Error);

    // The direct-child fallback kill was attempted since the tree-wide stop failed.
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    // The run still reaches a deterministic terminal state once the child's real close fires —
    // cleanup failing does not corrupt the lifecycle or leave the run hanging.
    child.emit('close', null, 'SIGTERM');
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('cancelled');
  });

  it('SEC-007: defaults to a redacted console.error diagnostic when no onCleanupFailure sink is supplied', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const eventLog = createInMemoryEventLog();
    const lifecycle = createRunLifecycle({ eventLog });
    const child = createFakeChild(4242);
    const fakeSpawn = (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as unknown as ChildProcess;
    }) as unknown as typeof nodeSpawn;
    const def = createFakeDef();
    const executor = createAgentExecutor({
      lifecycle,
      getAgentDef: () => def,
      resolveAgentLaunch: () =>
        ({
          selectedPath: '/fake/bin',
          pathResolvedPath: '/fake/bin',
          configuredOverridePath: null,
          launchPath: '/fake/bin',
          launchKind: 'selected',
          childPathPrepend: [],
          diagnostic: null,
        }) as AgentLaunchResolution,
      applyAgentLaunchEnv: (env) => env,
      spawn: fakeSpawn,
      listProcessSnapshots: async () => [{ pid: 4242, ppid: 1, command: 'fake-bin' }],
      stopProcesses: async () => {
        throw new Error('EPERM: secret/token/abc123 not permitted');
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.cancel({ runId: run.id });
    await flushAsync();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });
});

describe('AgentExecutor — defensive listeners never crash the host process', () => {
  it('tolerates a late child-level "error" event after spawn confirmed', async () => {
    const { lifecycle, executor, child } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(() => child.emit('error', new Error('late, unrelated error'))).not.toThrow();

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('tolerates an EPIPE-shaped stdin "error" event', async () => {
    const { lifecycle, executor, child } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(() => child.stdin!.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' }))).not.toThrow();

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('a malformed JSON stdout line is forwarded as a raw agent event instead of crashing the parser', async () => {
    const { lifecycle, executor, child } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit('data', 'not json at all\n');
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const rawEvent = events.find((e) => e.kind === 'agent' && (e.payload as RunAgentPayload).type === 'raw');
    expect(rawEvent?.payload).toEqual({ type: 'raw', line: 'not json at all' });
  });
});

describe('isSupportedStreamFormat', () => {
  it('accepts every family with a real driver (JSON-stream, ACP, pi-rpc, plain), and rejects an unknown format', () => {
    expect(isSupportedStreamFormat('claude-stream-json')).toBe(true);
    expect(isSupportedStreamFormat('json-event-stream')).toBe(true);
    expect(isSupportedStreamFormat('copilot-stream-json')).toBe(true);
    expect(isSupportedStreamFormat('qoder-stream-json')).toBe(true);
    expect(isSupportedStreamFormat('acp-json-rpc')).toBe(true);
    expect(isSupportedStreamFormat('pi-rpc')).toBe(true);
    expect(isSupportedStreamFormat('plain')).toBe(true);
    expect(isSupportedStreamFormat('made-up-format')).toBe(false);
  });
});

describe('createAgentExecutor — real default collaborators', () => {
  it('constructs cleanly with only { lifecycle } — every collaborator falls back to its real @injini/agent-runtime / @injini/platform / node:child_process default', () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const executor = createAgentExecutor({ lifecycle });
    expect(typeof executor.run).toBe('function');
  });

  it('SEC-007: defaultCleanupFailureSink logs via console.error (redacted), when onCleanupFailure is not injected', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const eventLog = createInMemoryEventLog();
      const lifecycle = createRunLifecycle({ eventLog });
      const def = createFakeDef({ streamFormat: 'pi-rpc' });
      // A real pid: terminateChildTree's own `child.pid == null` guard means the cleanup-failure
      // catch path (and hence defaultCleanupFailureSink) is only ever reached once a pid was
      // already assigned — see agent-executor.ts's `terminateChildTreeBestEffort` comment.
      const child = createFakeChild(5300);
      const fakeSpawn = (() => {
        queueMicrotask(() => child.emit('spawn'));
        return child as unknown as ChildProcess;
      }) as unknown as typeof nodeSpawn;
      const fakeAttachPiRpcSession = (() => {
        throw new Error('sensitive-path/should-be-redacted rpc init rejected');
      }) as unknown as typeof attachPiRpcSession;

      const executor = createAgentExecutor({
        lifecycle,
        getAgentDef: (id: string) => (def.id === id ? def : null),
        resolveAgentLaunch: () =>
          ({
            selectedPath: '/fake/pi-bin',
            pathResolvedPath: '/fake/pi-bin',
            configuredOverridePath: null,
            launchPath: '/fake/pi-bin',
            launchKind: 'selected',
            childPathPrepend: [],
            diagnostic: null,
          }) as AgentLaunchResolution,
        applyAgentLaunchEnv: (env) => env,
        spawn: fakeSpawn,
        attachPiRpcSession: fakeAttachPiRpcSession,
        listProcessSnapshots: async () => [],
        stopProcesses: async () => {
          throw new Error('EPERM: not permitted');
        },
        // onCleanupFailure intentionally omitted — exercises defaultCleanupFailureSink.
      });

      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
        code: 'AGENT_SPAWN_FAILED',
      });
      await flushAsync();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [firstArg, secondArg] = consoleErrorSpy.mock.calls[0]!;
      expect(firstArg).toContain('pid=5300');
      expect(firstArg).toContain('pi-rpc-attach-failure');
      // redactSecrets ran on the message — the raw sensitive-looking text isn't asserted verbatim,
      // only that some redacted string was passed as the second console.error argument.
      expect(typeof secondArg).toBe('string');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('mcpJsonInjection with no readFile/writeFile override touches the real filesystem (defaultReadMcpJsonFile/defaultWriteMcpJsonFile)', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-mcp-json-'));
    try {
      const eventLog = createInMemoryEventLog();
      const lifecycle = createRunLifecycle({ eventLog });
      const def = createFakeDef({ id: 'claude', externalMcpInjection: 'claude-mcp-json' });
      const child = createFakeChild(6100);
      const fakeSpawn = (() => {
        queueMicrotask(() => child.emit('spawn'));
        return child as unknown as ChildProcess;
      }) as unknown as typeof nodeSpawn;

      const executor = createAgentExecutor({
        lifecycle,
        getAgentDef: (id: string) => (def.id === id ? def : null),
        resolveAgentLaunch: () =>
          ({
            selectedPath: '/fake/claude-bin',
            pathResolvedPath: '/fake/claude-bin',
            configuredOverridePath: null,
            launchPath: '/fake/claude-bin',
            launchKind: 'selected',
            childPathPrepend: [],
            diagnostic: null,
          }) as AgentLaunchResolution,
        applyAgentLaunchEnv: (env) => env,
        spawn: fakeSpawn,
        listProcessSnapshots: async () => [],
        stopProcesses: async () => ({ alreadyStopped: false, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }),
        // command/args/daemonUrl only — readFile/writeFile deliberately omitted so this exercises
        // the real fs.promises defaults, not a fake.
        mcpJsonInjection: { command: '/usr/bin/jini-mcp', daemonUrl: 'http://127.0.0.1:4242' },
      });

      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: tmpDir });

      const written = JSON.parse(await fs.readFile(path.join(tmpDir, '.mcp.json'), 'utf8'));
      expect(written).toEqual({
        mcpServers: {
          jini: { command: '/usr/bin/jini-mcp', args: [], env: { JINI_RUN_ID: run.id, JINI_DAEMON_URL: 'http://127.0.0.1:4242' } },
        },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('AgentExecutorError', () => {
  it('carries a machine-readable code alongside the human-readable message', () => {
    const err = new AgentExecutorError('AGENT_NOT_FOUND', 'unknown agentId "x"');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AgentExecutorError');
    expect(err.code).toBe('AGENT_NOT_FOUND');
    expect(err.message).toBe('unknown agentId "x"');
  });
});

describe('translateAgentRuntimeEvent', () => {
  it('ignores non-record input and records with a missing/non-string type', () => {
    expect(translateAgentRuntimeEvent(null)).toEqual({ kind: 'ignored' });
    expect(translateAgentRuntimeEvent(undefined)).toEqual({ kind: 'ignored' });
    expect(translateAgentRuntimeEvent('a string')).toEqual({ kind: 'ignored' });
    expect(translateAgentRuntimeEvent(42)).toEqual({ kind: 'ignored' });
    expect(translateAgentRuntimeEvent([])).toEqual({ kind: 'ignored' });
    expect(translateAgentRuntimeEvent({})).toEqual({ kind: 'ignored' });
    expect(translateAgentRuntimeEvent({ type: 123 })).toEqual({ kind: 'ignored' });
  });

  it('ignores an unrecognized type value', () => {
    expect(translateAgentRuntimeEvent({ type: 'some_future_event' })).toEqual({ kind: 'ignored' });
  });

  it('translates status with every optional field present', () => {
    expect(translateAgentRuntimeEvent({ type: 'status', label: 'streaming', model: 'gpt-5', ttftMs: 120, detail: 'note' })).toEqual({
      kind: 'agent',
      payload: { type: 'status', label: 'streaming', model: 'gpt-5', ttftMs: 120, detail: 'note' },
    });
  });

  it('translates status with only the required label, and defaults a missing label to "unknown"', () => {
    expect(translateAgentRuntimeEvent({ type: 'status', label: 'thinking' })).toEqual({
      kind: 'agent',
      payload: { type: 'status', label: 'thinking' },
    });
    expect(translateAgentRuntimeEvent({ type: 'status' })).toEqual({
      kind: 'agent',
      payload: { type: 'status', label: 'unknown' },
    });
  });

  it('translates status carrying a sessionId onto the translation result, not into the RunAgentPayload wire shape (gap 5 — session resume)', () => {
    expect(translateAgentRuntimeEvent({ type: 'status', label: 'initializing', sessionId: 'sess-1' })).toEqual({
      kind: 'agent',
      payload: { type: 'status', label: 'initializing' },
      sessionId: 'sess-1',
    });
  });

  it('omits sessionId from the translation result when the raw status event has none', () => {
    const translation = translateAgentRuntimeEvent({ type: 'status', label: 'initializing' });
    expect(translation).toEqual({ kind: 'agent', payload: { type: 'status', label: 'initializing' } });
    expect(translation).not.toHaveProperty('sessionId');
  });

  it('ignores a non-string sessionId rather than propagating a malformed value', () => {
    expect(translateAgentRuntimeEvent({ type: 'status', label: 'initializing', sessionId: 12345 })).toEqual({
      kind: 'agent',
      payload: { type: 'status', label: 'initializing' },
    });
  });

  it('translates text_delta, defaulting a non-string delta to an empty string', () => {
    expect(translateAgentRuntimeEvent({ type: 'text_delta', delta: 'hi' })).toEqual({
      kind: 'agent',
      payload: { type: 'text_delta', delta: 'hi' },
    });
    expect(translateAgentRuntimeEvent({ type: 'text_delta' })).toEqual({
      kind: 'agent',
      payload: { type: 'text_delta', delta: '' },
    });
  });

  it('translates thinking_start with no fields', () => {
    expect(translateAgentRuntimeEvent({ type: 'thinking_start' })).toEqual({ kind: 'agent', payload: { type: 'thinking_start' } });
  });

  it('translates thinking_delta', () => {
    expect(translateAgentRuntimeEvent({ type: 'thinking_delta', delta: 'pondering' })).toEqual({
      kind: 'agent',
      payload: { type: 'thinking_delta', delta: 'pondering' },
    });
  });

  it('translates tool_use normally', () => {
    expect(translateAgentRuntimeEvent({ type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } })).toEqual({
      kind: 'agent',
      payload: { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'ls' } },
    });
  });

  it('adversarial: coerces a null id/name (copilot\'s tool.execution_start shape) instead of crashing or propagating null', () => {
    expect(translateAgentRuntimeEvent({ type: 'tool_use', id: null, name: null, input: null })).toEqual({
      kind: 'agent',
      payload: { type: 'tool_use', id: '', name: '', input: null },
    });
  });

  it('defaults a missing tool_use input to null', () => {
    expect(translateAgentRuntimeEvent({ type: 'tool_use', id: 'c1', name: 'Bash' })).toEqual({
      kind: 'agent',
      payload: { type: 'tool_use', id: 'c1', name: 'Bash', input: null },
    });
  });

  it('translates tool_input_delta', () => {
    expect(translateAgentRuntimeEvent({ type: 'tool_input_delta', id: 'c1', name: 'Bash', delta: '{"cmd":' })).toEqual({
      kind: 'agent',
      payload: { type: 'tool_input_delta', id: 'c1', name: 'Bash', delta: '{"cmd":' },
    });
  });

  it('translates tool_result with isError true/false/absent, and coerces a non-string toolUseId', () => {
    expect(translateAgentRuntimeEvent({ type: 'tool_result', toolUseId: 'c1', content: 'ok', isError: false })).toEqual({
      kind: 'agent',
      payload: { type: 'tool_result', toolUseId: 'c1', content: 'ok', isError: false },
    });
    expect(translateAgentRuntimeEvent({ type: 'tool_result', toolUseId: 'c1', content: 'boom', isError: true })).toEqual({
      kind: 'agent',
      payload: { type: 'tool_result', toolUseId: 'c1', content: 'boom', isError: true },
    });
    expect(translateAgentRuntimeEvent({ type: 'tool_result', toolUseId: null, content: 'ok' })).toEqual({
      kind: 'agent',
      payload: { type: 'tool_result', toolUseId: '', content: 'ok' },
    });
  });

  it('translates usage with only input/output tokens carried through — other sub-fields are documented drops', () => {
    expect(
      translateAgentRuntimeEvent({
        type: 'usage',
        usage: { input_tokens: 10, output_tokens: 5, thought_tokens: 3, cached_read_tokens: 2 },
        costUsd: 0.01,
        durationMs: 500,
      }),
    ).toEqual({
      kind: 'agent',
      payload: { type: 'usage', usage: { input_tokens: 10, output_tokens: 5 }, costUsd: 0.01, durationMs: 500 },
    });
  });

  it('translates usage with only input_tokens present (output_tokens independently absent)', () => {
    expect(translateAgentRuntimeEvent({ type: 'usage', usage: { input_tokens: 7 } })).toEqual({
      kind: 'agent',
      payload: { type: 'usage', usage: { input_tokens: 7 } },
    });
  });

  it('translates usage with only output_tokens present (input_tokens independently absent)', () => {
    expect(translateAgentRuntimeEvent({ type: 'usage', usage: { output_tokens: 4 } })).toEqual({
      kind: 'agent',
      payload: { type: 'usage', usage: { output_tokens: 4 } },
    });
  });

  it('translates usage with a null/absent usage object as an omitted usage field', () => {
    expect(translateAgentRuntimeEvent({ type: 'usage', usage: null, costUsd: 1 })).toEqual({
      kind: 'agent',
      payload: { type: 'usage', costUsd: 1 },
    });
    expect(translateAgentRuntimeEvent({ type: 'usage' })).toEqual({ kind: 'agent', payload: { type: 'usage' } });
  });

  it('translates raw', () => {
    expect(translateAgentRuntimeEvent({ type: 'raw', line: 'not json' })).toEqual({
      kind: 'agent',
      payload: { type: 'raw', line: 'not json' },
    });
  });

  it('routes error to the error kind, defaulting a missing message and attaching code when present', () => {
    expect(translateAgentRuntimeEvent({ type: 'error', message: 'boom' })).toEqual({
      kind: 'error',
      payload: { message: 'boom' },
    });
    expect(translateAgentRuntimeEvent({ type: 'error' })).toEqual({
      kind: 'error',
      payload: { message: 'Unknown agent error' },
    });
    expect(translateAgentRuntimeEvent({ type: 'error', message: 'auth failed', code: 'AUTH_REQUIRED' })).toEqual({
      kind: 'error',
      payload: { message: 'auth failed', error: { code: 'AUTH_REQUIRED', message: 'auth failed' } },
    });
  });

  it('routes turn_end to the turn-end kind, carrying stopReason through (gap 3 — capability-routed continuation transport)', () => {
    expect(translateAgentRuntimeEvent({ type: 'turn_end', stopReason: 'end_turn' })).toEqual({
      kind: 'turn-end',
      stopReason: 'end_turn',
    });
  });

  it('routes turn_end to the turn-end kind with no stopReason when the raw event carries none', () => {
    expect(translateAgentRuntimeEvent({ type: 'turn_end' })).toEqual({ kind: 'turn-end' });
  });
});

// ---------------------------------------------------------------------------
// ACP dispatch — a fake `attachAcpSession` (this driver's own injectable seam
// for `@injini/agent-runtime`'s real ACP transport, matching the `spawn`/
// `getAgentDef`/`resolveAgentLaunch` fakes above) drives `wireAcpLifecycle`'s
// internal branches without a real ACP subprocess. The real handshake is
// covered separately by agent-executor-acp.integration.test.ts's actual
// subprocess fixture; these tests isolate this driver's own event
// translation, cancellation, and error-mapping logic instead.
// ---------------------------------------------------------------------------

interface FakeAcpAttachCall {
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string | null | undefined;
  readonly imagePaths: readonly string[] | undefined;
  readonly envFormat: 'array' | 'map' | undefined;
  readonly onPermissionRequest: unknown;
  readonly send: (event: string, payload: unknown) => void;
}

interface AcpHarnessOptions {
  def?: Partial<RuntimeAgentDef>;
  completedSuccessfully?: boolean;
  acpPermissionHandler?: unknown;
  attachThrows?: unknown;
  /** SEC-007: makes `stopProcesses` reject instead of succeeding. */
  stopProcessesRejects?: unknown;
  /** Gap 1's byte-journal — omitted by default, matching `CreateAgentExecutorOptions.journal`'s own opt-in default. */
  journal?: RunByteJournal;
  /** Gap 4's failure classifier — omitted by default, matching `CreateAgentExecutorOptions.classifyFailure`'s own opt-in default. */
  classifyFailure?: ClassifyFailure;
}

interface AcpHarness {
  lifecycle: RunLifecycle;
  executor: AgentExecutor;
  child: FakeChild;
  attachCalls: FakeAcpAttachCall[];
  abort: ReturnType<typeof vi.fn>;
  stopProcessesCalls: Array<Array<number | null | undefined>>;
  onCleanupFailure: ReturnType<typeof vi.fn>;
}

/** Builds an `AgentExecutor` wired to an `acp-json-rpc` def and a fully fake `attachAcpSession` — no real ACP handshake, matching `createHarness`'s JSON-stream-path precedent above. */
function createAcpHarness(options: AcpHarnessOptions = {}): AcpHarness {
  const eventLog = createInMemoryEventLog();
  const lifecycle = createRunLifecycle({ eventLog });
  const child = createFakeChild(5100);
  const def = createFakeDef({ streamFormat: 'acp-json-rpc', ...options.def });
  const attachCalls: FakeAcpAttachCall[] = [];
  const abort = vi.fn();
  const stopProcessesCalls: Array<Array<number | null | undefined>> = [];
  const onCleanupFailure = vi.fn();

  const fakeSpawn = (() => {
    queueMicrotask(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;

  const fakeAttachAcpSession = ((attachOptions: {
    prompt: string;
    cwd: string;
    model?: string | null;
    imagePaths?: readonly string[];
    envFormat?: 'array' | 'map';
    onPermissionRequest?: unknown;
    send: (event: string, payload: unknown) => void;
  }) => {
    attachCalls.push({
      prompt: attachOptions.prompt,
      cwd: attachOptions.cwd,
      model: attachOptions.model,
      imagePaths: attachOptions.imagePaths,
      envFormat: attachOptions.envFormat,
      onPermissionRequest: attachOptions.onPermissionRequest,
      send: attachOptions.send,
    });
    if (options.attachThrows) {
      throw options.attachThrows;
    }
    const controller: AcpSessionController = {
      hasFatalError: () => false,
      getDurableSessionId: () => null,
      completedSuccessfully: () => options.completedSuccessfully ?? true,
      abort,
    };
    return controller;
  }) as unknown as typeof attachAcpSession;

  const executor = createAgentExecutor({
    lifecycle,
    getAgentDef: (id: string) => (def.id === id ? def : null),
    resolveAgentLaunch: () =>
      ({
        selectedPath: '/fake/acp-bin',
        pathResolvedPath: '/fake/acp-bin',
        configuredOverridePath: null,
        launchPath: '/fake/acp-bin',
        launchKind: 'selected',
        childPathPrepend: [],
        diagnostic: null,
      }) as AgentLaunchResolution,
    applyAgentLaunchEnv: (env) => env,
    spawn: fakeSpawn,
    attachAcpSession: fakeAttachAcpSession,
    ...(options.acpPermissionHandler !== undefined ? { acpPermissionHandler: options.acpPermissionHandler as never } : {}),
    listProcessSnapshots: async () => {
      const pid = child.pid ?? 0;
      return [
        { pid, ppid: 1, command: 'fake-acp-bin' },
        { pid: pid + 1, ppid: pid, command: 'fake-acp-bin --mcp-helper' },
      ];
    },
    stopProcesses: async (pids) => {
      stopProcessesCalls.push(pids);
      if (options.stopProcessesRejects !== undefined) throw options.stopProcessesRejects;
      const numericPids = pids.filter((pid): pid is number => typeof pid === 'number');
      return { alreadyStopped: false, forcedPids: [], matchedPids: numericPids, remainingPids: [], stoppedPids: numericPids };
    },
    onCleanupFailure,
    ...(options.journal !== undefined ? { journal: options.journal } : {}),
    ...(options.classifyFailure !== undefined ? { classifyFailure: options.classifyFailure } : {}),
  });

  return { lifecycle, executor, child, attachCalls, abort, stopProcessesCalls, onCleanupFailure };
}

describe('AgentExecutor — ACP dispatch (fake attachAcpSession)', () => {
  it('spawns, attaches an ACP session, forwards raw stdout/stderr, translates a text_delta agent event, and finishes succeeded', async () => {
    const { lifecycle, executor, child, attachCalls } = createAcpHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(attachCalls).toHaveLength(1);
    expect(attachCalls[0]).toMatchObject({ prompt: 'do the thing', cwd: '/work', envFormat: undefined, onPermissionRequest: undefined });

    child.stdout.emit('data', 'raw acp stdout\n');
    child.stderr.emit('data', 'raw acp stderr\n');
    attachCalls[0]!.send('agent', { type: 'text_delta', delta: 'hello' });

    child.emit('close', 0, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('succeeded');

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['text_delta']);
    const stdoutEvent = events.find((e) => e.kind === 'stdout');
    expect((stdoutEvent?.payload as { chunk: string }).chunk).toBe('raw acp stdout\n');
    const stderrEvent = events.find((e) => e.kind === 'stderr');
    expect((stderrEvent?.payload as { chunk: string }).chunk).toBe('raw acp stderr\n');
  });

  it('forwards the host-selected model and images into the ACP session', async () => {
    const { lifecycle, executor, attachCalls } = createAcpHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-acp-model' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'do the thing',
      cwd: '/work',
      model: 'claude-sonnet-4-5',
      imagePaths: ['/uploads/reference.png'],
    });
    await flushAsync();
    await runPromise;

    expect(attachCalls[0]?.model).toBe('claude-sonnet-4-5');
    expect(attachCalls[0]?.imagePaths).toEqual(['/uploads/reference.png']);
  });

  it('finishes failed (not cancelled) when the child closes and completedSuccessfully() reports false', async () => {
    const { lifecycle, executor, child } = createAcpHarness({ completedSuccessfully: false });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.emit('close', 1, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('failed');
  });

  it('aborts the ACP controller and escalates the process tree on cancellation, finishing cancelled', async () => {
    const { lifecycle, executor, child, abort, stopProcessesCalls } = createAcpHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.cancel({ runId: run.id, reason: 'user requested' });
    await flushAsync();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(stopProcessesCalls).toHaveLength(1);

    child.emit('close', null, 'SIGTERM');
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('cancelled');
  });

  it('SEC-007: a rejecting stopProcesses during ACP cancellation does not become an unhandled rejection and still falls back to a direct kill', async () => {
    const { lifecycle, executor, child, abort, onCleanupFailure } = createAcpHarness({
      stopProcessesRejects: new Error('EPERM: not permitted'),
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.cancel({ runId: run.id, reason: 'user requested' });
    await flushAsync();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'cancel' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', null, 'SIGTERM');
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('cancelled');
  });

  it('includes envFormat in the attachAcpSession call only when def.acpMcpEnvFormat is set', async () => {
    const { lifecycle, executor, child, attachCalls } = createAcpHarness({ def: { acpMcpEnvFormat: 'map' } });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(attachCalls[0]?.envFormat).toBe('map');

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('passes acpPermissionHandler through to attachAcpSession as onPermissionRequest when configured', async () => {
    const handler = vi.fn();
    const { lifecycle, executor, child, attachCalls } = createAcpHarness({ acpPermissionHandler: handler });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(attachCalls[0]?.onPermissionRequest).toBe(handler);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('routes a send("agent", {type:"error"}) translated event to the run error channel, not agent', async () => {
    const { lifecycle, executor, child, attachCalls } = createAcpHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    attachCalls[0]!.send('agent', { type: 'error', message: 'agent-shaped failure' });
    child.emit('close', 1, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const errorEvent = events.find((e) => e.kind === 'error');
    expect(errorEvent?.payload).toEqual({ message: 'agent-shaped failure' });
    expect(events.some((e) => e.kind === 'agent')).toBe(false);
  });

  it('swallows an emit() race against an already-terminal run on the ACP path without an unhandled rejection', async () => {
    const { lifecycle, executor, child } = createAcpHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    // Same race shape as "AgentExecutor — a single failed queued emit does
    // not block the run from reaching a terminal state" above, replayed
    // against wireAcpLifecycle's own enqueueEmit instead of
    // wireChildLifecycle's — the two closures are independent copies of the
    // same pattern (see agent-executor.ts module doc).
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    expect(() => child.stdout.emit('data', 'straggling output\n')).not.toThrow();
    await flushAsync();

    expect(() => child.emit('close', 0, null)).not.toThrow();
    await flushAsync();

    const status = await lifecycle.get(run.id);
    expect(status?.state).toBe('succeeded');
  });

  it('rejects AGENT_SPAWN_FAILED and terminates the child tree when attachAcpSession throws synchronously', async () => {
    const { lifecycle, executor, stopProcessesCalls } = createAcpHarness({ attachThrows: new Error('handshake rejected') });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const resultPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await expect(resultPromise).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('handshake rejected'),
    });

    await flushAsync();
    expect(stopProcessesCalls).toHaveLength(1);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('SEC-007: still finishes the run failed (awaiting cleanup, not firing-and-forgetting it) when both attachAcpSession and the cleanup it triggers fail', async () => {
    const { lifecycle, executor, child, onCleanupFailure } = createAcpHarness({
      attachThrows: new Error('handshake rejected'),
      stopProcessesRejects: new Error('EPERM: not permitted'),
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const resultPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await expect(resultPromise).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('handshake rejected'),
    });

    // finish() only runs after cleanup is awaited (not a bare `void` fire-and-forget) — by the
    // time the run() promise has rejected, the run is already durably 'failed', the cleanup
    // failure was reported, and the direct-kill fallback was attempted.
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
    expect(onCleanupFailure).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'acp-attach-failure' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  describe('translateAcpError (exercised via send("error", payload), since the function itself is not exported)', () => {
    it('a non-record, non-string payload falls back to a default message', async () => {
      const { lifecycle, executor, child, attachCalls } = createAcpHarness();
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      attachCalls[0]!.send('error', undefined);
      child.emit('close', 1, null);
      await lifecycle.waitForTerminal(run.id);

      const events = await collectEvents(lifecycle, run.id);
      const errorEvent = events.find((e) => e.kind === 'error');
      expect(errorEvent?.payload).toEqual({ message: 'ACP agent failed' });
    });

    it('a record payload with no error field omits the structured error member', async () => {
      const { lifecycle, executor, child, attachCalls } = createAcpHarness();
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      attachCalls[0]!.send('error', { message: 'plain failure, no structured error' });
      child.emit('close', 1, null);
      await lifecycle.waitForTerminal(run.id);

      const events = await collectEvents(lifecycle, run.id);
      const errorEvent = events.find((e) => e.kind === 'error');
      expect(errorEvent?.payload).toEqual({ message: 'plain failure, no structured error' });
    });

    it('a fully-populated error object (code, message, retryable) is carried through as the structured error', async () => {
      const { lifecycle, executor, child, attachCalls } = createAcpHarness();
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      attachCalls[0]!.send('error', {
        message: 'transport dropped',
        error: { code: 'ACP_TRANSPORT', message: 'socket closed', retryable: true },
      });
      child.emit('close', 1, null);
      await lifecycle.waitForTerminal(run.id);

      const events = await collectEvents(lifecycle, run.id);
      const errorEvent = events.find((e) => e.kind === 'error');
      expect(errorEvent?.payload).toEqual({
        message: 'transport dropped',
        error: { code: 'ACP_TRANSPORT', message: 'socket closed', retryable: true },
      });
    });

    it('an error object present without a retryable flag omits retryable from the structured error', async () => {
      const { lifecycle, executor, child, attachCalls } = createAcpHarness();
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      attachCalls[0]!.send('error', { message: 'auth required', error: { code: 'AUTH_REQUIRED' } });
      child.emit('close', 1, null);
      await lifecycle.waitForTerminal(run.id);

      const events = await collectEvents(lifecycle, run.id);
      const errorEvent = events.find((e) => e.kind === 'error');
      expect(errorEvent?.payload).toEqual({
        message: 'auth required',
        error: { code: 'AUTH_REQUIRED', message: 'auth required' },
      });
    });
  });
});

// ---------------------------------------------------------------------------
// pi-rpc dispatch — a fake `attachPiRpcSession` (this driver's own injectable
// seam for `@injini/agent-runtime`'s real pi-rpc transport), mirroring the ACP
// harness above. Unlike ACP's `send(event, payload)`, pi-rpc's `send` always
// uses the `'agent'` channel (confirmed by reading every `mapPiRpcEvent` call
// site in agent-runtime) — error-ness is signaled via the payload's own
// `type: 'error'` field, which `translateAgentRuntimeEvent` already handles
// generically. No real pi subprocess is spawned; this isolates the driver's
// wiring (spawn → attach → cancel → finish), not pi's actual RPC protocol.
// ---------------------------------------------------------------------------

interface FakePiRpcAttachCall {
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string | null | undefined;
  readonly imagePaths: readonly string[] | undefined;
  readonly uploadRoot: string | undefined;
  readonly send: (channel: string, payload: unknown) => void;
}

interface PiRpcHarnessOptions {
  def?: Partial<RuntimeAgentDef>;
  hasFatalError?: boolean;
  attachThrows?: unknown;
  /** SEC-007: makes `stopProcesses` reject instead of succeeding. */
  stopProcessesRejects?: unknown;
  /** Gap 1's byte-journal — omitted by default, matching `CreateAgentExecutorOptions.journal`'s own opt-in default. */
  journal?: RunByteJournal;
  /** Gap 4's failure classifier — omitted by default, matching `CreateAgentExecutorOptions.classifyFailure`'s own opt-in default. */
  classifyFailure?: ClassifyFailure;
}

interface PiRpcHarness {
  lifecycle: RunLifecycle;
  executor: AgentExecutor;
  child: FakeChild;
  attachCalls: FakePiRpcAttachCall[];
  abort: ReturnType<typeof vi.fn>;
  stopProcessesCalls: Array<Array<number | null | undefined>>;
  onCleanupFailure: ReturnType<typeof vi.fn>;
}

/** Builds an `AgentExecutor` wired to a `pi-rpc` def and a fully fake `attachPiRpcSession` — no real pi handshake, matching `createAcpHarness`'s precedent above. */
function createPiRpcHarness(options: PiRpcHarnessOptions = {}): PiRpcHarness {
  const eventLog = createInMemoryEventLog();
  const lifecycle = createRunLifecycle({ eventLog });
  const child = createFakeChild(5200);
  const def = createFakeDef({ streamFormat: 'pi-rpc', ...options.def });
  const attachCalls: FakePiRpcAttachCall[] = [];
  const abort = vi.fn();
  const stopProcessesCalls: Array<Array<number | null | undefined>> = [];
  const onCleanupFailure = vi.fn();

  const fakeSpawn = (() => {
    queueMicrotask(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;

  const fakeAttachPiRpcSession = ((attachOptions: {
    child: unknown;
    prompt: string;
    cwd: string;
    model?: string | null;
    imagePaths?: readonly string[];
    uploadRoot?: string;
    send: (channel: string, payload: unknown) => void;
  }) => {
    attachCalls.push({
      prompt: attachOptions.prompt,
      cwd: attachOptions.cwd,
      model: attachOptions.model,
      imagePaths: attachOptions.imagePaths,
      uploadRoot: attachOptions.uploadRoot,
      send: attachOptions.send,
    });
    if (options.attachThrows) {
      throw options.attachThrows;
    }
    const session: PiRpcSession = {
      hasFatalError: () => options.hasFatalError ?? false,
      getLastSessionPath: () => null,
      abort,
    };
    return session;
  }) as unknown as typeof attachPiRpcSession;

  const executor = createAgentExecutor({
    lifecycle,
    getAgentDef: (id: string) => (def.id === id ? def : null),
    resolveAgentLaunch: () =>
      ({
        selectedPath: '/fake/pi-bin',
        pathResolvedPath: '/fake/pi-bin',
        configuredOverridePath: null,
        launchPath: '/fake/pi-bin',
        launchKind: 'selected',
        childPathPrepend: [],
        diagnostic: null,
      }) as AgentLaunchResolution,
    applyAgentLaunchEnv: (env) => env,
    spawn: fakeSpawn,
    attachPiRpcSession: fakeAttachPiRpcSession,
    listProcessSnapshots: async () => {
      const pid = child.pid ?? 0;
      return [
        { pid, ppid: 1, command: 'fake-pi-bin' },
        { pid: pid + 1, ppid: pid, command: 'fake-pi-bin --mcp-helper' },
      ];
    },
    stopProcesses: async (pids) => {
      stopProcessesCalls.push(pids);
      if (options.stopProcessesRejects !== undefined) throw options.stopProcessesRejects;
      const numericPids = pids.filter((pid): pid is number => typeof pid === 'number');
      return { alreadyStopped: false, forcedPids: [], matchedPids: numericPids, remainingPids: [], stoppedPids: numericPids };
    },
    onCleanupFailure,
    ...(options.journal !== undefined ? { journal: options.journal } : {}),
    ...(options.classifyFailure !== undefined ? { classifyFailure: options.classifyFailure } : {}),
  });

  return { lifecycle, executor, child, attachCalls, abort, stopProcessesCalls, onCleanupFailure };
}

describe('AgentExecutor — pi-rpc dispatch (fake attachPiRpcSession)', () => {
  it('spawns, attaches a pi-rpc session, forwards raw stdout/stderr, translates a text_delta agent event, and finishes succeeded', async () => {
    const { lifecycle, executor, child, attachCalls } = createPiRpcHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(attachCalls).toHaveLength(1);
    expect(attachCalls[0]).toMatchObject({ prompt: 'do the thing', cwd: '/work' });

    child.stdout.emit('data', 'raw pi stdout\n');
    child.stderr.emit('data', 'raw pi stderr\n');
    attachCalls[0]!.send('agent', { type: 'text_delta', delta: 'hello' });

    child.emit('close', 0, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('succeeded');

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['text_delta']);
    const stdoutEvent = events.find((e) => e.kind === 'stdout');
    expect((stdoutEvent?.payload as { chunk: string }).chunk).toBe('raw pi stdout\n');
    const stderrEvent = events.find((e) => e.kind === 'stderr');
    expect((stderrEvent?.payload as { chunk: string }).chunk).toBe('raw pi stderr\n');
  });

  it('forwards the host-selected model, images, and upload root into the pi-rpc session', async () => {
    const { lifecycle, executor, attachCalls } = createPiRpcHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-pi-model' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'do the thing',
      cwd: '/work',
      model: 'anthropic/claude-sonnet-4-5',
      imagePaths: ['/uploads/reference.png'],
      uploadRoot: '/uploads',
    });
    await flushAsync();
    await runPromise;

    expect(attachCalls[0]?.model).toBe('anthropic/claude-sonnet-4-5');
    expect(attachCalls[0]?.imagePaths).toEqual(['/uploads/reference.png']);
    expect(attachCalls[0]?.uploadRoot).toBe('/uploads');
  });

  it('finishes failed (not cancelled) when the child closes and hasFatalError() reports true', async () => {
    const { lifecycle, executor, child } = createPiRpcHarness({ hasFatalError: true });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.emit('close', 1, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('failed');
  });

  it('aborts the pi-rpc session and escalates the process tree on cancellation, finishing cancelled', async () => {
    const { lifecycle, executor, child, abort, stopProcessesCalls } = createPiRpcHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.cancel({ runId: run.id, reason: 'user requested' });
    await flushAsync();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(stopProcessesCalls).toHaveLength(1);

    child.emit('close', null, 'SIGTERM');
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('cancelled');
  });

  it('SEC-007: a rejecting stopProcesses during pi-rpc cancellation does not become an unhandled rejection and still falls back to a direct kill', async () => {
    const { lifecycle, executor, child, abort, onCleanupFailure } = createPiRpcHarness({
      stopProcessesRejects: new Error('EPERM: not permitted'),
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.cancel({ runId: run.id, reason: 'user requested' });
    await flushAsync();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'cancel' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', null, 'SIGTERM');
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('cancelled');
  });

  it('SEC-007: swallows a direct child.kill() throw inside terminateChildTreeBestEffort\'s own catch-recovery attempt, without an unhandled rejection', async () => {
    // Pre-existing shared cleanup helper (terminateChildTreeBestEffort, called by both the ACP
    // and pi-rpc paths): when stopProcesses rejects, it falls back to a direct child.kill() —
    // this proves that fallback itself throwing is *also* swallowed, not just the original
    // stopProcesses rejection above.
    const { lifecycle, executor, child, abort } = createPiRpcHarness({
      stopProcessesRejects: new Error('EPERM: not permitted'),
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.kill = vi.fn(() => {
      throw new Error('kill failed too');
    });

    await lifecycle.cancel({ runId: run.id, reason: 'user requested' });
    await flushAsync();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', null, 'SIGTERM');
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('cancelled');
  });

  it('routes a send("agent", {type:"error"}) translated event to the run error channel, not agent', async () => {
    const { lifecycle, executor, child, attachCalls } = createPiRpcHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    attachCalls[0]!.send('agent', { type: 'error', message: 'pi-shaped failure' });
    child.emit('close', 1, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const errorEvent = events.find((e) => e.kind === 'error');
    expect(errorEvent?.payload).toEqual({ message: 'pi-shaped failure' });
    expect(events.some((e) => e.kind === 'agent')).toBe(false);
  });

  it('ignores an event whose translation is neither agent nor error (e.g. thinking_end, which has no RunAgentPayload variant)', async () => {
    const { lifecycle, executor, child, attachCalls } = createPiRpcHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    attachCalls[0]!.send('agent', { type: 'thinking_end' });
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    expect(events.some((e) => e.kind === 'agent' || e.kind === 'error')).toBe(false);
  });

  it('swallows an emit() race against an already-terminal run on the pi-rpc path without an unhandled rejection', async () => {
    const { lifecycle, executor, child } = createPiRpcHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    expect(() => child.stdout.emit('data', 'straggling output\n')).not.toThrow();
    await flushAsync();

    expect(() => child.emit('close', 0, null)).not.toThrow();
    await flushAsync();

    const status = await lifecycle.get(run.id);
    expect(status?.state).toBe('succeeded');
  });

  it('rejects AGENT_SPAWN_FAILED and terminates the child tree when attachPiRpcSession throws synchronously', async () => {
    const { lifecycle, executor, stopProcessesCalls } = createPiRpcHarness({ attachThrows: new Error('rpc init rejected') });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const resultPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await expect(resultPromise).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('rpc init rejected'),
    });

    await flushAsync();
    expect(stopProcessesCalls).toHaveLength(1);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('SEC-007: still finishes the run failed (awaiting cleanup, not firing-and-forgetting it) when both attachPiRpcSession and the cleanup it triggers fail', async () => {
    const { lifecycle, executor, child, onCleanupFailure } = createPiRpcHarness({
      attachThrows: new Error('rpc init rejected'),
      stopProcessesRejects: new Error('EPERM: not permitted'),
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const resultPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await expect(resultPromise).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('rpc init rejected'),
    });

    await flushAsync();
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
    expect(onCleanupFailure).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'pi-rpc-attach-failure' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

// ---------------------------------------------------------------------------
// plain-format dispatch — driving 4 of the 5 `streamFormat: 'plain'` defs
// (grok-build, aider, deepseek, qwen; antigravity stays deliberately
// unsupported — see the pre-spawn-failure-paths block above), per
// ADS-memory/reports/proposals/PROP-plain-format-agent-driving-2026-07-21.md's
// recommended "Option B": no structured stream parser, live per-chunk
// text_delta forwarding, reusing wireChildLifecycle's existing raw-stdout
// handler and FIFO emit queue. No real CLI is spawned; these fake defs are
// shaped like the real registry defs (same promptViaStdin/promptViaFile/
// maxPromptArgBytes/buildArgs contract) without depending on the registry.
// ---------------------------------------------------------------------------

describe('AgentExecutor — plain-format dispatch (Option B: live text_delta passthrough, no structured parser)', () => {
  it('streams live text_delta agent events per stdout chunk, in order, verbatim — including raw ANSI escape codes and carriage returns (the documented v1 text-hygiene decision: no stripping)', async () => {
    const def = createFakeDef({
      id: 'fake-qwen',
      name: 'Fake Qwen',
      streamFormat: 'plain',
      promptViaStdin: true,
      buildArgs: () => ['--yolo'],
    });
    const { lifecycle, executor, child, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-qwen', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toEqual(['--yolo']);
    // qwen-shaped: stdin, no prompt-delivery complexity — the raw prompt is written and stdin closed immediately.
    expect(child.stdin!.writes).toEqual(['do the thing']);
    expect(child.stdin!.end).toHaveBeenCalledTimes(1);

    const chunks = ['Hello\r\n', '\x1b[32mgreen text\x1b[0m', 'World'];
    for (const chunk of chunks) {
      child.stdout.emit('data', chunk);
    }
    child.emit('close', 0, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('succeeded');

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['text_delta', 'text_delta', 'text_delta']);
    const deltas = events
      .filter((e) => e.kind === 'agent')
      .map((e) => (e.payload as RunAgentPayload & { type: 'text_delta' }).delta);
    // Exact, order-preserving, unmodified passthrough — proves both the FIFO
    // ordering guarantee and the "no ANSI/control-sequence stripping in v1" decision.
    expect(deltas).toEqual(chunks);

    // The raw 'stdout' diagnostic echo channel every format already gets still fires too,
    // independently of the new 'agent'/text_delta channel.
    const stdoutChunks = events.filter((e) => e.kind === 'stdout').map((e) => (e.payload as { chunk: string }).chunk);
    expect(stdoutChunks).toEqual(chunks);

    const endEvent = events[events.length - 1];
    expect(endEvent).toMatchObject({ kind: 'end', payload: { status: 'succeeded', code: 0, signal: null } });
  });

  it('preserves chunk order under the FIFO emit queue even when many stdout chunks arrive synchronously back-to-back (design decision 6)', async () => {
    const def = createFakeDef({ streamFormat: 'plain', promptViaStdin: true });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    const chunkCount = 25;
    for (let i = 0; i < chunkCount; i++) {
      child.stdout.emit('data', `chunk-${i}`);
    }
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const deltas = events
      .filter((e) => e.kind === 'agent')
      .map((e) => (e.payload as RunAgentPayload & { type: 'text_delta' }).delta);
    expect(deltas).toEqual(Array.from({ length: chunkCount }, (_, i) => `chunk-${i}`));
  });

  it('cancellation escalates the full descendant process tree and finishes cancelled, exactly as it does for the other supported formats', async () => {
    const def = createFakeDef({ streamFormat: 'plain', promptViaStdin: true });
    const { lifecycle, executor, child, stopProcessesCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    await lifecycle.cancel({ runId: run.id, reason: 'user requested' });
    await flushAsync();

    expect(stopProcessesCalls).toHaveLength(1);
    expect(stopProcessesCalls[0]).toEqual(expect.arrayContaining([4242, 4243]));

    child.emit('close', null, 'SIGTERM');
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('cancelled');
  });

  it('finishes failed (not succeeded) when the child closes with a non-zero exit code', async () => {
    const def = createFakeDef({ streamFormat: 'plain', promptViaStdin: true });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit('data', 'partial output before failure');
    child.emit('close', 1, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('failed');
  });
});

describe('AgentExecutor — plain-format prompt-file delivery (grok-build: promptViaFile)', () => {
  function createGrokBuildDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
    return createFakeDef({
      id: 'fake-grok-build',
      name: 'Fake Grok Build',
      streamFormat: 'plain',
      promptViaFile: true,
      promptViaStdin: false,
      buildArgs: (_prompt, _imagePaths, _extraAllowedDirs, _options, runtimeContext) => {
        if (!runtimeContext?.promptFilePath) {
          throw new Error('fake-grok-build requires runtimeContext.promptFilePath');
        }
        return ['--prompt-file', runtimeContext.promptFilePath];
      },
      ...overrides,
    });
  }

  it('stages the composed prompt to a real 0o600 temp file, threads its path into buildArgs, and removes it once the child exits', async () => {
    const def = createGrokBuildDef();
    // preparePromptFileForAgent is left at its real default here (not injected) — this is the one
    // test in this suite proving the actual @injini/agent-runtime filesystem behavior end to end.
    const { lifecycle, executor, child, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-grok-build',
      prompt: 'staged prompt body',
      cwd: '/work',
    });
    await flushAsync();
    await runPromise;

    expect(spawnCalls).toHaveLength(1);
    const args = spawnCalls[0]!.args;
    expect(args[0]).toBe('--prompt-file');
    const promptFilePath = args[1]!;
    expect(promptFilePath).toContain('agent-runtime-fake-grok-build-');

    const contents = await fs.readFile(promptFilePath, 'utf8');
    expect(contents).toBe('staged prompt body');
    const stat = await fs.stat(promptFilePath);
    expect(stat.mode & 0o777).toBe(0o600);

    child.emit('close', 0, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('succeeded');

    // Cleaned up after the child exits — no leaked temp file with prompt content on disk.
    await expect(fs.access(promptFilePath)).rejects.toThrow();
  });

  it('cleans up the staged prompt file when spawn() throws synchronously, before ever reaching the child process', async () => {
    const cleanup = vi.fn(async () => {});
    const fakePreparePromptFileForAgent = (async () => ({
      path: '/fake/tmp/prompt.md',
      cleanup,
    })) as unknown as typeof preparePromptFileForAgent;
    const def = createGrokBuildDef();
    const { lifecycle, executor } = createHarness({
      def,
      spawnThrows: new Error('EACCES'),
      preparePromptFileForAgent: fakePreparePromptFileForAgent,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-grok-build', prompt: 'x', cwd: '/work' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('cleans up the staged prompt file when the child emits "error" before "spawn"', async () => {
    const cleanup = vi.fn(async () => {});
    const fakePreparePromptFileForAgent = (async () => ({
      path: '/fake/tmp/prompt.md',
      cleanup,
    })) as unknown as typeof preparePromptFileForAgent;
    const def = createGrokBuildDef();
    const { lifecycle, executor } = createHarness({
      def,
      spawnErrorEvent: new Error('ENOENT'),
      preparePromptFileForAgent: fakePreparePromptFileForAgent,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-grok-build', prompt: 'x', cwd: '/work' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('rejects cleanly with AGENT_SPAWN_FAILED (never a bare throw) when preparePromptFileForAgent itself fails (e.g. disk full)', async () => {
    const fakePreparePromptFileForAgent = (async () => {
      throw new Error('ENOSPC: no space left on device');
    }) as unknown as typeof preparePromptFileForAgent;
    const def = createGrokBuildDef();
    const { lifecycle, executor } = createHarness({ def, preparePromptFileForAgent: fakePreparePromptFileForAgent });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-grok-build', prompt: 'x', cwd: '/work' }),
    ).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('could not stage a prompt file'),
    });
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });
});

describe('AgentExecutor — plain-format argv prompt-budget guard (aider/deepseek: maxPromptArgBytes)', () => {
  function createArgvBoundDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
    return createFakeDef({
      id: 'fake-aider',
      name: 'Fake Aider',
      streamFormat: 'plain',
      promptViaStdin: false,
      maxPromptArgBytes: 30_000,
      buildArgs: (prompt) => ['--message', prompt],
      ...overrides,
    });
  }

  it('spawns normally when the composed prompt is under maxPromptArgBytes', async () => {
    const def = createArgvBoundDef();
    const { lifecycle, executor, child, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-aider', prompt: 'short prompt', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toEqual(['--message', 'short prompt']);

    child.stdout.emit('data', 'streaming reply');
    child.emit('close', 0, null);
    const finished = await lifecycle.waitForTerminal(run.id);
    expect(finished.state).toBe('succeeded');

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['text_delta']);
  });

  it('rejects an over-budget prompt BEFORE spawn via failBeforeSpawn/AGENT_PROMPT_TOO_LARGE, never a raw ENAMETOOLONG/E2BIG from spawn() itself', async () => {
    const def = createArgvBoundDef();
    const { lifecycle, executor, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    // Comfortably exceeds the 100_000-byte POSIX floor `checkPromptArgvBudget` applies
    // regardless of the def's own (smaller) maxPromptArgBytes on non-win32 hosts.
    const oversizedPrompt = 'x'.repeat(200_000);
    await expect(
      executor.run({ runId: run.id, agentId: 'fake-aider', prompt: oversizedPrompt, cwd: '/work' }),
    ).rejects.toMatchObject({
      code: 'AGENT_PROMPT_TOO_LARGE',
      message: expect.stringContaining('exceeds the safe size'),
    });

    expect(spawnCalls).toHaveLength(0);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('rejects a prompt that fits the POSIX argv budget but would exceed the Windows CreateProcess limit through a resolved .cmd shim', async () => {
    const def = createArgvBoundDef();
    const { lifecycle, executor, spawnCalls } = createHarness({ def, launchPath: 'C:\\fake\\aider.cmd' });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    // Under the 100_000-byte POSIX floor, but blows the ~32_767-char CreateProcess cap
    // once cmd-shim-quoted (mirrors packages/agent-runtime/src/__tests__/prompt-budget.test.ts's
    // own 40_000-char fixture for exactly this guard).
    const prompt = 'x'.repeat(40_000);
    await expect(
      executor.run({ runId: run.id, agentId: 'fake-aider', prompt, cwd: '/work' }),
    ).rejects.toMatchObject({
      code: 'AGENT_PROMPT_TOO_LARGE',
      message: expect.stringContaining('runs through a .cmd shim'),
    });

    expect(spawnCalls).toHaveLength(0);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('rejects a prompt that fits the POSIX argv budget but would exceed the Windows CreateProcess limit through a direct .exe resolution', async () => {
    const def = createArgvBoundDef();
    const { lifecycle, executor, spawnCalls } = createHarness({ def, launchPath: 'C:\\fake\\aider.exe' });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const prompt = 'x'.repeat(40_000);
    await expect(
      executor.run({ runId: run.id, agentId: 'fake-aider', prompt, cwd: '/work' }),
    ).rejects.toMatchObject({
      code: 'AGENT_PROMPT_TOO_LARGE',
      message: expect.stringContaining('builds a CreateProcess command line'),
    });

    expect(spawnCalls).toHaveLength(0);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });
});

describe('AgentExecutor — gap 1 byte-journal (CreateAgentExecutorOptions.journal)', () => {
  it('is a no-op when no journal is configured — every other test in this file relies on this default', async () => {
    // Sanity check for the opt-in default itself: createHarness() with no `journal` option must
    // never throw even though every stdout/stderr/stdin call site now conditionally journals.
    const { lifecycle, executor, child } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', '{"type":"turn_end"}\n');
    child.emit('close', 0, null);
    await runPromise;
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
  });

  it('records sent (trusted, stdin) and received (untrusted, stdout/stderr) bytes for a plain-text child-driven def', async () => {
    const { journal, calls } = createSpyJournal();
    const def = createFakeDef({ streamFormat: 'plain' });
    const { lifecycle, executor, child } = createHarness({ def, journal });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', 'hello from agent');
    child.stderr.emit('data', 'a warning');
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(calls).toEqual([
      { runId: run.id, entry: { content: 'do the thing', provenance: { source: 'host', channel: 'stdin' }, trust: 'trusted' } },
      { runId: run.id, entry: { content: 'hello from agent', provenance: { source: 'agent', channel: 'stdout' }, trust: 'untrusted' } },
      { runId: run.id, entry: { content: 'a warning', provenance: { source: 'agent', channel: 'stderr' }, trust: 'untrusted' } },
    ]);

    // The journal is independently readable back — not just a spy assertion, the real
    // createRunByteJournal storage underneath actually durably recorded these entries.
    const replayed = await journal.read(run.id);
    expect(replayed).toHaveLength(3);
  });

  it('records the raw stream-json line prompt as trusted stdin content, not the JSONL-wrapped wire frame', async () => {
    const { journal, calls } = createSpyJournal();
    const def = createFakeDef({ streamFormat: 'claude-stream-json', promptInputFormat: 'stream-json' });
    const { lifecycle, executor, child } = createHarness({ def, journal });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'stream json prompt', cwd: '/work' });
    await flushAsync();
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    const sent = calls.filter((call) => call.entry.provenance.source === 'host');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.entry.content).toBe('stream json prompt');
  });

  it('records raw stdout/stderr for an ACP-driven def, but not the ACP prompt itself (out of this driver\'s direct view)', async () => {
    const { journal, calls } = createSpyJournal();
    const { lifecycle, executor, child } = createAcpHarness({ journal });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'acp prompt', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', 'raw acp stdout');
    child.stderr.emit('data', 'raw acp stderr');
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(calls).toEqual([
      { runId: run.id, entry: { content: 'raw acp stdout', provenance: { source: 'agent', channel: 'stdout' }, trust: 'untrusted' } },
      { runId: run.id, entry: { content: 'raw acp stderr', provenance: { source: 'agent', channel: 'stderr' }, trust: 'untrusted' } },
    ]);
    expect(calls.some((call) => call.entry.content === 'acp prompt')).toBe(false);
  });

  it('records raw stdout/stderr for a pi-rpc-driven def, but not the pi-rpc prompt itself (out of this driver\'s direct view)', async () => {
    const { journal, calls } = createSpyJournal();
    const { lifecycle, executor, child } = createPiRpcHarness({ journal });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'pi prompt', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', 'raw pi stdout');
    child.stderr.emit('data', 'raw pi stderr');
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(calls).toEqual([
      { runId: run.id, entry: { content: 'raw pi stdout', provenance: { source: 'agent', channel: 'stdout' }, trust: 'untrusted' } },
      { runId: run.id, entry: { content: 'raw pi stderr', provenance: { source: 'agent', channel: 'stderr' }, trust: 'untrusted' } },
    ]);
    expect(calls.some((call) => call.entry.content === 'pi prompt')).toBe(false);
  });
});

describe('AgentExecutor — gap 5 session resume (RunEndPayload.sessionRef)', () => {
  it('threads a captured ACP session id through to the terminal end event as sessionRef', async () => {
    const { lifecycle, executor, child, attachCalls } = createAcpHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    attachCalls[0]!.send('agent', { type: 'status', label: 'initializing', sessionId: 'acp-sess-1' });
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const endEvent = events.find((e) => e.kind === 'end');
    expect(endEvent?.payload).toMatchObject({ sessionRef: 'acp-sess-1' });
  });

  it('threads a captured pi-rpc session id through to the terminal end event as sessionRef', async () => {
    const { lifecycle, executor, child, attachCalls } = createPiRpcHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    attachCalls[0]!.send('agent', { type: 'status', label: 'initializing', sessionId: 'pi-sess-1' });
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const endEvent = events.find((e) => e.kind === 'end');
    expect(endEvent?.payload).toMatchObject({ sessionRef: 'pi-sess-1' });
  });

  it('omits sessionRef from the terminal end event when no session id was ever reported (ACP)', async () => {
    const { lifecycle, executor, child } = createAcpHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const endEvent = events.find((e) => e.kind === 'end');
    expect(endEvent?.payload).not.toHaveProperty('sessionRef');
  });

  it('keeps the most recently reported session id when multiple status events arrive (child-driven path)', async () => {
    const def = createFakeDef({ streamFormat: 'json-event-stream', eventParser: 'codex' });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-first' })}\n`);
    child.stdout.emit('data', `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-second' })}\n`);
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const endEvent = events.find((e) => e.kind === 'end');
    expect(endEvent?.payload).toMatchObject({ sessionRef: 'thread-second' });
  });
});

describe('AgentExecutor — gap 3 capability-routed continuation (stdin-tool-result injection)', () => {
  function streamJsonDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
    return createFakeDef({ streamFormat: 'claude-stream-json', promptInputFormat: 'stream-json', ...overrides });
  }

  function toolUseTurnEnd(toolUseId: string, name: string, input: unknown, stopReason: string): string {
    return `${JSON.stringify({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: toolUseId, name, input }], stop_reason: stopReason },
    })}\n`;
  }

  it('closes stdin on a tool_use turn_end exactly as before when no continuation is configured (default, unchanged behavior)', async () => {
    const { lifecycle, executor, child } = createHarness({ def: streamJsonDef() });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', toolUseTurnEnd('tu-1', 'Bash', { command: 'ls' }, 'tool_use'));
    await flushAsync();

    expect(child.stdin!.end).toHaveBeenCalledTimes(1);
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);
  });

  it('closes stdin on a tool_use turn_end when continuation is configured but the tool name is not allowlisted', async () => {
    const { toolExecutor, calls } = createFakeToolExecutor(() => ({ executionId: 'exec-1', status: 'completed', output: 'ok' }));
    const continuation: ContinuationOptions = { toolExecutor, principal: TEST_PRINCIPAL, autonomousToolNames: new Set(['other_tool']) };
    const { lifecycle, executor, child } = createHarness({ def: streamJsonDef(), continuation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', toolUseTurnEnd('tu-1', 'Bash', { command: 'ls' }, 'tool_use'));
    await flushAsync();

    expect(child.stdin!.end).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);
  });

  it('closes stdin on a non-tool_use turn_end even when continuation is configured and the tool would have been allowlisted', async () => {
    const { toolExecutor, calls } = createFakeToolExecutor(() => ({ executionId: 'exec-1', status: 'completed', output: 'ok' }));
    const continuation: ContinuationOptions = { toolExecutor, principal: TEST_PRINCIPAL, autonomousToolNames: new Set(['Bash']) };
    const { lifecycle, executor, child } = createHarness({ def: streamJsonDef(), continuation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit(
      'data',
      `${JSON.stringify({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } })}\n`,
    );
    await flushAsync();

    expect(child.stdin!.end).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);
  });

  it('auto-resolves an allowlisted tool_use through the injected ToolExecutor, keeps stdin open, and injects a structured tool_result JSONL line', async () => {
    const { toolExecutor, calls } = createFakeToolExecutor((toolId, input) => {
      expect(toolId).toBe('Bash');
      expect(input).toEqual({ command: 'ls' });
      return { executionId: 'exec-1', status: 'completed', output: 'file1.txt\nfile2.txt' };
    });
    const continuation: ContinuationOptions = { toolExecutor, principal: TEST_PRINCIPAL, autonomousToolNames: new Set(['Bash']) };
    const { lifecycle, executor, child } = createHarness({ def: streamJsonDef(), continuation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', toolUseTurnEnd('tu-1', 'Bash', { command: 'ls' }, 'tool_use'));
    await flushAsync();

    expect(calls).toEqual([{ principal: TEST_PRINCIPAL, run: { id: run.id }, toolId: 'Bash', input: { command: 'ls' } }]);
    expect(child.stdin!.end).not.toHaveBeenCalled();

    const injectedLine = child.stdin!.writes.at(-1)!;
    expect(JSON.parse(injectedLine.trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'file1.txt\nfile2.txt' }] },
    });

    const events = await collectEvents(lifecycle, run.id);
    const toolResultEvent = events.find((e) => e.kind === 'agent' && (e.payload as RunAgentPayload).type === 'tool_result');
    expect(toolResultEvent?.payload).toMatchObject({ type: 'tool_result', toolUseId: 'tu-1', content: 'file1.txt\nfile2.txt' });

    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);
  });

  it('injects an isError tool_result JSONL line when the injected tool execution is denied by policy', async () => {
    const { toolExecutor } = createFakeToolExecutor(() => ({ executionId: 'exec-1', status: 'denied' }));
    const continuation: ContinuationOptions = { toolExecutor, principal: TEST_PRINCIPAL, autonomousToolNames: new Set(['Bash']) };
    const { lifecycle, executor, child } = createHarness({ def: streamJsonDef(), continuation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', toolUseTurnEnd('tu-1', 'Bash', { command: 'rm -rf /' }, 'tool_use'));
    await flushAsync();

    const injectedLine = child.stdin!.writes.at(-1)!;
    expect(JSON.parse(injectedLine.trim())).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'Tool execution denied by policy.', is_error: true }],
      },
    });

    const events = await collectEvents(lifecycle, run.id);
    const toolResultEvent = events.find((e) => e.kind === 'agent' && (e.payload as RunAgentPayload).type === 'tool_result');
    expect(toolResultEvent?.payload).toMatchObject({ type: 'tool_result', toolUseId: 'tu-1', isError: true });

    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);
  });

  it('injects an isError tool_result JSONL line when the injected ToolExecutor.execute() itself throws', async () => {
    const { toolExecutor } = createFakeToolExecutor(() => {
      throw new Error('registry lookup failed');
    });
    const continuation: ContinuationOptions = { toolExecutor, principal: TEST_PRINCIPAL, autonomousToolNames: new Set(['Bash']) };
    const { lifecycle, executor, child } = createHarness({ def: streamJsonDef(), continuation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', toolUseTurnEnd('tu-1', 'Bash', { command: 'ls' }, 'tool_use'));
    await flushAsync();

    const injectedLine = child.stdin!.writes.at(-1)!;
    expect(JSON.parse(injectedLine.trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'registry lookup failed', is_error: true }] },
    });

    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);
  });

  it('journals the injected tool_result content as trusted, host-sent stdin bytes (gap 1 coverage of the new write path)', async () => {
    const { journal, calls: journalCalls } = createSpyJournal();
    const { toolExecutor } = createFakeToolExecutor(() => ({ executionId: 'exec-1', status: 'completed', output: 'ok' }));
    const continuation: ContinuationOptions = { toolExecutor, principal: TEST_PRINCIPAL, autonomousToolNames: new Set(['Bash']) };
    const { lifecycle, executor, child } = createHarness({ def: streamJsonDef(), journal, continuation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', toolUseTurnEnd('tu-1', 'Bash', { command: 'ls' }, 'tool_use'));
    await flushAsync();

    const sentCalls = journalCalls.filter((call) => call.entry.provenance.source === 'host');
    expect(sentCalls.at(-1)?.entry).toEqual({ content: 'ok', provenance: { source: 'host', channel: 'stdin' }, trust: 'trusted' });

    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);
  });

  it('still resolves the injected tool through ToolExecutor but no-ops the stdin write when child.stdin is unexpectedly absent', async () => {
    const { toolExecutor, calls } = createFakeToolExecutor(() => ({ executionId: 'exec-1', status: 'completed', output: 'ok' }));
    const continuation: ContinuationOptions = { toolExecutor, principal: TEST_PRINCIPAL, autonomousToolNames: new Set(['Bash']) };
    const { lifecycle, executor, child } = createHarness({ def: streamJsonDef(), omitStdin: true, continuation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.stdout.emit('data', toolUseTurnEnd('tu-1', 'Bash', { command: 'ls' }, 'tool_use'));
    await flushAsync();

    expect(calls).toHaveLength(1);
    child.emit('close', 0, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);
  });

  it('does not inject through the mcp-callback-primary transport (claude/codebuddy resolve to mcp-callback, not stdin-injection) even when a def is otherwise eligible', () => {
    // resolveContinuationTransport itself is exhaustively tested in continuation-transport.test.ts;
    // this just documents, at the agent-executor integration level, that createFakeDef's
    // synthetic def (no externalMcpInjection) is what makes 'stdin-injection' reachable in these
    // tests at all — a real claude/codebuddy def would resolve to 'mcp-callback' instead, and gap
    // 3's MCP-callback spike (not this stdin path) is what drives those in production.
    const def = streamJsonDef();
    expect(def.externalMcpInjection).toBeUndefined();
  });
});

describe('AgentExecutor — gap 4 failure classifier (CreateAgentExecutorOptions.classifyFailure)', () => {
  it('stays resumable:false on a failed run when no classifier is configured (default, unchanged behavior) — child-driven path', async () => {
    const { lifecycle, executor, child } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 1, null);
    await runPromise;
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('failed');
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ resumable: false });
  });

  it('never consults the classifier for a succeeded run', async () => {
    const classifyFailure = vi.fn(() => true);
    const def = createFakeDef({ streamFormat: 'plain' });
    const { lifecycle, executor, child } = createHarness({ def, classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 0, null);
    await runPromise;
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
    expect(classifyFailure).not.toHaveBeenCalled();
  });

  it('never consults the classifier for a cancelled run', async () => {
    const classifyFailure = vi.fn(() => true);
    const def = createFakeDef({ streamFormat: 'plain' });
    const { lifecycle, executor, child } = createHarness({ def, classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await lifecycle.cancel({ runId: run.id });
    child.emit('close', null, 'SIGTERM');
    await runPromise;
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('cancelled');
    expect(classifyFailure).not.toHaveBeenCalled();
  });

  it('consults the classifier on a failed child-driven run and honors a synchronous true result', async () => {
    const classifyFailure = vi.fn((ctx: { runId: string; agentId: string; code: number | null; signal: string | null }) => {
      expect(ctx.agentId).toBe('fake-agent');
      expect(ctx.code).toBe(1);
      expect(ctx.signal).toBeNull();
      return true;
    });
    const { lifecycle, executor, child } = createHarness({ classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 1, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(classifyFailure).toHaveBeenCalledTimes(1);
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ resumable: true });
  });

  it('honors an asynchronous (Promise-returning) classifier and a false result', async () => {
    const classifyFailure = vi.fn(async () => false);
    const { lifecycle, executor, child } = createHarness({ classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 1, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ resumable: false });
  });

  it('consults the classifier on a failed ACP-driven run', async () => {
    const classifyFailure = vi.fn((ctx: { agentId: string }) => {
      expect(ctx.agentId).toBe('fake-agent');
      return true;
    });
    const { lifecycle, executor, child } = createAcpHarness({ completedSuccessfully: false, classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 1, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(classifyFailure).toHaveBeenCalledTimes(1);
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ resumable: true });
  });

  it('ACP-driven run: sideEffects reflects real tool_use/text_delta events observed before close', async () => {
    const classifyFailure = vi.fn((_ctx: Parameters<ClassifyFailure>[0]) => true);
    const { lifecycle, executor, child, attachCalls } = createAcpHarness({ completedSuccessfully: false, classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    attachCalls[0]!.send('agent', { type: 'tool_use', id: 'call-1', name: 'bash', input: {} });
    attachCalls[0]!.send('agent', { type: 'text_delta', delta: 'hello' });
    child.emit('close', 1, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(classifyFailure).toHaveBeenCalledTimes(1);
    expect(classifyFailure.mock.calls[0]![0].sideEffects).toEqual({ userVisibleOutputSeen: true, toolCallSeen: true });
  });

  it("ACP-driven run: sideEffects stays false/false when no tool_use/text_delta was observed and an empty delta doesn't count", async () => {
    const classifyFailure = vi.fn((_ctx: Parameters<ClassifyFailure>[0]) => true);
    const { lifecycle, executor, child, attachCalls } = createAcpHarness({ completedSuccessfully: false, classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    attachCalls[0]!.send('agent', { type: 'text_delta', delta: '' });
    child.emit('close', 1, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(classifyFailure.mock.calls[0]![0].sideEffects).toEqual({ userVisibleOutputSeen: false, toolCallSeen: false });
  });

  it('consults the classifier on a failed pi-rpc-driven run', async () => {
    const classifyFailure = vi.fn((ctx: { agentId: string }) => {
      expect(ctx.agentId).toBe('fake-agent');
      return true;
    });
    const { lifecycle, executor, child } = createPiRpcHarness({ hasFatalError: true, classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 1, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(classifyFailure).toHaveBeenCalledTimes(1);
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ resumable: true });
  });

  it('pi-rpc-driven run: sideEffects reflects real tool_use/text_delta events observed before close', async () => {
    const classifyFailure = vi.fn((_ctx: Parameters<ClassifyFailure>[0]) => true);
    const { lifecycle, executor, child, attachCalls } = createPiRpcHarness({ hasFatalError: true, classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    attachCalls[0]!.send('agent', { type: 'tool_use', id: 'call-1', name: 'bash', input: {} });
    attachCalls[0]!.send('agent', { type: 'thinking_delta', delta: 'thinking...' });
    child.emit('close', 1, null);
    await runPromise;
    await lifecycle.waitForTerminal(run.id);

    expect(classifyFailure).toHaveBeenCalledTimes(1);
    expect(classifyFailure.mock.calls[0]![0].sideEffects).toEqual({ userVisibleOutputSeen: true, toolCallSeen: true });
  });

  it('never consults the classifier for a pre-spawn failure (no child ever ran)', async () => {
    const classifyFailure = vi.fn(() => true);
    const { lifecycle, executor } = createHarness({ def: null, classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_NOT_FOUND',
    });

    expect(classifyFailure).not.toHaveBeenCalled();
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ resumable: false });
  });
});

describe('buildMcpJsonServerEntry', () => {
  it('defaults args to an empty array when omitted', () => {
    expect(buildMcpJsonServerEntry('run-1', { command: '/usr/bin/jini-mcp', daemonUrl: 'http://127.0.0.1:4242' })).toEqual({
      command: '/usr/bin/jini-mcp',
      args: [],
      env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
    });
  });

  it('copies (does not alias) a supplied args array', () => {
    const args = ['--flag'];
    const entry = buildMcpJsonServerEntry('run-1', { command: 'jini-mcp', args, daemonUrl: 'http://127.0.0.1:4242' });
    expect(entry.args).toEqual(['--flag']);
    expect(entry.args).not.toBe(args);
  });
});

describe('mergeMcpJsonContent', () => {
  const entry = { command: 'jini-mcp', args: [], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };

  it('produces a fresh document when no existing content is given', () => {
    expect(JSON.parse(mergeMcpJsonContent(undefined, entry))).toEqual({ mcpServers: { jini: entry } });
  });

  it('preserves unrelated top-level keys and other registered servers', () => {
    const existing = JSON.stringify({ someOtherKey: true, mcpServers: { other: { command: 'other-bin', args: [], env: {} } } });
    const merged = JSON.parse(mergeMcpJsonContent(existing, entry));
    expect(merged).toEqual({
      someOtherKey: true,
      mcpServers: { other: { command: 'other-bin', args: [], env: {} }, jini: entry },
    });
  });

  it('overwrites a pre-existing "jini" entry rather than merging into it', () => {
    const existing = JSON.stringify({ mcpServers: { jini: { command: 'stale', args: ['--old'], env: {} } } });
    const merged = JSON.parse(mergeMcpJsonContent(existing, entry));
    expect(merged.mcpServers.jini).toEqual(entry);
  });

  it('starts fresh when the existing content is not valid JSON', () => {
    expect(JSON.parse(mergeMcpJsonContent('{not json', entry))).toEqual({ mcpServers: { jini: entry } });
  });

  it('starts fresh when the existing content parses to a JSON array, not an object', () => {
    expect(JSON.parse(mergeMcpJsonContent('[1,2,3]', entry))).toEqual({ mcpServers: { jini: entry } });
  });

  it('starts fresh when the existing document has a non-object "mcpServers" field', () => {
    const existing = JSON.stringify({ mcpServers: 'not-an-object' });
    expect(JSON.parse(mergeMcpJsonContent(existing, entry))).toEqual({ mcpServers: { jini: entry } });
  });

  it('emits pretty-printed JSON terminated by a trailing newline', () => {
    const content = mergeMcpJsonContent(undefined, entry);
    expect(content.endsWith('\n')).toBe(true);
    expect(content).toContain('\n  "mcpServers"');
  });
});

describe('AgentExecutor — gap 3 part 2 spawn-time .mcp.json injection (CreateAgentExecutorOptions.mcpJsonInjection)', () => {
  function createMcpFsSpies(existing: string | undefined = undefined): {
    mcpJsonInjection: McpJsonInjectionOptions;
    readCalls: string[];
    writeCalls: Array<{ path: string; content: string }>;
  } {
    const readCalls: string[] = [];
    const writeCalls: Array<{ path: string; content: string }> = [];
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/jini-mcp',
      args: ['--quiet'],
      daemonUrl: 'http://127.0.0.1:4242',
      readFile: async (path: string) => {
        readCalls.push(path);
        if (existing === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return existing;
      },
      writeFile: async (path: string, content: string) => {
        writeCalls.push({ path, content });
      },
    };
    return { mcpJsonInjection, readCalls, writeCalls };
  }

  it('spawns normally with no .mcp.json read/write attempted when mcpJsonInjection is unconfigured, even for a claude-mcp-json def', async () => {
    const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(spawnCalls).toHaveLength(1);
  });

  it('does not write .mcp.json for a def whose externalMcpInjection is not claude-mcp-json, even when configured', async () => {
    const { mcpJsonInjection, readCalls, writeCalls } = createMcpFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'acp-merge' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(readCalls).toEqual([]);
    expect(writeCalls).toEqual([]);
    expect(spawnCalls).toHaveLength(1);
  });

  it('does not write .mcp.json for a claude-mcp-json def when externalMcpInjection is simply absent', async () => {
    const { mcpJsonInjection, readCalls, writeCalls } = createMcpFsSpies();
    const def = createFakeDef();
    const { lifecycle, executor } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(readCalls).toEqual([]);
    expect(writeCalls).toEqual([]);
  });

  it('reads, merges, and writes .mcp.json into the run cwd before spawn for a configured claude-mcp-json def', async () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: 'x', args: [], env: {} } } });
    const { mcpJsonInjection, readCalls, writeCalls } = createMcpFsSpies(existing);
    const def = createFakeDef({ id: 'claude', externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work/proj' });

    expect(readCalls).toEqual(['/work/proj/.mcp.json']);
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]!.path).toBe('/work/proj/.mcp.json');
    const written = JSON.parse(writeCalls[0]!.content);
    expect(written).toEqual({
      mcpServers: {
        other: { command: 'x', args: [], env: {} },
        jini: {
          command: '/usr/bin/jini-mcp',
          args: ['--quiet'],
          env: { JINI_RUN_ID: run.id, JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
        },
      },
    });
    // The write happens strictly before spawn, not merely before this assertion.
    expect(spawnCalls).toHaveLength(1);
  });

  it('treats a rejecting readFile (e.g. ENOENT — no existing file) as "start fresh", not a failure', async () => {
    const { mcpJsonInjection, writeCalls } = createMcpFsSpies(undefined);
    const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(writeCalls).toHaveLength(1);
    expect(JSON.parse(writeCalls[0]!.content)).toEqual({
      mcpServers: {
        jini: {
          command: '/usr/bin/jini-mcp',
          args: ['--quiet'],
          env: { JINI_RUN_ID: run.id, JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
        },
      },
    });
    expect(spawnCalls).toHaveLength(1);
  });

  it('fails the run before spawn (never a bare throw) when writeFile rejects', async () => {
    const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/jini-mcp',
      daemonUrl: 'http://127.0.0.1:4242',
      readFile: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      writeFile: async () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
    });

    expect(spawnCalls).toHaveLength(0);
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ status: 'failed', resumable: false });
  });
});
