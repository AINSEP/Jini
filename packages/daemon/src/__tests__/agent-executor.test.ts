import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunAgentPayload, RunErrorPayload, RunProtocolEvent } from '@jini-ai/protocol';
import {
  AGENT_DEFS,
  agentCapabilities,
  attachAcpSession,
  attachPiRpcSession,
  getAgentDef,
  prepareAgentLogFile,
  preparePromptFileForAgent,
  type AcpSessionController,
  type AgentLaunchResolution,
  type PiRpcSession,
  type PromptAugmenter,
  type RuntimeAgentDef,
  type RuntimeBuildOptions,
  type RuntimeLock,
  type RuntimeLockAcquireContext,
  type RuntimeLockHandoffContext,
} from '@jini-ai/agent-runtime';
import type { Principal, RunRef } from '@jini-ai/core';
import type { JournalEntry } from '@jini-ai/protocol';
import { createInMemoryEventLog } from '../event-log.js';
import { createRunLifecycle, DEFAULT_SLOW_RUN_THRESHOLD_MS, type RunLifecycle } from '../run-lifecycle.js';
import { createRunByteJournal, type RunByteJournal } from '../continuation/journal.js';
import type { ToolExecutionResult, ToolExecutor } from '../tool-executor.js';
import {
  AgentExecutorError,
  DEFAULT_BUFFERED_STDOUT_MAX_BYTES,
  assessAgentExecutorCompatibility,
  buildAcpMcpBridgeServers,
  buildCodexHomeConfigToml,
  buildCodexMcpServerToml,
  buildMcpBridgeDelivery,
  buildMcpJsonServerEntry,
  computeChildEnv,
  createAgentExecutor,
  isAgentExecutorSupported,
  isSupportedStreamFormat,
  mergeEnvContentInstructions,
  mergeEnvContentMcpConfig,
  mergeMcpJsonContent,
  prepareSystemPromptOverlayFileIfNeeded,
  resolveSourceClaudeConfigDir,
  resolveSourceCodexHomeDir,
  resolveSystemPromptOverlayDelivery,
  translateAgentRuntimeEvent,
  type AgentExecutor,
  type AgentExecutorErrorCode,
  type ClassifyFailure,
  type ClaudeConfigDirIsolationOptions,
  type ContinuationOptions,
  type McpBridgeDelivery,
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
  /** Overrides the real `@jini-ai/agent-runtime` prompt-file stager (default: real — touches real disk under `os.tmpdir()`, a no-op for every def without `promptViaFile: true`). */
  preparePromptFileForAgent?: typeof preparePromptFileForAgent;
  /** Overrides the real `@jini-ai/agent-runtime` log-file stager (default: real — same deal, a no-op for every def without `needsAgentLogFile: true`). */
  prepareAgentLogFile?: typeof prepareAgentLogFile;
  /** Gap 1's byte-journal — omitted by default, matching `CreateAgentExecutorOptions.journal`'s own opt-in default. */
  journal?: RunByteJournal;
  /** Gap 3's stdin-tool-result injection config — omitted by default, matching `CreateAgentExecutorOptions.continuation`'s own opt-in default. */
  continuation?: ContinuationOptions;
  /** Gap 4's failure classifier — omitted by default, matching `CreateAgentExecutorOptions.classifyFailure`'s own opt-in default. */
  classifyFailure?: ClassifyFailure;
  /** Gap 3 part 2's spawn-time `.mcp.json` injection — omitted by default, matching `CreateAgentExecutorOptions.mcpJsonInjection`'s own opt-in default. */
  mcpJsonInjection?: McpJsonInjectionOptions;
  /** Finding 1's `CLAUDE_CONFIG_DIR` staging seams — omitted by default, matching `CreateAgentExecutorOptions.claudeConfigDirIsolation`'s own real-filesystem default. Supplying this alone does NOT stage anything; see `claudeConfigDirIsolationEnabled` below, the actual on/off switch. */
  claudeConfigDirIsolation?: ClaudeConfigDirIsolationOptions;
  /** The on/off switch for Finding 1's isolation — omitted by default, matching `CreateAgentExecutorOptions.claudeConfigDirIsolationEnabled`'s own default-`false` (the 2026-09-08 rollback: isolation now requires an explicit opt-in). */
  claudeConfigDirIsolationEnabled?: boolean;
  /** Ceiling on the `'until-close'` stdout accumulator — omitted by default so the real `DEFAULT_BUFFERED_STDOUT_MAX_BYTES` applies. */
  bufferedStdoutMaxBytes?: number;
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
    ...(options.prepareAgentLogFile !== undefined ? { prepareAgentLogFile: options.prepareAgentLogFile } : {}),
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
    ...(options.claudeConfigDirIsolation !== undefined
      ? { claudeConfigDirIsolation: options.claudeConfigDirIsolation }
      : {}),
    ...(options.claudeConfigDirIsolationEnabled !== undefined
      ? { claudeConfigDirIsolationEnabled: options.claudeConfigDirIsolationEnabled }
      : {}),
    ...(options.bufferedStdoutMaxBytes !== undefined
      ? { bufferedStdoutMaxBytes: options.bufferedStdoutMaxBytes }
      : {}),
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

  it('forwards permissionMode to buildArgs even when model/reasoning are both absent', async () => {
    const buildArgs = vi.fn(() => ['--flag']);
    const { lifecycle, executor } = createHarness({ def: createFakeDef({ buildArgs }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-permission-mode' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'do the thing',
      cwd: '/work',
      permissionMode: 'restricted',
    });
    await flushAsync();
    await runPromise;

    expect(buildArgs).toHaveBeenCalledWith('do the thing', [], undefined, { permissionMode: 'restricted' }, undefined);
  });

  it('omits the options object entirely when model, reasoning, and permissionMode are all absent', async () => {
    const buildArgs = vi.fn(() => ['--flag']);
    const { lifecycle, executor } = createHarness({ def: createFakeDef({ buildArgs }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-no-options' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(buildArgs).toHaveBeenCalledWith('do the thing', [], undefined, undefined, undefined);
  });

  it('forwards a host-supplied resumeSessionId into runtimeContext even when nothing else is staged', async () => {
    const buildArgs = vi.fn(() => ['--flag']);
    const { lifecycle, executor } = createHarness({ def: createFakeDef({ buildArgs }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-resume-session' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'do the thing',
      cwd: '/work',
      resumeSessionId: 'sess-from-prior-turn',
    });
    await flushAsync();
    await runPromise;

    expect(buildArgs).toHaveBeenCalledWith('do the thing', [], undefined, undefined, { resumeSessionId: 'sess-from-prior-turn' });
  });

  it('forwards a host-minted newSessionId into runtimeContext even when nothing else is staged', async () => {
    const buildArgs = vi.fn(() => ['--flag']);
    const { lifecycle, executor } = createHarness({ def: createFakeDef({ buildArgs }) });
    const { run } = await lifecycle.start({ contextRef: 'ctx-new-session' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'do the thing',
      cwd: '/work',
      newSessionId: 'freshly-minted-id',
    });
    await flushAsync();
    await runPromise;

    expect(buildArgs).toHaveBeenCalledWith('do the thing', [], undefined, undefined, { newSessionId: 'freshly-minted-id' });
  });
});

describe('AgentExecutor — image prompt delivery (MSG-4: prompt-path defs)', () => {
  it("augments the prompt and widens extraAllowedDirs for a 'prompt-path' def, and the augmented prompt (not the raw one) is what actually reaches stdin", async () => {
    const buildArgs = vi.fn((...args: Parameters<RuntimeAgentDef['buildArgs']>) => ['--flag']);
    const def = createFakeDef({ buildArgs, imageDelivery: 'prompt-path' });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-image-prompt-path' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'describe this',
      cwd: '/work',
      imagePaths: ['/uploads/reference.png'],
      extraAllowedDirs: ['/project'],
    });
    await flushAsync();
    await runPromise;

    // buildArgs' first arg (the prompt) is augmented, and its third arg (extraAllowedDirs) is
    // widened with the image's own directory merged in alongside the caller-supplied one.
    const [promptArg, imagePathsArg, extraAllowedDirsArg] = buildArgs.mock.calls[0]!;
    expect(promptArg).toContain('describe this');
    expect(promptArg).toContain('1. /uploads/reference.png');
    expect(imagePathsArg).toEqual(['/uploads/reference.png']); // unchanged — still raw, for a def that also wants it directly
    expect(extraAllowedDirsArg).toEqual(['/project', '/uploads']);

    // What's actually written to stdin (a text-format def, per createFakeDef's default) is the
    // SAME augmented prompt, not the raw one — this is the field that actually reaches the model.
    expect(child.stdin!.writes).toEqual([promptArg]);
  });

  it("is byte-identical to today's behavior for a 'prompt-path' def when there are zero images", async () => {
    const buildArgs = vi.fn(() => ['--flag']);
    const def = createFakeDef({ buildArgs, imageDelivery: 'prompt-path' });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-image-prompt-path-empty' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'do the thing', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(buildArgs).toHaveBeenCalledWith('do the thing', [], undefined, undefined, undefined);
    expect(child.stdin!.writes).toEqual(['do the thing']);
  });

  it("does not augment a path containing spaces and quotes out of existence — it survives verbatim into both the prompt and extraAllowedDirs", async () => {
    const buildArgs = vi.fn((...args: Parameters<RuntimeAgentDef['buildArgs']>) => ['--flag']);
    const def = createFakeDef({ buildArgs, imageDelivery: 'prompt-path' });
    const { lifecycle, executor } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-image-prompt-path-quotes' });
    const weirdPath = '/Users/x/My Pictures/a "great" shot.png';

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'describe this',
      cwd: '/work',
      imagePaths: [weirdPath],
    });
    await flushAsync();
    await runPromise;

    const [promptArg, , extraAllowedDirsArg] = buildArgs.mock.calls[0]!;
    expect(promptArg).toContain(weirdPath);
    expect(extraAllowedDirsArg).toEqual(['/Users/x/My Pictures']);
  });

  it("does NOT augment the prompt or widen extraAllowedDirs for a 'native' def, even with images present — the double-delivery hazard MSG-4 named", async () => {
    const buildArgs = vi.fn(() => ['--flag']);
    const def = createFakeDef({ buildArgs, imageDelivery: 'native' });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-image-native' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'describe this',
      cwd: '/work',
      imagePaths: ['/uploads/reference.png'],
    });
    await flushAsync();
    await runPromise;

    expect(buildArgs).toHaveBeenCalledWith(
      'describe this', // unaugmented
      ['/uploads/reference.png'],
      undefined, // unwidened
      undefined,
      undefined,
    );
    expect(child.stdin!.writes).toEqual(['describe this']);
  });

  it("does NOT augment the prompt handed to an ACP session, even for a def with imageDelivery: 'native' and images present — ACP's own resource_link mechanism already delivers them", async () => {
    const { lifecycle, executor, attachCalls } = createAcpHarness({ def: { imageDelivery: 'native' } });
    const { run } = await lifecycle.start({ contextRef: 'ctx-acp-image-native' });

    const runPromise = executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'describe this',
      cwd: '/work',
      imagePaths: ['/uploads/reference.png'],
    });
    await flushAsync();
    await runPromise;

    expect(attachCalls[0]?.prompt).toBe('describe this');
    expect(attachCalls[0]?.imagePaths).toEqual(['/uploads/reference.png']);
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

  // Inverted deliberately. This test used to assert that antigravity was
  // rejected *by id* even though it satisfied every other guard. Antigravity's
  // two real needs are now met by declarative def fields (`needsAgentLogFile`/
  // `stdoutPolicy`/`runtimeLock`) the driver reads generically, so the id
  // branch is gone. What must stay true — and is what this now pins — is that
  // no guard keys off an agent id at all: the id `'antigravity'` must not by
  // itself change the answer either way.
  it('no longer rejects a def by its id: the literal id "antigravity" is not what any guard reads', async () => {
    const { lifecycle, executor, child } = createHarness({
      def: createFakeDef({ id: 'antigravity', streamFormat: 'plain', promptViaStdin: true }),
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'antigravity', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await expect(runPromise).resolves.toBeUndefined();

    child.emit('close', 0, null);
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
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
  it('constructs cleanly with only { lifecycle } — every collaborator falls back to its real @jini-ai/agent-runtime / @jini-ai/platform / node:child_process default', () => {
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

      // Run-scoped filename, not `.mcp.json` — see `mcpJsonPathForRun`. Discovered by listing rather
      // than hardcoding the naming scheme, so this test asserts the real-fs round trip (its subject)
      // and leaves the naming rule to the tests that own it.
      const writtenNames = (await fs.readdir(tmpDir)).filter((name) => name.startsWith('.mcp.'));
      expect(writtenNames).toHaveLength(1);
      expect(writtenNames[0]).not.toBe('.mcp.json');
      const written = JSON.parse(await fs.readFile(path.join(tmpDir, writtenNames[0]!), 'utf8'));
      expect(written).toEqual({
        mcpServers: {
          jini: { command: '/usr/bin/jini-mcp', args: [], env: { JINI_RUN_ID: run.id, JINI_DAEMON_URL: 'http://127.0.0.1:4242' } },
        },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("passes runtimeContext.mcpJsonPath to buildArgs for a 'claude-mcp-json' def when mcpJsonInjection is configured, computed BEFORE the file is written", async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jini-mcp-json-path-'));
    try {
      const eventLog = createInMemoryEventLog();
      const lifecycle = createRunLifecycle({ eventLog });
      let seenMcpJsonPath: string | undefined;
      const def = createFakeDef({
        id: 'claude',
        externalMcpInjection: 'claude-mcp-json',
        buildArgs: (_prompt, _imagePaths, _extra, _options, runtimeContext) => {
          seenMcpJsonPath = runtimeContext?.mcpJsonPath;
          return ['--flag'];
        },
      });
      const child = createFakeChild(6101);
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
        mcpJsonInjection: { command: '/usr/bin/jini-mcp', daemonUrl: 'http://127.0.0.1:4242' },
      });

      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: tmpDir });

      // Inside the run cwd, run-scoped, and never the project's own `.mcp.json` — see `mcpJsonPathForRun`.
      expect(path.dirname(seenMcpJsonPath as string)).toBe(tmpDir);
      expect(seenMcpJsonPath).not.toBe(path.join(tmpDir, '.mcp.json'));
      expect(seenMcpJsonPath).toContain(run.id);
      // Real by spawn time, even though buildArgs (which computed the path) ran before the write.
      const written = JSON.parse(await fs.readFile(seenMcpJsonPath as string, 'utf8'));
      expect(written.mcpServers.jini.command).toBe('/usr/bin/jini-mcp');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('leaves runtimeContext.mcpJsonPath absent for a def whose externalMcpInjection is not claude-mcp-json, even with mcpJsonInjection configured', async () => {
    const eventLog = createInMemoryEventLog();
    const lifecycle = createRunLifecycle({ eventLog });
    let sawRuntimeContext: unknown = 'not-called';
    const def = createFakeDef({
      id: 'fake-agent',
      // No externalMcpInjection at all — matches every non-claude-mcp-json def.
      buildArgs: (_prompt, _imagePaths, _extra, _options, runtimeContext) => {
        sawRuntimeContext = runtimeContext;
        return ['--flag'];
      },
    });
    const child = createFakeChild(6102);
    const fakeSpawn = (() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as unknown as ChildProcess;
    }) as unknown as typeof nodeSpawn;

    const executor = createAgentExecutor({
      lifecycle,
      getAgentDef: (id: string) => (def.id === id ? def : null),
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
      listProcessSnapshots: async () => [],
      stopProcesses: async () => ({ alreadyStopped: false, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }),
      mcpJsonInjection: { command: '/usr/bin/jini-mcp', daemonUrl: 'http://127.0.0.1:4242' },
    });

    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/tmp' });

    // Neither promptFilePath/agentLogFilePath (fake-agent has neither flag) nor mcpJsonPath apply
    // here, so runtimeContext stays undefined entirely — unchanged from before this field existed.
    expect(sawRuntimeContext).toBeUndefined();
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
// for `@jini-ai/agent-runtime`'s real ACP transport, matching the `spawn`/
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
  /** The `'acp-merge'` delivery mechanism's payload — `undefined` when `wireAcpLifecycle` passed none at all, which is distinct from passing `[]`. */
  readonly mcpServers: readonly unknown[] | undefined;
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
  /** Overrides the real `@jini-ai/agent-runtime` log-file stager — only meaningful alongside `def: { needsAgentLogFile: true }`. */
  prepareAgentLogFile?: typeof prepareAgentLogFile;
  /** MCP bridge injection — omitted by default, matching `CreateAgentExecutorOptions.mcpJsonInjection`'s own opt-in default. */
  mcpJsonInjection?: McpJsonInjectionOptions;
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
    mcpServers?: readonly unknown[];
    onPermissionRequest?: unknown;
    send: (event: string, payload: unknown) => void;
  }) => {
    attachCalls.push({
      prompt: attachOptions.prompt,
      cwd: attachOptions.cwd,
      model: attachOptions.model,
      imagePaths: attachOptions.imagePaths,
      envFormat: attachOptions.envFormat,
      mcpServers: attachOptions.mcpServers,
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
    ...(options.prepareAgentLogFile !== undefined ? { prepareAgentLogFile: options.prepareAgentLogFile } : {}),
    ...(options.mcpJsonInjection !== undefined ? { mcpJsonInjection: options.mcpJsonInjection } : {}),
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
// seam for `@jini-ai/agent-runtime`'s real pi-rpc transport), mirroring the ACP
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
  /** Overrides the real `@jini-ai/agent-runtime` log-file stager — only meaningful alongside `def: { needsAgentLogFile: true }`. */
  prepareAgentLogFile?: typeof prepareAgentLogFile;
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
    ...(options.prepareAgentLogFile !== undefined ? { prepareAgentLogFile: options.prepareAgentLogFile } : {}),
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
    // test in this suite proving the actual @jini-ai/agent-runtime filesystem behavior end to end.
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

// ---------------------------------------------------------------------------
// Antigravity — the 24th def, driven through declarative `RuntimeAgentDef`
// fields rather than a `def.id === 'antigravity'` branch. Its two needs:
//   (1) `agy` can print an OAuth sign-in URL to stdout and still exit 0, so
//       stdout must be buffered until close, sanitized, then emitted;
//   (2) its model choice is written into one process-global settings.json that
//       `agy` reads at its own startup, so concurrent runs must serialize.
// Every test below drives those through the *generic* fields, using fake defs
// that declare them — so the driver is proved to key off the fields, never the
// id. See packages/daemon/source-map.md's 2026-07-29 addition.
// ---------------------------------------------------------------------------

/** A staged-log-file stager whose path is caller-controlled, recording each call and its cleanup. */
function createFakeLogFileStager(logPath = '/fake/tmp/agent.log'): {
  prepareAgentLogFile: typeof prepareAgentLogFile;
  calls: string[];
  cleanup: ReturnType<typeof vi.fn>;
} {
  const calls: string[] = [];
  const cleanup = vi.fn(async () => {});
  return {
    calls,
    cleanup,
    prepareAgentLogFile: (async (def: RuntimeAgentDef | null | undefined, label: string) => {
      if (!def?.needsAgentLogFile) return null;
      calls.push(label);
      return { path: logPath, cleanup };
    }) as unknown as typeof prepareAgentLogFile,
  };
}

describe('AgentExecutor — stdoutPolicy: buffer-until-close + sanitize (antigravity)', () => {
  /** The real agy print-mode auth-prompt stdout, split so the URL straddles two `'data'` events. */
  const AUTH_CHUNKS = [
    'Authentication required. Please visit the URL to log in: https://accounts.google.com/o/oa',
    'uth2/auth?client_id=12345&redirect_uri=antigravity-redirect\n',
    'Waiting for authentication (timeout 30s)...\nError: authentication timed out.\n',
  ];

  function createBufferedDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
    return createFakeDef({
      id: 'fake-antigravity',
      name: 'Fake Antigravity',
      streamFormat: 'plain',
      promptViaStdin: true,
      needsAgentLogFile: true,
      stdoutPolicy: {
        buffering: 'until-close',
        sanitize: (fullText) => fullText.replace(/https:\/\/accounts\.google\.com\/\S*/g, '[redacted sign-in URL]'),
      },
      buildArgs: (_prompt, _imagePaths, _extra, _options, runtimeContext) =>
        runtimeContext?.agentLogFilePath ? ['--log-file', runtimeContext.agentLogFilePath, '-p', '-'] : ['-p', '-'],
      ...overrides,
    });
  }

  it('emits nothing at all until the child closes, then exactly one sanitized text_delta with the leaked URL absent', async () => {
    const stager = createFakeLogFileStager();
    const def = createBufferedDef();
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'hello', cwd: '/work' });
    await flushAsync();
    await runPromise;

    for (const chunk of AUTH_CHUNKS) child.stdout.emit('data', chunk);
    await flushAsync();

    // THE assertion this whole feature exists for: with the child still alive
    // and the URL already on stdout, the client has seen nothing — on either
    // the chat channel or the raw echo channel.
    const midRun = await collectEvents(lifecycle, run.id);
    expect(midRun.filter((e) => e.kind === 'agent')).toEqual([]);
    expect(midRun.filter((e) => e.kind === 'stdout')).toEqual([]);

    child.emit('close', 0, null);
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['text_delta']);
    const delta = (events.find((e) => e.kind === 'agent')!.payload as RunAgentPayload & { type: 'text_delta' }).delta;

    // The URL straddled two chunks, which is exactly why a per-chunk sanitizer
    // could not have caught it.
    expect(delta).not.toContain('accounts.google.com');
    expect(delta).not.toContain('client_id=12345');
    expect(delta).toContain('Please visit the URL to log in: [redacted sign-in URL]');
    expect(delta).toContain('Error: authentication timed out.');

    // The raw 'stdout' echo is held back and sanitized too — emitting it raw
    // would leak the exact string the sanitizer exists to remove.
    const stdoutChunks = events.filter((e) => e.kind === 'stdout').map((e) => (e.payload as { chunk: string }).chunk);
    expect(stdoutChunks).toEqual([delta]);

    // …and finish() still lands last.
    expect(events[events.length - 1]).toMatchObject({ kind: 'end', payload: { status: 'succeeded', code: 0 } });
  });

  it('concatenates many chunks in arrival order through the FIFO emit queue, flushing before finish()', async () => {
    const stager = createFakeLogFileStager();
    // No sanitizer, so the flushed text is provably the raw concatenation and
    // this test measures ordering only.
    const def = createBufferedDef({ stdoutPolicy: { buffering: 'until-close' } });
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    const chunkCount = 25;
    const expected = Array.from({ length: chunkCount }, (_, i) => `chunk-${i}`);
    // Synchronously back-to-back, and interleaved with stderr, whose events go
    // out live — the buffered stdout must still land as one event after them.
    for (let i = 0; i < chunkCount; i++) {
      child.stdout.emit('data', expected[i]);
      if (i === 12) child.stderr.emit('data', 'a warning mid-stream');
    }
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    const kinds = events.map((e) => e.kind);
    const deltas = events
      .filter((e) => e.kind === 'agent')
      .map((e) => (e.payload as RunAgentPayload & { type: 'text_delta' }).delta);
    expect(deltas).toEqual([expected.join('')]);
    // Ordering, positionally: stderr (live) → stdout flush → agent flush → end.
    expect(kinds).toEqual(['start', 'stderr', 'stdout', 'agent', 'end']);
  });

  it('emits nothing when a buffered run produces no stdout at all (an empty text_delta is noise)', async () => {
    const stager = createFakeLogFileStager();
    const def = createBufferedDef();
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    expect(events.filter((e) => e.kind === 'agent' || e.kind === 'stdout')).toEqual([]);
  });

  it('emits nothing when the sanitizer redacts the output down to nothing', async () => {
    const stager = createFakeLogFileStager();
    const def = createBufferedDef({ stdoutPolicy: { buffering: 'until-close', sanitize: () => '' } });
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit('data', 'entirely unsafe output');
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const events = await collectEvents(lifecycle, run.id);
    expect(events.filter((e) => e.kind === 'agent' || e.kind === 'stdout')).toEqual([]);
  });

  it('records the raw, unsanitized bytes in the byte journal — a host-owned log that is never replayed to run-event subscribers', async () => {
    // The journal's contract is "every byte received" and it deliberately lives
    // in a separate EventLog instance (see continuation/journal.ts's module
    // doc), so it is the one place raw bytes are still kept.
    const { journal, calls } = createSpyJournal();
    const stager = createFakeLogFileStager();
    const def = createBufferedDef();
    const { lifecycle, executor, child } = createHarness({ def, journal, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    for (const chunk of AUTH_CHUNKS) child.stdout.emit('data', chunk);
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const received = calls.filter((c) => c.entry.trust === 'untrusted').map((c) => c.entry.content);
    expect(received).toEqual(AUTH_CHUNKS);
    // But the client-facing stream carries only the sanitized copy.
    const events = await collectEvents(lifecycle, run.id);
    expect(JSON.stringify(events)).not.toContain('accounts.google.com');
  });

  it('keeps streaming live, per chunk, for a plain def that declares no stdoutPolicy at all (the other 4)', async () => {
    // The explicit regression pin for grok-build/aider/deepseek/qwen: the same
    // fake def, the same chunks, differing only in the absence of stdoutPolicy.
    const def = createFakeDef({ id: 'fake-qwen', streamFormat: 'plain', promptViaStdin: true });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-qwen', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    for (const chunk of AUTH_CHUNKS) child.stdout.emit('data', chunk);
    await flushAsync();

    // Already visible — before any close event.
    const midRun = await collectEvents(lifecycle, run.id);
    const midDeltas = midRun
      .filter((e) => e.kind === 'agent')
      .map((e) => (e.payload as RunAgentPayload & { type: 'text_delta' }).delta);
    expect(midDeltas).toEqual(AUTH_CHUNKS);
    expect(midRun.filter((e) => e.kind === 'stdout').map((e) => (e.payload as { chunk: string }).chunk)).toEqual(AUTH_CHUNKS);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
    // No extra flush event appended on close for a live def.
    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toEqual(['text_delta', 'text_delta', 'text_delta']);
  });

  it("does not buffer a def whose stdoutPolicy explicitly says 'live'", async () => {
    const def = createFakeDef({ streamFormat: 'plain', promptViaStdin: true, stdoutPolicy: { buffering: 'live' } });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit('data', 'live chunk');
    await flushAsync();
    expect(agentPayloadTypes(await collectEvents(lifecycle, run.id))).toEqual(['text_delta']);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  // A buffered def's accumulator is fed straight from the child's stdout, and a spawned agent CLI is
  // explicitly treated as potentially adversarial everywhere else in this driver (see SEC-001 on its
  // environment). `'until-close'` means "hold everything until the process closes" — so a child that
  // never closes, or emits without bound, had no ceiling, no backpressure, and no spooling: one
  // string grew until the daemon died, taking every other run in the process with it.
  describe('the accumulator is bounded (a child that emits without end must not OOM the daemon)', () => {
    it('stops accumulating at the configured ceiling and reports how much was dropped', async () => {
      const stager = createFakeLogFileStager();
      const def = createBufferedDef({ stdoutPolicy: { buffering: 'until-close' } });
      const { lifecycle, executor, child } = createHarness({
        def,
        prepareAgentLogFile: stager.prepareAgentLogFile,
        bufferedStdoutMaxBytes: 32,
      });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      child.stdout.emit('data', 'kept-head-'.repeat(3)); // 30 bytes, fits
      child.stdout.emit('data', 'DROPPED-A'); // would exceed 32
      child.stdout.emit('data', 'DROPPED-B');
      child.emit('close', 0, null);
      await lifecycle.waitForTerminal(run.id);

      const events = await collectEvents(lifecycle, run.id);
      const delta = (events.find((e) => e.kind === 'agent')!.payload as RunAgentPayload & { type: 'text_delta' }).delta;
      expect(delta).toContain('kept-head-kept-head-kept-head-');
      expect(delta).not.toContain('DROPPED-A');
      expect(delta).not.toContain('DROPPED-B');
      // Silent truncation would be worse than the leak: a reader must be told output is missing.
      expect(delta).toContain('18');
      expect(delta).toMatch(/truncat/i);
    });

    it('holds a run that stays exactly at the ceiling intact, with no truncation notice', async () => {
      const stager = createFakeLogFileStager();
      const def = createBufferedDef({ stdoutPolicy: { buffering: 'until-close' } });
      const { lifecycle, executor, child } = createHarness({
        def,
        prepareAgentLogFile: stager.prepareAgentLogFile,
        bufferedStdoutMaxBytes: 20,
      });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      child.stdout.emit('data', '0123456789');
      child.stdout.emit('data', 'abcdefghij');
      child.emit('close', 0, null);
      await lifecycle.waitForTerminal(run.id);

      const events = await collectEvents(lifecycle, run.id);
      const delta = (events.find((e) => e.kind === 'agent')!.payload as RunAgentPayload & { type: 'text_delta' }).delta;
      expect(delta).toBe('0123456789abcdefghij');
    });

    // The finding is that there was no ceiling *at all* — so the load-bearing assertion is that one
    // applies with nothing configured, not merely that an injected one is honoured.
    it('applies DEFAULT_BUFFERED_STDOUT_MAX_BYTES when a host configures nothing', async () => {
      const stager = createFakeLogFileStager();
      const def = createBufferedDef({ stdoutPolicy: { buffering: 'until-close' } });
      const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      child.stdout.emit('data', 'head\n');
      child.stdout.emit('data', 'x'.repeat(DEFAULT_BUFFERED_STDOUT_MAX_BYTES));
      child.emit('close', 0, null);
      await lifecycle.waitForTerminal(run.id);

      const events = await collectEvents(lifecycle, run.id);
      const delta = (events.find((e) => e.kind === 'agent')!.payload as RunAgentPayload & { type: 'text_delta' }).delta;
      expect(delta.length).toBeLessThan(DEFAULT_BUFFERED_STDOUT_MAX_BYTES);
      expect(delta).toContain('head\n');
      expect(delta).toContain(String(DEFAULT_BUFFERED_STDOUT_MAX_BYTES));
    });

    // Truncation is information in its own right, so it must survive a sanitizer that blanks
    // everything it was given — otherwise "the sanitizer removed it all" and "we dropped 4 GB on the
    // floor" look identical to the client.
    it('still reports truncation when the sanitizer blanks the kept text', async () => {
      const stager = createFakeLogFileStager();
      const def = createBufferedDef({ stdoutPolicy: { buffering: 'until-close', sanitize: () => '' } });
      const { lifecycle, executor, child } = createHarness({
        def,
        prepareAgentLogFile: stager.prepareAgentLogFile,
        bufferedStdoutMaxBytes: 8,
      });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      child.stdout.emit('data', 'secrets!');
      child.stdout.emit('data', 'and a great deal more');
      child.emit('close', 0, null);
      await lifecycle.waitForTerminal(run.id);

      const events = await collectEvents(lifecycle, run.id);
      const delta = (events.find((e) => e.kind === 'agent')!.payload as RunAgentPayload & { type: 'text_delta' }).delta;
      expect(delta).not.toContain('secrets!');
      expect(delta).toMatch(/truncat/i);
      expect(delta).toContain('21');
    });

    // The journal is a separate, host-owned durable log (see continuation/journal.ts) whose contract
    // is "every byte received". Bounding the in-memory accumulator must not quietly narrow that.
    it('still journals every raw byte, including the ones the accumulator dropped', async () => {
      const { journal, calls } = createSpyJournal();
      const stager = createFakeLogFileStager();
      const def = createBufferedDef({ stdoutPolicy: { buffering: 'until-close' } });
      const { lifecycle, executor, child } = createHarness({
        def,
        journal,
        prepareAgentLogFile: stager.prepareAgentLogFile,
        bufferedStdoutMaxBytes: 4,
      });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
      await flushAsync();
      await runPromise;

      child.stdout.emit('data', 'keep');
      child.stdout.emit('data', 'dropped-from-the-stream');
      child.emit('close', 0, null);
      await lifecycle.waitForTerminal(run.id);

      expect(calls.filter((c) => c.entry.trust === 'untrusted').map((c) => c.entry.content)).toEqual([
        'keep',
        'dropped-from-the-stream',
      ]);
    });
  });

  it('ignores stdoutPolicy for a structured (JSON-stream) def, whose events come from the parser', async () => {
    // `stdoutPolicy` is documented as only meaningful for `plain`. A JSON-stream
    // def that declared it must keep feeding its parser, not silently swallow
    // every event until close.
    const def = createFakeDef({ stdoutPolicy: { buffering: 'until-close', sanitize: () => 'SHOULD NOT APPEAR' } });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.stdout.emit('data', '{"type":"item.completed","item":{"type":"agent_message","text":"parsed reply"}}\n');
    await flushAsync();

    const events = await collectEvents(lifecycle, run.id);
    expect(agentPayloadTypes(events)).toContain('text_delta');
    expect(JSON.stringify(events)).not.toContain('SHOULD NOT APPEAR');
    expect(JSON.stringify(events)).toContain('parsed reply');

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });
});

describe('AgentExecutor — needsAgentLogFile staging (antigravity)', () => {
  function createLogFileDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
    return createFakeDef({
      id: 'fake-antigravity',
      streamFormat: 'plain',
      promptViaStdin: true,
      needsAgentLogFile: true,
      buildArgs: (_prompt, _imagePaths, _extra, _options, runtimeContext) => {
        if (!runtimeContext?.agentLogFilePath) throw new Error('fake-antigravity expected agentLogFilePath');
        return ['--log-file', runtimeContext.agentLogFilePath, '-p', '-'];
      },
      ...overrides,
    });
  }

  it('stages a real 0o700-directory log path, threads it into buildArgs before spawn, and removes it once the child exits', async () => {
    // prepareAgentLogFile left at its real default — the one test here proving
    // the actual @jini-ai/agent-runtime filesystem behavior end to end.
    const def = createLogFileDef();
    const { lifecycle, executor, child, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;

    expect(spawnCalls).toHaveLength(1);
    const args = spawnCalls[0]!.args;
    // Flag order is load-bearing on agy v1.0.3 (`--log-file` before `-p`).
    expect(args[0]).toBe('--log-file');
    const logPath = args[1]!;
    expect(args.slice(2)).toEqual(['-p', '-']);
    expect(logPath).toContain('agent-runtime-fake-antigravity-');
    expect(logPath.endsWith('/agent.log')).toBe(true);

    // The directory exists (so the CLI can write into it) but the file does not
    // — the CLI creates that itself.
    const dirStat = await fs.stat(path.dirname(logPath));
    expect(dirStat.isDirectory()).toBe(true);
    expect(dirStat.mode & 0o777).toBe(0o700);
    await expect(fs.access(logPath)).rejects.toThrow();

    // Simulate the CLI writing its diagnostic log, then exiting.
    await fs.writeFile(logPath, 'Propagating selected model override to backend: label="M"\n', 'utf8');
    child.emit('close', 0, null);
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');

    // Cleaned up — a leaked log can hold whatever the CLI chose to write.
    await expect(fs.access(logPath)).rejects.toThrow();
    await expect(fs.access(path.dirname(logPath))).rejects.toThrow();
  });

  it('stages nothing for a def that did not opt in', async () => {
    const stager = createFakeLogFileStager();
    const def = createFakeDef({ streamFormat: 'plain', promptViaStdin: true });
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    expect(stager.calls).toEqual([]);
    expect(stager.cleanup).not.toHaveBeenCalled();
  });

  it('stages prompt file and log file together, threading both into one runtimeContext', async () => {
    const stager = createFakeLogFileStager();
    const promptCleanup = vi.fn(async () => {});
    const fakePreparePromptFile = (async () => ({ path: '/fake/tmp/prompt.md', cleanup: promptCleanup })) as unknown as
      typeof preparePromptFileForAgent;
    const def = createFakeDef({
      id: 'fake-both',
      streamFormat: 'plain',
      promptViaFile: true,
      needsAgentLogFile: true,
      buildArgs: (_p, _i, _e, _o, ctx) => ['--prompt-file', ctx!.promptFilePath!, '--log-file', ctx!.agentLogFilePath!],
    });
    const { lifecycle, executor, child, spawnCalls } = createHarness({
      def,
      prepareAgentLogFile: stager.prepareAgentLogFile,
      preparePromptFileForAgent: fakePreparePromptFile,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-both', prompt: 'x', cwd: '/work' });
    expect(spawnCalls[0]!.args).toEqual(['--prompt-file', '/fake/tmp/prompt.md', '--log-file', '/fake/tmp/agent.log']);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
    // Both released by the single composed cleanup.
    expect(promptCleanup).toHaveBeenCalledTimes(1);
    expect(stager.cleanup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['spawn() throws synchronously', { spawnThrows: new Error('EACCES') }],
    ['the child emits "error" before "spawn"', { spawnErrorEvent: new Error('ENOENT') }],
  ])('removes the staged log file when %s', async (_label, harnessOverrides) => {
    const stager = createFakeLogFileStager();
    const def = createLogFileDef();
    const { lifecycle, executor } = createHarness({
      def,
      prepareAgentLogFile: stager.prepareAgentLogFile,
      ...harnessOverrides,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' })).rejects.toMatchObject(
      { code: 'AGENT_SPAWN_FAILED' },
    );

    expect(stager.cleanup).toHaveBeenCalledTimes(1);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('removes the staged log file when the Windows command-line budget guard rejects post-buildArgs', async () => {
    const stager = createFakeLogFileStager();
    const def = createLogFileDef({
      maxPromptArgBytes: 30_000,
      buildArgs: (prompt, _i, _e, _o, ctx) => ['--log-file', ctx!.agentLogFilePath!, '--message', prompt],
    });
    const { lifecycle, executor } = createHarness({
      def,
      launchPath: 'C:\\fake\\agy.cmd',
      prepareAgentLogFile: stager.prepareAgentLogFile,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: '"'.repeat(20_000), cwd: '/work' }),
    ).rejects.toMatchObject({ code: 'AGENT_PROMPT_TOO_LARGE' });

    expect(stager.cleanup).toHaveBeenCalledTimes(1);
  });

  it('removes the staged log file when .mcp.json injection fails', async () => {
    const stager = createFakeLogFileStager();
    const def = createLogFileDef({ externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor } = createHarness({
      def,
      prepareAgentLogFile: stager.prepareAgentLogFile,
      mcpJsonInjection: {
        command: 'jini-mcp',
        daemonUrl: 'http://127.0.0.1:4242',
        readFile: async () => '',
        writeFile: async () => {
          throw new Error('EROFS: read-only file system');
        },
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' })).rejects.toMatchObject(
      { code: 'AGENT_SPAWN_FAILED', message: expect.stringContaining('.mcp.json') },
    );
    expect(stager.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects cleanly with AGENT_SPAWN_FAILED (never a bare throw) when log-file staging itself fails, releasing the already-staged prompt file', async () => {
    const promptCleanup = vi.fn(async () => {});
    const fakePreparePromptFile = (async () => ({ path: '/fake/tmp/prompt.md', cleanup: promptCleanup })) as unknown as
      typeof preparePromptFileForAgent;
    const failingLogStager = (async () => {
      throw new Error('ENOSPC: no space left on device');
    }) as unknown as typeof prepareAgentLogFile;
    const def = createLogFileDef({ promptViaFile: true });
    const { lifecycle, executor } = createHarness({
      def,
      preparePromptFileForAgent: fakePreparePromptFile,
      prepareAgentLogFile: failingLogStager,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('could not stage a log file'),
    });
    // The prompt file was staged first and must not leak because the log file failed.
    expect(promptCleanup).toHaveBeenCalledTimes(1);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('rejects cleanly when log-file staging fails and no prompt file was staged', async () => {
    const failingLogStager = (async () => {
      throw new Error('EMFILE');
    }) as unknown as typeof prepareAgentLogFile;
    const def = createLogFileDef();
    const { lifecycle, executor } = createHarness({ def, prepareAgentLogFile: failingLogStager });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' })).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('could not stage a log file'),
    });
  });
});

// `antigravity`'s own `runtimeLock` (the settings.json-write mutex this generic mechanism was
// built for) is gone — retired along with the settings.json write once `agy` gained a real
// `--model` flag (see `defs/antigravity.ts`'s own doc). The mechanism itself stays: it is a
// generic, still-supported `RuntimeAgentDef` extension point (Phase 7 acquire / Phase 14 handoff
// watcher in this file), so these tests keep exercising it against synthetic `RuntimeLock`
// fixtures rather than the now-deleted concrete implementation.
describe('AgentExecutor — runtimeLock (a def-declared process-global buildArgs mutex hook)', () => {
  /** A `RuntimeLock` whose acquire/handoff/release are fully caller-controlled. */
  function createRecordingLock(options: { waitForHandoff?: boolean } = {}) {
    const events: string[] = [];
    let releaseHandoff: (() => void) | undefined;
    let rejectHandoff: ((err: unknown) => void) | undefined;
    const seen: {
      acquire?: RuntimeLockAcquireContext;
      handoff?: { logFilePath: string | undefined; model: string | undefined };
    } = {};
    const lock: RuntimeLock = {
      acquire: async (context) => {
        events.push('acquire');
        seen.acquire = context;
        return {
          release: () => events.push('release'),
          ...(options.waitForHandoff === false
            ? {}
            : {
                waitForHandoff: (handoffContext: RuntimeLockHandoffContext) => {
                  events.push('waitForHandoff');
                  seen.handoff = { logFilePath: handoffContext.logFilePath, model: handoffContext.model };
                  return new Promise<void>((resolve, reject) => {
                    releaseHandoff = () => resolve();
                    rejectHandoff = reject;
                  });
                },
              }),
        };
      },
    };
    return {
      lock,
      events,
      seen,
      settleHandoff: () => releaseHandoff?.(),
      failHandoff: (err: unknown) => rejectHandoff?.(err),
    };
  }

  /**
   * A `RuntimeLock` backed by a REAL promise chain — each `acquire` awaits the previous hold's
   * `release` — standing in for a concrete implementation like the now-deleted
   * `antigravityModelLock` (whose settings.json-write mutex used exactly this shape). Declares no
   * `waitForHandoff`, so release is governed by the executor's own generic "hold until child exit"
   * default (already proven by the `'holds until child exit when the def declares a lock with no
   * waitForHandoff at all'` test above) — this fixture exists to prove genuine cross-run
   * serialization via a real chain, not to re-prove that default.
   */
  function createChainedLock(): RuntimeLock {
    let chain: Promise<void> = Promise.resolve();
    return {
      acquire: async () => {
        const previous = chain;
        let release!: () => void;
        chain = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        return { release };
      },
    };
  }

  function createLockedDef(lock: RuntimeLock, overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
    return createFakeDef({
      id: 'fake-antigravity',
      streamFormat: 'plain',
      promptViaStdin: true,
      needsAgentLogFile: true,
      runtimeLock: lock,
      buildArgs: () => ['-p', '-'],
      ...overrides,
    });
  }

  it('acquires before buildArgs runs, passing the selected model, and hands the staged log path to waitForHandoff after spawn', async () => {
    const recording = createRecordingLock();
    const stager = createFakeLogFileStager('/fake/tmp/agy.log');
    const buildArgsAt: string[] = [];
    const def = createLockedDef(recording.lock, {
      buildArgs: (_p, _i, _e, _o, ctx) => {
        buildArgsAt.push(recording.events.join(','));
        return ['--log-file', ctx!.agentLogFilePath!, '-p', '-'];
      },
    });
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({
      runId: run.id,
      agentId: 'fake-antigravity',
      prompt: 'x',
      cwd: '/work',
      model: 'Gemini 3.1 Pro (High)',
    });

    // Ordering: acquire strictly precedes buildArgs (which is what performs the
    // process-global settings.json write).
    expect(buildArgsAt).toEqual(['acquire']);
    expect(recording.seen.acquire).toEqual({ model: 'Gemini 3.1 Pro (High)' });
    expect(recording.events).toEqual(['acquire', 'waitForHandoff']);
    expect(recording.seen.handoff).toMatchObject({ logFilePath: '/fake/tmp/agy.log', model: 'Gemini 3.1 Pro (High)' });

    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('releases as soon as waitForHandoff resolves, without waiting for the child to exit', async () => {
    const recording = createRecordingLock();
    const stager = createFakeLogFileStager();
    const def = createLockedDef(recording.lock);
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work', model: 'M' });
    expect(recording.events).not.toContain('release');

    recording.settleHandoff();
    await flushAsync();
    expect(recording.events).toEqual(['acquire', 'waitForHandoff', 'release']);

    // The child is still alive; its later exit must not break anything.
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('releases on child exit when waitForHandoff never settles (a cold-starting CLI that never logs its signal)', async () => {
    const recording = createRecordingLock();
    const stager = createFakeLogFileStager();
    const def = createLockedDef(recording.lock);
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work', model: 'M' });
    expect(recording.events).not.toContain('release');

    child.emit('exit', 0, null);
    await flushAsync();
    expect(recording.events).toEqual(['acquire', 'waitForHandoff', 'release']);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('releases even when waitForHandoff rejects — a lock stuck open is worse than an early release', async () => {
    const recording = createRecordingLock();
    const stager = createFakeLogFileStager();
    const def = createLockedDef(recording.lock);
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work', model: 'M' });
    recording.failHandoff(new Error('log watcher blew up'));
    await flushAsync();
    expect(recording.events).toEqual(['acquire', 'waitForHandoff', 'release']);

    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('releasing twice is harmless (handoff settles, then the child exits)', async () => {
    const recording = createRecordingLock();
    const stager = createFakeLogFileStager();
    const def = createLockedDef(recording.lock);
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work', model: 'M' });
    recording.settleHandoff();
    await flushAsync();
    child.emit('exit', 0, null);
    await flushAsync();
    // Both release paths fired; the driver makes no attempt to suppress the
    // second, per RuntimeLockHold.release's idempotence contract.
    expect(recording.events.filter((e) => e === 'release')).toHaveLength(2);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('holds until child exit when the def declares a lock with no waitForHandoff at all', async () => {
    const recording = createRecordingLock({ waitForHandoff: false });
    const def = createLockedDef(recording.lock, { needsAgentLogFile: false, buildArgs: () => ['-p', '-'] });
    const { lifecycle, executor, child } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work', model: 'M' });
    expect(recording.events).toEqual(['acquire']);

    child.emit('exit', 0, null);
    await flushAsync();
    expect(recording.events).toEqual(['acquire', 'release']);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('passes model: undefined to acquire when the caller selected no model', async () => {
    const recording = createRecordingLock();
    const stager = createFakeLogFileStager();
    const def = createLockedDef(recording.lock);
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work' });
    expect(recording.seen.acquire).toEqual({ model: undefined });

    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);
  });

  it('releases the lock on every pre-spawn failure path, where no child exists to signal exit', async () => {
    const recording = createRecordingLock();
    const stager = createFakeLogFileStager();
    const def = createLockedDef(recording.lock);
    const { lifecycle, executor } = createHarness({
      def,
      spawnThrows: new Error('EACCES'),
      prepareAgentLogFile: stager.prepareAgentLogFile,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work', model: 'M' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });

    // Released, and waitForHandoff was never started (no live process could
    // have consumed the guarded write).
    expect(recording.events).toEqual(['acquire', 'release']);
    expect(stager.cleanup).toHaveBeenCalledTimes(1);
  });

  // `buildArgs` is exactly the step a `runtimeLock` exists to guard *because* it performs real
  // filesystem writes (antigravity writes its model choice into a shared settings file). So it can
  // throw for entirely ordinary reasons — EACCES on a read-only home, ENOSPC, a malformed existing
  // settings file — and it runs after the lock is held and after both staged files exist. Every
  // other failure between staging and spawn is already funnelled through `failBeforeSpawn`; this one
  // must be too, or a permission problem silently converts into a stranded `'running'` run holding a
  // process-global mutex that no later run can ever acquire.
  it('fails the run before spawn, releasing the lock and staged files, when buildArgs itself throws', async () => {
    const recording = createRecordingLock();
    const stager = createFakeLogFileStager();
    const def = createLockedDef(recording.lock, {
      buildArgs: () => {
        throw new Error('EACCES: permission denied, open \'/home/agent/.antigravity/settings.json\'');
      },
    });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work', model: 'M' }),
    ).rejects.toMatchObject({
      code: 'AGENT_SPAWN_FAILED',
      message: expect.stringContaining('EACCES'),
    });

    expect(spawnCalls).toHaveLength(0);
    expect(recording.events).toEqual(['acquire', 'release']);
    expect(stager.cleanup).toHaveBeenCalledTimes(1);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ status: 'failed', resumable: false });
  });

  // The same hazard on the plainest possible def: no lock, no log file, no prompt file — proving the
  // guard is on `buildArgs` itself rather than a side effect of the lock/staging bookkeeping.
  it('reports a throwing buildArgs as AgentExecutorError even for a def with nothing staged', async () => {
    const def = createFakeDef({
      buildArgs: () => {
        throw new Error('def blew up composing argv');
      },
    });
    const { lifecycle, executor, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const failure = await executor
      .run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(AgentExecutorError);
    expect(failure).toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(spawnCalls).toHaveLength(0);
    expect((await lifecycle.get(run.id))?.state).toBe('failed');
  });

  it('leaves a real chained lock acquirable by a later run after a buildArgs failure', async () => {
    // The consequence test for the one above, against a REAL mutex (not the recording fake): a
    // wedged hold is only observable as the NEXT run hanging, which is the actual production
    // symptom a def-declared lock exists to avoid (every later run on that lock dead for the
    // daemon's lifetime).
    const lock = createChainedLock();
    const stager = createFakeLogFileStager();
    let shouldThrow = true;
    const def = createLockedDef(lock, {
      buildArgs: () => {
        if (shouldThrow) throw new Error('EROFS: read-only file system');
        return ['-p', '-'];
      },
    });
    const { lifecycle, executor, child } = createHarness({ def, prepareAgentLogFile: stager.prepareAgentLogFile });

    const { run: runA } = await lifecycle.start({ contextRef: 'ctx-a' });
    await expect(
      executor.run({ runId: runA.id, agentId: 'fake-antigravity', prompt: 'x', cwd: '/work', model: 'M' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });

    shouldThrow = false;
    const { run: runB } = await lifecycle.start({ contextRef: 'ctx-b' });
    let bSettled = false;
    const runBPromise = executor
      .run({ runId: runB.id, agentId: 'fake-antigravity', prompt: 'y', cwd: '/work', model: 'M' })
      .then(() => {
        bSettled = true;
      });
    await flushAsync();

    // Without the fix, run A's hold is still outstanding and run B's acquire
    // never resolves, so this stays false forever.
    expect(bSettled).toBe(true);
    await runBPromise;

    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(runB.id);
  });

  it('proves two overlapping runs of a real chained lock genuinely serialize', async () => {
    // Uses a real promise-chain lock (not the recording fake), driven through two concurrent
    // executor runs sharing one lock instance — the actual race a def-declared lock exists to
    // close, reproduced generically now that antigravity no longer needs one of its own.
    const lock = createChainedLock();
    const buildOrder: string[] = [];
    const makeDef = (id: string): RuntimeAgentDef =>
      createFakeDef({
        id,
        streamFormat: 'plain',
        promptViaStdin: true,
        needsAgentLogFile: true,
        runtimeLock: lock,
        buildArgs: () => {
          buildOrder.push(id);
          return ['-p', '-'];
        },
      });

    const defA = makeDef('run-a');
    const defB = makeDef('run-b');
    const stagerA = createFakeLogFileStager();
    const stagerB = createFakeLogFileStager();
    const harnessA = createHarness({ def: defA, prepareAgentLogFile: stagerA.prepareAgentLogFile });
    const harnessB = createHarness({ def: defB, prepareAgentLogFile: stagerB.prepareAgentLogFile });
    const { run: runA } = await harnessA.lifecycle.start({ contextRef: 'ctx-a' });
    const { run: runB } = await harnessB.lifecycle.start({ contextRef: 'ctx-b' });

    const promiseA = harnessA.executor.run({
      runId: runA.id,
      agentId: 'run-a',
      prompt: 'x',
      cwd: '/work',
      model: 'model-a',
    });
    const promiseB = harnessB.executor.run({
      runId: runB.id,
      agentId: 'run-b',
      prompt: 'x',
      cwd: '/work',
      model: 'model-b',
    });

    await promiseA;
    // A holds the lock (no waitForHandoff declared, so the executor's generic default holds it
    // until child exit), so B's buildArgs must not have run yet.
    await flushAsync();
    expect(buildOrder).toEqual(['run-a']);

    // A's process exits, releasing.
    harnessA.child.emit('exit', 0, null);
    harnessA.child.emit('close', 0, null);
    await harnessA.lifecycle.waitForTerminal(runA.id);

    await promiseB;
    expect(buildOrder).toEqual(['run-a', 'run-b']);

    harnessB.child.emit('exit', 0, null);
    harnessB.child.emit('close', 0, null);
    await harnessB.lifecycle.waitForTerminal(runB.id);
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

  it('does not fire a premature slow-run notice while an auto-resolved tool call is still genuinely executing, past the default threshold (regression: the daemon had no way to tell the watchdog "this silence is expected")', async () => {
    vi.useFakeTimers();
    try {
      let resolveExecute!: (result: ToolExecutionResult) => void;
      const pendingExecute = new Promise<ToolExecutionResult>((resolve) => {
        resolveExecute = resolve;
      });
      const { toolExecutor } = createFakeToolExecutor(() => pendingExecute);
      const continuation: ContinuationOptions = { toolExecutor, principal: TEST_PRINCIPAL, autonomousToolNames: new Set(['Bash']) };
      const { lifecycle, executor, child } = createHarness({ def: streamJsonDef(), continuation });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      // `flushAsync()` (a real `setTimeout(fn, 0)`) never settles once fake timers are engaged —
      // `vi.advanceTimersByTimeAsync(0)` is this test's fake-timer-safe equivalent: it flushes
      // microtasks the same way while still driving the fake clock the watchdog reads.
      const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
      await vi.advanceTimersByTimeAsync(0);
      child.stdout.emit('data', toolUseTurnEnd('tu-1', 'Bash', { command: 'npm install' }, 'tool_use'));
      await vi.advanceTimersByTimeAsync(0);

      // The tool call is now in flight — `execute()` has not resolved and nothing has streamed
      // since. Advance well past the default 45s slow-run threshold: a healthy, still-running tool
      // call must not be reported as "still working... taking longer than usual."
      await vi.advanceTimersByTimeAsync(DEFAULT_SLOW_RUN_THRESHOLD_MS + 5_000);
      const midFlightEvents = await collectEvents(lifecycle, run.id);
      expect(midFlightEvents.some((event) => event.kind === 'agent' && (event.payload as RunAgentPayload).type === 'slow_running')).toBe(
        false,
      );

      resolveExecute({ executionId: 'exec-1', status: 'completed', output: 'done' });
      await vi.advanceTimersByTimeAsync(0);

      child.emit('close', 0, null);
      await runPromise;
      await lifecycle.waitForTerminal(run.id);
    } finally {
      vi.useRealTimers();
    }
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

  // `classifyFailure` is host-supplied and may do real work (a keystore read, a DB lookup, an HTTP
  // call), so it can reject for reasons that have nothing to do with this run. It runs between the
  // child's `'close'` and `finish()`, inside a `void (async () => …)()` with no catch — so a
  // rejection took the whole terminal transition with it: the child was already gone, but the run
  // stayed `'running'` forever, unresumable and unfinishable, and the rejection surfaced only as an
  // unhandled promise. A classifier failing is a reason to fall back to `resumable: false`, never a
  // reason to lose the run.
  it('finishes the run with resumable:false when the classifier itself rejects', async () => {
    const classifyFailure = vi.fn(async () => {
      throw new Error('keystore unreachable');
    });
    const { lifecycle, executor, child, onCleanupFailure } = createHarness({ classifyFailure });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 1, null);
    await runPromise;

    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('failed');
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ status: 'failed', resumable: false });
    // Reported, not swallowed: a classifier that always throws is a real host bug worth seeing.
    expect(onCleanupFailure).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'failure-classification' });
  });
});

// Both post-close steps `finish()` sits behind — staged-file cleanup and failure classification —
// are fallible and were unguarded in all three close handlers. The tests below drive each of the
// three transports (child-driven, ACP, pi-rpc) because the code shape, and therefore the bug, is
// duplicated across all three rather than living in one shared helper.
describe('AgentExecutor — a fallible post-close step must never prevent finish()', () => {
  /** A log-file stager whose `cleanup` rejects, as a full temp dir going away under the daemon would. */
  function createFailingLogFileStager(error = new Error('EBUSY: resource busy or locked')): {
    prepareAgentLogFile: typeof prepareAgentLogFile;
    cleanup: ReturnType<typeof vi.fn>;
  } {
    const cleanup = vi.fn(async () => {
      throw error;
    });
    return {
      cleanup,
      prepareAgentLogFile: (async (def: RuntimeAgentDef | null | undefined) => {
        if (!def?.needsAgentLogFile) return null;
        return { path: '/fake/tmp/agent.log', cleanup };
      }) as unknown as typeof prepareAgentLogFile,
    };
  }

  it('child-driven: finishes the run when staged-file cleanup rejects', async () => {
    const stager = createFailingLogFileStager();
    const def = createFakeDef({
      id: 'fake-antigravity',
      streamFormat: 'plain',
      needsAgentLogFile: true,
      buildArgs: () => ['-p', '-'],
    });
    const { lifecycle, executor, child, onCleanupFailure } = createHarness({
      def,
      prepareAgentLogFile: stager.prepareAgentLogFile,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.emit('close', 0, null);
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
    expect(stager.cleanup).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'staged-file-cleanup' });
  });

  it('ACP: finishes the run when staged-file cleanup rejects', async () => {
    const stager = createFailingLogFileStager();
    const { lifecycle, executor, child, onCleanupFailure } = createAcpHarness({
      def: { needsAgentLogFile: true },
      prepareAgentLogFile: stager.prepareAgentLogFile,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.emit('close', 0, null);
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
    expect(stager.cleanup).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'staged-file-cleanup' });
  });

  it('pi-rpc: finishes the run when staged-file cleanup rejects', async () => {
    const stager = createFailingLogFileStager();
    const { lifecycle, executor, child, onCleanupFailure } = createPiRpcHarness({
      def: { needsAgentLogFile: true },
      prepareAgentLogFile: stager.prepareAgentLogFile,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.emit('close', 0, null);
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
    expect(stager.cleanup).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'staged-file-cleanup' });
  });

  it('ACP: finishes the run when the classifier rejects', async () => {
    const { lifecycle, executor, child } = createAcpHarness({
      completedSuccessfully: false,
      classifyFailure: async () => {
        throw new Error('classifier exploded');
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 1, null);
    await runPromise;

    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('failed');
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ resumable: false });
  });

  it('pi-rpc: finishes the run when the classifier rejects', async () => {
    const { lifecycle, executor, child } = createPiRpcHarness({
      hasFatalError: true,
      classifyFailure: async () => {
        throw new Error('classifier exploded');
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    child.emit('close', 1, null);
    await runPromise;

    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('failed');
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ resumable: false });
  });

  // A diagnostic sink is host code too. It must not be able to convert a contained cleanup failure
  // into the very stranded run the guard above exists to prevent — the same reasoning
  // `run-lifecycle.ts`'s `handleInactivityTimeout` already applies to its own error sink.
  it('finishes the run even when the onCleanupFailure sink itself throws', async () => {
    const stager = createFailingLogFileStager();
    const def = createFakeDef({
      id: 'fake-antigravity',
      streamFormat: 'plain',
      needsAgentLogFile: true,
      buildArgs: () => ['-p', '-'],
    });
    const { lifecycle, executor, child, onCleanupFailure } = createHarness({
      def,
      prepareAgentLogFile: stager.prepareAgentLogFile,
    });
    onCleanupFailure.mockImplementation(() => {
      throw new Error('sink is broken too');
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    const runPromise = executor.run({ runId: run.id, agentId: 'fake-antigravity', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.emit('close', 0, null);
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
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

  it('adds JINI_DAEMON_TOKEN when a resolved credential is supplied', () => {
    const entry = buildMcpJsonServerEntry(
      'run-1',
      { command: 'jini-mcp', daemonUrl: 'http://127.0.0.1:4242' },
      'run-scoped-secret',
    );
    expect(entry.env).toEqual({
      JINI_RUN_ID: 'run-1',
      JINI_DAEMON_URL: 'http://127.0.0.1:4242',
      JINI_DAEMON_TOKEN: 'run-scoped-secret',
    });
  });

  // The additive guarantee, at the byte level: omitting the credential must produce exactly what this
  // function produced before the parameter existed — not a `JINI_DAEMON_TOKEN: undefined` key, which
  // serializes into `.mcp.json` differently and would change what the child process sees.
  it('omits the token key entirely when no credential is supplied', () => {
    const options = { command: 'jini-mcp', daemonUrl: 'http://127.0.0.1:4242' };
    expect(Object.keys(buildMcpJsonServerEntry('run-1', options).env)).toEqual(['JINI_RUN_ID', 'JINI_DAEMON_URL']);
    expect(JSON.stringify(buildMcpJsonServerEntry('run-1', options, undefined))).toBe(
      JSON.stringify(buildMcpJsonServerEntry('run-1', options)),
    );
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

  it('reads the project .mcp.json, merges, and writes this run\'s config into the run cwd before spawn for a configured claude-mcp-json def', async () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: 'x', args: [], env: {} } } });
    const { mcpJsonInjection, readCalls, writeCalls } = createMcpFsSpies(existing);
    const def = createFakeDef({ id: 'claude', externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work/proj' });

    expect(readCalls).toEqual(['/work/proj/.mcp.json']);
    expect(writeCalls).toHaveLength(1);
    // Run-scoped path in the same directory — see `mcpJsonPathForRun` and the "two runs sharing one
    // working directory" block below for why the write target is not the file that was read.
    expect(writeCalls[0]!.path).toBe(`/work/proj/.mcp.jini-${run.id}.json`);
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

  it('resolves the credential with this run\'s id and delivers it as JINI_DAEMON_TOKEN', async () => {
    const { mcpJsonInjection, writeCalls } = createMcpFsSpies();
    const seenRunIds: string[] = [];
    const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor } = createHarness({
      def,
      mcpJsonInjection: {
        ...mcpJsonInjection,
        credential: (runId: string) => {
          seenRunIds.push(runId);
          return `token-for-${runId}`;
        },
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(seenRunIds).toEqual([run.id]);
    expect(JSON.parse(writeCalls[0]!.content).mcpServers.jini.env).toEqual({
      JINI_RUN_ID: run.id,
      JINI_DAEMON_URL: 'http://127.0.0.1:4242',
      JINI_DAEMON_TOKEN: `token-for-${run.id}`,
    });
  });

  it('awaits an async credential resolver', async () => {
    const { mcpJsonInjection, writeCalls } = createMcpFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor } = createHarness({
      def,
      mcpJsonInjection: {
        ...mcpJsonInjection,
        credential: async (runId: string) => {
          await Promise.resolve();
          return `async-token-for-${runId}`;
        },
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(JSON.parse(writeCalls[0]!.content).mcpServers.jini.env.JINI_DAEMON_TOKEN).toBe(
      `async-token-for-${run.id}`,
    );
  });

  // The whole reason `credential` is a resolver rather than a string: two runs under one executor
  // must be able to get different secrets. A boot-time string field could not express this, and a
  // shared secret would defeat the point of scoping a credential to a run at all.
  it('mints a distinct credential per run, not one shared across the executor', async () => {
    const { mcpJsonInjection, writeCalls } = createMcpFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor } = createHarness({
      def,
      mcpJsonInjection: { ...mcpJsonInjection, credential: (runId: string) => `token-for-${runId}` },
    });

    const first = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: first.run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    const second = await lifecycle.start({ contextRef: 'ctx-2' });
    await executor.run({ runId: second.run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    const tokens = writeCalls.map((c) => JSON.parse(c.content).mcpServers.jini.env.JINI_DAEMON_TOKEN);
    expect(tokens).toEqual([`token-for-${first.run.id}`, `token-for-${second.run.id}`]);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  // ---------------------------------------------------------------------------
  // Two runs, one working directory. `mcpServers.jini`'s `env` block carries this run's
  // `JINI_RUN_ID` and its bearer `JINI_DAEMON_TOKEN`, and a spawned CLI loads its MCP config when it
  // starts its client — not synchronously at spawn. So while a shared `cwd/.mcp.json` was the write
  // target, run B's write landed in the file run A's child had not read yet, and A's `jini-mcp`
  // subprocess then called back carrying B's run id and B's token: A's tool calls executing inside
  // B's authority context. Concurrent runs in one cwd are explicitly supported (see "mints a distinct
  // credential per run" above), so the fix has to make both correct rather than refuse the second.
  // ---------------------------------------------------------------------------
  describe('two runs sharing one working directory', () => {
    it('gives each run its own config file, so neither child can read the other run\'s id or token', async () => {
      const { mcpJsonInjection, writeCalls } = createMcpFsSpies();
      const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
      const { lifecycle, executor } = createHarness({
        def,
        mcpJsonInjection: { ...mcpJsonInjection, credential: (runId: string) => `token-for-${runId}` },
      });

      const first = await lifecycle.start({ contextRef: 'ctx-a', runId: 'run-a' });
      await executor.run({ runId: first.run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work/shared' });
      const second = await lifecycle.start({ contextRef: 'ctx-b', runId: 'run-b' });
      await executor.run({ runId: second.run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work/shared' });

      expect(writeCalls).toHaveLength(2);
      // Distinct paths is the whole fix: one file cannot hold two runs' identities at once.
      expect(writeCalls[0]!.path).not.toBe(writeCalls[1]!.path);

      // And each file still says what its own run needs it to say, after both writes have landed.
      const byPath = new Map(writeCalls.map((c) => [c.path, JSON.parse(c.content).mcpServers.jini.env]));
      expect([...byPath.values()]).toEqual(
        expect.arrayContaining([
          { JINI_RUN_ID: 'run-a', JINI_DAEMON_URL: 'http://127.0.0.1:4242', JINI_DAEMON_TOKEN: 'token-for-run-a' },
          { JINI_RUN_ID: 'run-b', JINI_DAEMON_URL: 'http://127.0.0.1:4242', JINI_DAEMON_TOKEN: 'token-for-run-b' },
        ]),
      );
    });

    it('hands buildArgs the same path it then writes, so the child is pointed at its own file', async () => {
      const { mcpJsonInjection, writeCalls } = createMcpFsSpies();
      const seenPaths: Array<string | undefined> = [];
      const def = createFakeDef({
        externalMcpInjection: 'claude-mcp-json',
        buildArgs: (_p, _i, _e, _o, ctx) => {
          seenPaths.push(ctx?.mcpJsonPath);
          return ['--strict-mcp-config', '--mcp-config', ctx!.mcpJsonPath!];
        },
      });
      const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1', runId: 'run-xyz' });
      await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work/shared' });

      expect(seenPaths).toEqual([writeCalls[0]!.path]);
      expect(spawnCalls[0]!.args).toEqual(['--strict-mcp-config', '--mcp-config', writeCalls[0]!.path]);
      // Named after the run, so two concurrent runs cannot collide and an operator can tell whose it is.
      expect(writeCalls[0]!.path).toContain('run-xyz');
    });

    it('merges from the project\'s own .mcp.json without ever writing to it', async () => {
      const existing = JSON.stringify({ mcpServers: { other: { command: 'x', args: [], env: {} } } });
      const { mcpJsonInjection, readCalls, writeCalls } = createMcpFsSpies(existing);
      const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
      const { lifecycle, executor } = createHarness({ def, mcpJsonInjection });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work/proj' });

      // The project's file is still the merge *source* — its other servers must survive.
      expect(readCalls).toEqual(['/work/proj/.mcp.json']);
      expect(JSON.parse(writeCalls[0]!.content).mcpServers.other).toEqual({ command: 'x', args: [], env: {} });
      // …but it is never the write target, so there is nothing to restore afterwards either.
      expect(writeCalls.map((c) => c.path)).not.toContain('/work/proj/.mcp.json');
    });

    it('removes the run\'s config file once the child closes, so a live token is not left on disk', async () => {
      const removeCalls: string[] = [];
      const { mcpJsonInjection, writeCalls } = createMcpFsSpies();
      const def = createFakeDef({ streamFormat: 'plain', externalMcpInjection: 'claude-mcp-json' });
      const { lifecycle, executor, child } = createHarness({
        def,
        mcpJsonInjection: {
          ...mcpJsonInjection,
          credential: () => 'a-live-bearer-token',
          removeFile: async (path: string) => void removeCalls.push(path),
        },
      });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work/proj' });
      await flushAsync();
      await runPromise;
      expect(removeCalls).toEqual([]);

      child.emit('close', 0, null);
      await lifecycle.waitForTerminal(run.id);

      expect(removeCalls).toEqual([writeCalls[0]!.path]);
    });

    it('removes the run\'s config file on a pre-spawn failure after it was already written', async () => {
      const removeCalls: string[] = [];
      const { mcpJsonInjection, writeCalls } = createMcpFsSpies();
      const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
      const { lifecycle, executor } = createHarness({
        def,
        spawnThrows: new Error('EACCES'),
        mcpJsonInjection: {
          ...mcpJsonInjection,
          removeFile: async (path: string) => void removeCalls.push(path),
        },
      });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      await expect(
        executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work/proj' }),
      ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });

      expect(removeCalls).toEqual([writeCalls[0]!.path]);
    });

    // Removal is best-effort cleanup of a file the run no longer needs. It must not be able to do
    // what the guarded post-close steps above already exist to prevent.
    it('still finishes the run when removing the config file fails', async () => {
      const { mcpJsonInjection } = createMcpFsSpies();
      const def = createFakeDef({ streamFormat: 'plain', externalMcpInjection: 'claude-mcp-json' });
      const { lifecycle, executor, child, onCleanupFailure } = createHarness({
        def,
        mcpJsonInjection: {
          ...mcpJsonInjection,
          removeFile: async () => {
            throw new Error('EPERM: operation not permitted');
          },
        },
      });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

      const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work/proj' });
      await flushAsync();
      await runPromise;

      child.emit('close', 0, null);
      expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
      expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'staged-file-cleanup' });
    });

    // A run id reaches this driver from a host and is used to build a filename. Anything path-like in
    // it must not be able to steer the write out of the run's own cwd.
    it('does not let a path-like run id escape the run cwd', async () => {
      const { mcpJsonInjection, writeCalls } = createMcpFsSpies();
      const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
      const { lifecycle, executor } = createHarness({ def, mcpJsonInjection });
      const { run } = await lifecycle.start({ contextRef: 'ctx-1', runId: '../../etc/evil' });
      await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work/proj' });

      expect(path.dirname(writeCalls[0]!.path)).toBe('/work/proj');
      expect(writeCalls[0]!.path).not.toContain('..');
    });
  });

  it('fails the run before spawn when the credential resolver rejects', async () => {
    const { mcpJsonInjection } = createMcpFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      mcpJsonInjection: {
        ...mcpJsonInjection,
        credential: async () => {
          throw new Error('keystore unavailable');
        },
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    // Spawning a child that cannot authenticate would produce a run whose every tool call 401s —
    // failing before spawn is the correct outcome.
    await expect(
      executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(spawnCalls).toHaveLength(0);
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ status: 'failed', resumable: false });
  });
});

describe('buildAcpMcpBridgeServers', () => {
  const entry = { command: 'jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };

  it('shapes the bridge entry as a single stdio ACP server named "jini"', () => {
    expect(buildAcpMcpBridgeServers(entry)).toEqual([
      {
        type: 'stdio',
        name: 'jini',
        command: 'jini-mcp',
        args: ['--quiet'],
        env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' },
      },
    ]);
  });

  it('copies rather than aliases args and env, so a later mutation cannot reach the emitted descriptor', () => {
    const [server] = buildAcpMcpBridgeServers(entry);
    expect(server!.args).not.toBe(entry.args);
    expect(server!.env).not.toBe(entry.env);
  });

  // `buildAcpSessionNewParams` owns the array-vs-map env wire-shape difference per def; emitting a
  // plain object here is what lets it do that. Emitting the array form directly would bypass the
  // `envFormat: 'map'` defs (reasonix).
  it('emits env as a plain object for buildAcpSessionNewParams to normalise per def', () => {
    const [server] = buildAcpMcpBridgeServers(entry);
    expect(Array.isArray(server!.env)).toBe(false);
    expect(server!.env).toBeTypeOf('object');
  });

  // SEC: process arguments are readable by any other local user through `ps`; a process's
  // environment is not. The credential must never cross into `args`.
  it('keeps a resolved credential in env and out of args', () => {
    const withToken = { ...entry, env: { ...entry.env, JINI_DAEMON_TOKEN: 'run-scoped-secret' } };
    const [server] = buildAcpMcpBridgeServers(withToken);
    expect(server!.args).toEqual(['--quiet']);
    expect(JSON.stringify(server!.args)).not.toContain('run-scoped-secret');
    expect(server!.env).toMatchObject({ JINI_DAEMON_TOKEN: 'run-scoped-secret' });
  });
});

describe('mergeEnvContentMcpConfig', () => {
  const entry = { command: 'jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };
  const jiniEntry = {
    type: 'local',
    command: ['jini-mcp', '--quiet'],
    environment: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' },
    enabled: true,
  };

  it('produces a fresh OpenCode-schema document when the variable was unset', () => {
    expect(JSON.parse(mergeEnvContentMcpConfig(undefined, entry))).toEqual({ mcp: { jini: jiniEntry } });
  });

  it('treats an empty-string existing value as unset', () => {
    expect(JSON.parse(mergeEnvContentMcpConfig('', entry))).toEqual({ mcp: { jini: jiniEntry } });
  });

  // The variable a host uses to hand the CLI the *user's* own MCP servers is the same variable this
  // bridge rides in. Clobbering it would silently delete them.
  it('preserves unrelated top-level keys and other registered servers', () => {
    const existing = JSON.stringify({ provider: { openai: {} }, mcp: { other: { type: 'local', command: ['x'] } } });
    expect(JSON.parse(mergeEnvContentMcpConfig(existing, entry))).toEqual({
      provider: { openai: {} },
      mcp: { other: { type: 'local', command: ['x'] }, jini: jiniEntry },
    });
  });

  it('overwrites a stale "jini" entry rather than merging into it', () => {
    const existing = JSON.stringify({ mcp: { jini: { type: 'local', command: ['stale'], enabled: false } } });
    expect(JSON.parse(mergeEnvContentMcpConfig(existing, entry)).mcp.jini).toEqual(jiniEntry);
  });

  it('starts fresh for content that is not valid JSON, a JSON array, or has a non-object "mcp" field', () => {
    for (const existing of ['{not json', '[1,2,3]', JSON.stringify({ mcp: 'not-an-object' })]) {
      expect(JSON.parse(mergeEnvContentMcpConfig(existing, entry))).toMatchObject({ mcp: { jini: jiniEntry } });
    }
  });

  // SEC: this whole string becomes an *environment variable value*, never argv — see the executor's
  // `childEnv` comment. Within it, the token must sit in `environment` (the MCP child's env), not in
  // `command` (which OpenCode spawns, putting it in `ps`).
  it('keeps a resolved credential in environment and out of command', () => {
    const withToken = { ...entry, env: { ...entry.env, JINI_DAEMON_TOKEN: 'run-scoped-secret' } };
    const parsed = JSON.parse(mergeEnvContentMcpConfig(undefined, withToken));
    expect(parsed.mcp.jini.command).toEqual(['jini-mcp', '--quiet']);
    expect(JSON.stringify(parsed.mcp.jini.command)).not.toContain('run-scoped-secret');
    expect(parsed.mcp.jini.environment.JINI_DAEMON_TOKEN).toBe('run-scoped-secret');
  });
});

describe('buildCodexMcpServerToml', () => {
  const entry = { command: 'jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };

  // Shape verified live against installed Codex CLI 0.151.0 by round-tripping `codex mcp add` /
  // `codex mcp list` against a scratch CODEX_HOME and reading back the exact TOML it wrote.
  it('emits the [mcp_servers.jini] table plus a nested .env table', () => {
    expect(buildCodexMcpServerToml(entry)).toBe(
      '[mcp_servers.jini]\ncommand = "jini-mcp"\nargs = ["--quiet"]\n\n[mcp_servers.jini.env]\nJINI_RUN_ID = "run-1"\nJINI_DAEMON_URL = "http://d"\n',
    );
  });

  // The real type always carries JINI_RUN_ID/JINI_DAEMON_URL (buildMcpJsonServerEntry sets both
  // unconditionally), so an empty `env` is unreachable through production callers — the `as`
  // below constructs that state directly to exercise this function's own defensive branch.
  it('omits the .env table entirely when the entry carries no env vars', () => {
    const noEnv = { ...entry, env: {} } as typeof entry;
    expect(buildCodexMcpServerToml(noEnv)).toBe('[mcp_servers.jini]\ncommand = "jini-mcp"\nargs = ["--quiet"]\n');
  });

  it('serialises multiple argv tokens as a comma-separated TOML array', () => {
    const toml = buildCodexMcpServerToml({ ...entry, args: ['--a', '--b', '--c'] });
    expect(toml).toContain('args = ["--a", "--b", "--c"]');
  });

  it('includes JINI_DAEMON_TOKEN in the .env table when the entry carries a resolved credential', () => {
    const withToken = { ...entry, env: { ...entry.env, JINI_DAEMON_TOKEN: 'run-scoped-secret' } };
    const toml = buildCodexMcpServerToml(withToken);
    expect(toml).toContain('JINI_DAEMON_TOKEN = "run-scoped-secret"');
    // SEC: the credential must land in the env table, never inside the args array (readable via `ps`).
    expect(toml.split('args = ')[1]!.split('\n')[0]).not.toContain('run-scoped-secret');
  });

  // Adversarial: a command/arg/env value carrying TOML-significant characters must not break the
  // file's syntax or let a value escape its own string.
  it('escapes backslashes, double quotes, and whitespace control characters in every string field', () => {
    const hostile = {
      command: 'C:\\bin\\jini-mcp.exe',
      args: ['--label', 'say "hi"\tthen\nnewline\r'],
      env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' },
    };
    const toml = buildCodexMcpServerToml(hostile);
    expect(toml).toContain('command = "C:\\\\bin\\\\jini-mcp.exe"');
    expect(toml).toContain('"say \\"hi\\"\\tthen\\nnewline\\r"');
  });
});

describe('buildCodexHomeConfigToml', () => {
  const entry = { command: 'jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://d' } };

  it('produces just this run\'s block when there is no existing config (fresh Codex install)', () => {
    expect(buildCodexHomeConfigToml(undefined, entry)).toBe(buildCodexMcpServerToml(entry));
  });

  it('appends after existing content that already ends with a newline, with exactly one blank-line separator', () => {
    const existing = '[sandbox]\nmode = "workspace-write"\n';
    const result = buildCodexHomeConfigToml(existing, entry);
    expect(result).toBe(`${existing}\n${buildCodexMcpServerToml(entry)}`);
  });

  it('finishes a trailing partial line before appending, when existing content has no trailing newline', () => {
    const existing = '[sandbox]\nmode = "workspace-write"';
    const result = buildCodexHomeConfigToml(existing, entry);
    expect(result).toBe(`${existing}\n\n${buildCodexMcpServerToml(entry)}`);
  });

  // Append-only, never parsed: every pre-existing setting — model choice, sandbox policy, the
  // operator's own other MCP servers — must survive byte-for-byte, since this driver has no TOML
  // parser to safely rewrite them with.
  it('preserves unrelated existing sections byte-for-byte', () => {
    const existing = '[model]\nselected = "gpt-5.4"\n\n[mcp_servers.supabase]\ncommand = "npx"\n';
    const result = buildCodexHomeConfigToml(existing, entry);
    expect(result).toContain(existing);
    expect(result).toContain('[mcp_servers.jini]');
  });

  it('treats an empty existing string the same as undefined', () => {
    expect(buildCodexHomeConfigToml('', entry)).toBe(buildCodexMcpServerToml(entry));
  });
});

describe('resolveSourceCodexHomeDir', () => {
  it('uses hostEnv.CODEX_HOME when set to a non-blank value', () => {
    expect(resolveSourceCodexHomeDir({ CODEX_HOME: '/custom/codex-home' })).toBe('/custom/codex-home');
  });

  it('falls back to ~/.codex when CODEX_HOME is unset', () => {
    expect(resolveSourceCodexHomeDir({})).toBe(path.join(os.homedir(), '.codex'));
  });

  it('treats a blank/whitespace-only CODEX_HOME the same as unset', () => {
    expect(resolveSourceCodexHomeDir({ CODEX_HOME: '   ' })).toBe(path.join(os.homedir(), '.codex'));
  });
});

describe('resolveSourceClaudeConfigDir', () => {
  it('uses hostEnv.CLAUDE_CONFIG_DIR when set to a non-blank value', () => {
    expect(resolveSourceClaudeConfigDir({ CLAUDE_CONFIG_DIR: '/custom/claude-config' })).toBe('/custom/claude-config');
  });

  it('falls back to ~/.claude when CLAUDE_CONFIG_DIR is unset', () => {
    expect(resolveSourceClaudeConfigDir({})).toBe(path.join(os.homedir(), '.claude'));
  });

  it('treats a blank/whitespace-only CLAUDE_CONFIG_DIR the same as unset', () => {
    expect(resolveSourceClaudeConfigDir({ CLAUDE_CONFIG_DIR: '   ' })).toBe(path.join(os.homedir(), '.claude'));
  });
});

describe('buildMcpBridgeDelivery', () => {
  const options: McpJsonInjectionOptions = {
    command: '/usr/bin/jini-mcp',
    args: ['--quiet'],
    daemonUrl: 'http://127.0.0.1:4242',
  };
  const base = { cwd: '/work/proj', runId: 'run-1', options, credential: undefined };

  it('returns null when the host configured no injection at all', () => {
    expect(buildMcpBridgeDelivery({ ...base, strategy: 'acp-merge', options: undefined })).toBeNull();
  });

  it('returns null for a def declaring no externalMcpInjection strategy', () => {
    expect(buildMcpBridgeDelivery({ ...base, strategy: undefined })).toBeNull();
  });

  // Run-scoped, not a shared `cwd/.mcp.json` — see `mcpJsonPathForRun`'s own doc for the cross-run
  // credential leak a shared filename caused (two runs in one cwd overwrite each other's bearer
  // token before either child has read it).
  it('maps claude-mcp-json to a run-scoped .mcp.jini-<runId>.json path, not a shared cwd/.mcp.json', () => {
    const delivery = buildMcpBridgeDelivery({ ...base, strategy: 'claude-mcp-json' });
    expect(delivery).toMatchObject({
      kind: 'claude-mcp-json',
      mcpJsonPath: path.join('/work/proj', '.mcp.jini-run-1.json'),
    });
  });

  it('maps acp-merge to ACP session/new mcpServers entries', () => {
    const delivery = buildMcpBridgeDelivery({ ...base, strategy: 'acp-merge' });
    expect(delivery).toMatchObject({ kind: 'acp-merge', mcpServers: [{ name: 'jini', command: '/usr/bin/jini-mcp' }] });
  });

  it('maps the two env-content strategies to their own env var, sharing one serialiser', () => {
    expect(buildMcpBridgeDelivery({ ...base, strategy: 'opencode-env-content' })).toMatchObject({
      kind: 'env-content',
      envVarName: 'OPENCODE_CONFIG_CONTENT',
    });
    expect(buildMcpBridgeDelivery({ ...base, strategy: 'mimo-env-content' })).toMatchObject({
      kind: 'env-content',
      envVarName: 'MIMOCODE_CONFIG_CONTENT',
    });
  });

  // `'codex-toml'` carries no path — unlike `'claude-mcp-json'`'s deterministic `mcpJsonPath`, the
  // scratch CODEX_HOME directory needs `fs.mkdtemp` (a real, non-deterministic effect), which this
  // pure, synchronous dispatch cannot perform. `prepareCodexHomeIfNeeded` stages it separately.
  it('maps codex-toml to a bare serverEntry with no path — the directory is staged separately', () => {
    const delivery = buildMcpBridgeDelivery({ ...base, strategy: 'codex-toml' });
    expect(delivery).toEqual({
      kind: 'codex-toml',
      serverEntry: {
        command: '/usr/bin/jini-mcp',
        args: ['--quiet'],
        env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
      },
    });
  });

  // `'env-passthrough'` (antigravity): like `'codex-toml'`, a bare serverEntry — but unlike it,
  // there is no directory or file to stage at all. The whole delivery IS the env triple; a
  // consumer applies `serverEntry.env` directly to the child's own environment (see
  // `computeChildEnv`'s tests below), never to a config document or a named carrier variable.
  it('maps env-passthrough to a bare serverEntry, carrying no path and no carrier variable', () => {
    const delivery = buildMcpBridgeDelivery({ ...base, strategy: 'env-passthrough' });
    expect(delivery).toEqual({
      kind: 'env-passthrough',
      serverEntry: {
        command: '/usr/bin/jini-mcp',
        args: ['--quiet'],
        env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
      },
    });
  });

  it('threads the resolved credential into every mechanism, not just claude-mcp-json', () => {
    const withToken = { ...base, credential: 'run-scoped-secret' };
    const claude = buildMcpBridgeDelivery({ ...withToken, strategy: 'claude-mcp-json' });
    const acp = buildMcpBridgeDelivery({ ...withToken, strategy: 'acp-merge' });
    const env = buildMcpBridgeDelivery({ ...withToken, strategy: 'mimo-env-content' });
    const codex = buildMcpBridgeDelivery({ ...withToken, strategy: 'codex-toml' });
    const passthrough = buildMcpBridgeDelivery({ ...withToken, strategy: 'env-passthrough' });
    expect(claude).toMatchObject({ serverEntry: { env: { JINI_DAEMON_TOKEN: 'run-scoped-secret' } } });
    expect(acp).toMatchObject({ mcpServers: [{ env: { JINI_DAEMON_TOKEN: 'run-scoped-secret' } }] });
    expect(env).toMatchObject({ serverEntry: { env: { JINI_DAEMON_TOKEN: 'run-scoped-secret' } } });
    expect(codex).toMatchObject({ serverEntry: { env: { JINI_DAEMON_TOKEN: 'run-scoped-secret' } } });
    expect(passthrough).toMatchObject({ serverEntry: { env: { JINI_DAEMON_TOKEN: 'run-scoped-secret' } } });
  });

  // The registry-level invariant this whole task exists to establish: a def earns a working MCP
  // bridge by *declaring a strategy*, not by being named anywhere in the executor. If someone adds a
  // 25th def with a declared strategy, this fails unless the dispatch covers it.
  it('produces a delivery for every real def that declares a strategy — all 24, no gaps', () => {
    const declaring = AGENT_DEFS.filter((def) => def.externalMcpInjection !== undefined);
    expect(declaring.length).toBeGreaterThan(0);
    const undelivered = declaring
      .filter((def) => buildMcpBridgeDelivery({ ...base, strategy: def.externalMcpInjection }) === null)
      .map((def) => def.id);
    expect(undelivered).toEqual([]);
  });

  it('covers the 9 acp-merge defs — the 8 the review found getting zero MCP tools, plus amr (a later oversight, same fix)', () => {
    const acpMergeDefs = AGENT_DEFS.filter((def) => def.externalMcpInjection === 'acp-merge');
    expect(acpMergeDefs.map((def) => def.id).sort()).toEqual([
      'amr',
      'devin',
      'hermes',
      'kilo',
      'kimi',
      'kiro',
      'reasonix',
      'trae-cli',
      'vibe',
    ]);
    // Driven from each real def's own declared strategy, not a repeated literal, so a def silently
    // switching strategies shows up here.
    for (const def of acpMergeDefs) {
      expect(buildMcpBridgeDelivery({ ...base, strategy: def.externalMcpInjection })).toMatchObject({
        kind: 'acp-merge',
      });
    }
  });
});

describe('resolveSystemPromptOverlayDelivery', () => {
  const base = {
    defId: 'fake-agent',
    systemPromptDelivery: undefined,
    resumesSessionViaCli: undefined,
    resumesSessionViaAcpLoad: undefined,
    overlay: 'Follow the house rules.',
    prompt: 'What is the weather doing today?',
    resumeSessionId: undefined,
  };

  it('passes the prompt through unchanged and appends nothing when there is no overlay', () => {
    expect(resolveSystemPromptOverlayDelivery({ ...base, overlay: undefined })).toEqual({
      promptPrefix: '',
      prompt: base.prompt,
      extraArgs: [],
      envOverrides: {},
    });
    expect(resolveSystemPromptOverlayDelivery({ ...base, overlay: null })).toEqual({
      promptPrefix: '',
      prompt: base.prompt,
      extraArgs: [],
      envOverrides: {},
    });
    expect(resolveSystemPromptOverlayDelivery({ ...base, overlay: '' })).toEqual({
      promptPrefix: '',
      prompt: base.prompt,
      extraArgs: [],
      envOverrides: {},
    });
  });

  it("fallback (no declared strategy): prefixes the overlay onto the prompt, clearly delimited", () => {
    expect(resolveSystemPromptOverlayDelivery(base)).toEqual({
      // The one strategy that carries the overlay in the prompt text, so the one non-empty
      // `promptPrefix`. Every transport in `run()` applies this prefix verbatim; asserting `''`
      // on each of the other cases below is what pins the no-double-delivery invariant.
      promptPrefix: 'Follow the house rules.\n\n---\n\n',
      prompt: 'Follow the house rules.\n\n---\n\nWhat is the weather doing today?',
      extraArgs: [],
      envOverrides: {},
    });
  });

  it('fallback: a def with no session memory gets the prefix on every turn, resumeSessionId or not', () => {
    const withResumeId = resolveSystemPromptOverlayDelivery({ ...base, resumeSessionId: 'sess-1' });
    expect(withResumeId.prompt.startsWith('Follow the house rules.')).toBe(true);
  });

  it('fallback: a resumesSessionViaCli def gets the prefix on its session-creating turn (no resumeSessionId yet)', () => {
    const delivery = resolveSystemPromptOverlayDelivery({ ...base, resumesSessionViaCli: true, resumeSessionId: undefined });
    expect(delivery.prompt.startsWith('Follow the house rules.')).toBe(true);
  });

  it('fallback: a resumesSessionViaCli def does NOT get the prefix once a resumeSessionId is present — avoids compounding it into the CLI-owned session history', () => {
    const delivery = resolveSystemPromptOverlayDelivery({ ...base, resumesSessionViaCli: true, resumeSessionId: 'sess-1' });
    expect(delivery).toEqual({ promptPrefix: '', prompt: base.prompt, extraArgs: [], envOverrides: {} });
  });

  it('fallback: same resume-in-progress skip applies to resumesSessionViaAcpLoad defs (amr)', () => {
    const delivery = resolveSystemPromptOverlayDelivery({ ...base, resumesSessionViaAcpLoad: true, resumeSessionId: 'acp-sess-1' });
    expect(delivery).toEqual({ promptPrefix: '', prompt: base.prompt, extraArgs: [], envOverrides: {} });
  });

  it("fallback: an empty-string resumeSessionId does not count as 'continuing a session'", () => {
    const delivery = resolveSystemPromptOverlayDelivery({ ...base, resumesSessionViaCli: true, resumeSessionId: '' });
    expect(delivery.prompt.startsWith('Follow the house rules.')).toBe(true);
  });

  it("'append-flag': leaves the prompt untouched and appends the flag + overlay as extra argv", () => {
    const delivery = resolveSystemPromptOverlayDelivery({
      ...base,
      systemPromptDelivery: { strategy: 'append-flag', flag: '--append-system-prompt' },
    });
    expect(delivery).toEqual({
      promptPrefix: '',
      prompt: base.prompt,
      extraArgs: ['--append-system-prompt', 'Follow the house rules.'],
      envOverrides: {},
    });
  });

  it("'append-flag': pushed on every turn unconditionally, unlike the fallback — a resumed session still gets it", () => {
    const delivery = resolveSystemPromptOverlayDelivery({
      ...base,
      systemPromptDelivery: { strategy: 'append-flag', flag: '--append-system-prompt' },
      resumesSessionViaCli: true,
      resumeSessionId: 'sess-1',
    });
    expect(delivery.extraArgs).toEqual(['--append-system-prompt', 'Follow the house rules.']);
  });

  it("'append-flag' with a capabilityKey: gated on the probed capability, same as claude's own pre-existing behavior", () => {
    agentCapabilities.set('fake-agent', { appendSystemPrompt: true });
    const gated = resolveSystemPromptOverlayDelivery({
      ...base,
      systemPromptDelivery: { strategy: 'append-flag', flag: '--append-system-prompt', capabilityKey: 'appendSystemPrompt' },
    });
    expect(gated.extraArgs).toEqual(['--append-system-prompt', 'Follow the house rules.']);
    agentCapabilities.delete('fake-agent');
  });

  it("'append-flag' with a capabilityKey explicitly false: an older build rejected the probe, so the flag is withheld rather than risking exit 1", () => {
    agentCapabilities.set('fake-agent', { appendSystemPrompt: false });
    const gated = resolveSystemPromptOverlayDelivery({
      ...base,
      systemPromptDelivery: { strategy: 'append-flag', flag: '--append-system-prompt', capabilityKey: 'appendSystemPrompt' },
    });
    expect(gated).toEqual({ promptPrefix: '', prompt: base.prompt, extraArgs: [], envOverrides: {} });
    agentCapabilities.delete('fake-agent');
  });

  it("'append-flag' with a capabilityKey never probed (agentCapabilities has no entry for this def): allowed by default, matching claude.ts's own pre-existing `agentCapabilities.get(id) || {}` — only an explicit `false` withholds the flag", () => {
    const gated = resolveSystemPromptOverlayDelivery({
      ...base,
      systemPromptDelivery: { strategy: 'append-flag', flag: '--append-system-prompt', capabilityKey: 'appendSystemPrompt' },
    });
    expect(gated.extraArgs).toEqual(['--append-system-prompt', 'Follow the house rules.']);
  });

  it("'env-var': leaves the prompt and extraArgs untouched and returns the overlay as an env override keyed by the declared varName", () => {
    const delivery = resolveSystemPromptOverlayDelivery({
      ...base,
      systemPromptDelivery: { strategy: 'env-var', varName: 'REASONIX_ACP_SYSTEM_APPEND' },
    });
    expect(delivery).toEqual({
      promptPrefix: '',
      prompt: base.prompt,
      extraArgs: [],
      envOverrides: { REASONIX_ACP_SYSTEM_APPEND: 'Follow the house rules.' },
    });
  });

  it("'env-var': pushed on every turn unconditionally, same as 'append-flag' — a resumed session still gets it", () => {
    const delivery = resolveSystemPromptOverlayDelivery({
      ...base,
      systemPromptDelivery: { strategy: 'env-var', varName: 'REASONIX_ACP_SYSTEM_APPEND' },
      resumesSessionViaAcpLoad: true,
      resumeSessionId: 'acp-sess-1',
    });
    expect(delivery.envOverrides).toEqual({ REASONIX_ACP_SYSTEM_APPEND: 'Follow the house rules.' });
  });

  // The registry-level invariant this whole task exists to establish: every real def gets overlay
  // delivery one way or another — either it declared `systemPromptDelivery` (native, via argv, env,
  // or a staged config file), or it falls through to the universal prompt-prefix. Neither path is a
  // silent no-op for any of the 24 (a def like `reasonix` delivers via `envOverrides` alone,
  // touching neither `prompt` nor `extraArgs` — the check below has to look at all three channels,
  // not just two, or it would falsely flag every `'env-var'` def as undelivered).
  //
  // `'config-instructions-file'` defs (`opencode` today) are EXCLUDED from this particular check,
  // not exempted from the invariant itself: that strategy's real delivery happens through a
  // separate async staging phase (`prepareSystemPromptOverlayFileIfNeeded` +
  // `computeChildEnv`/`mergeEnvContentInstructions`, since it needs real filesystem I/O this pure
  // function cannot perform — see its own `'config-instructions-file'` branch's comment), so from
  // THIS function's point of view alone, a no-op return is the correct, intended result, not a gap.
  // The registry-wide "does it actually get delivered" coverage for that strategy lives in the
  // `prepareSystemPromptOverlayFileIfNeeded`/`computeChildEnv` describe blocks below instead.
  it('every real def in the registry resolves to SOME delivery through this function when an overlay is present — no def is silently dropped, aside from the config-file strategy covered separately below', () => {
    for (const def of AGENT_DEFS) {
      if (def.systemPromptDelivery?.strategy === 'config-instructions-file') continue;
      const delivery = resolveSystemPromptOverlayDelivery({
        defId: def.id,
        systemPromptDelivery: def.systemPromptDelivery,
        resumesSessionViaCli: def.resumesSessionViaCli,
        resumesSessionViaAcpLoad: def.resumesSessionViaAcpLoad,
        overlay: 'x',
        prompt: 'y',
        resumeSessionId: undefined,
      });
      const deliversViaPrompt = delivery.prompt !== 'y';
      const deliversViaArgs = delivery.extraArgs.length > 0;
      const deliversViaEnv = Object.keys(delivery.envOverrides).length > 0;
      expect(deliversViaPrompt || deliversViaArgs || deliversViaEnv, `def "${def.id}" delivered nothing`).toBe(true);
    }
  });

  it("'config-instructions-file': resolveSystemPromptOverlayDelivery itself is a deliberate no-op — delivery happens in prepareSystemPromptOverlayFileIfNeeded/computeChildEnv instead", () => {
    const delivery = resolveSystemPromptOverlayDelivery({
      ...base,
      systemPromptDelivery: { strategy: 'config-instructions-file', varName: 'OPENCODE_CONFIG_CONTENT' },
    });
    expect(delivery).toEqual({ promptPrefix: '', prompt: base.prompt, extraArgs: [], envOverrides: {} });
  });
});

describe('prepareSystemPromptOverlayFileIfNeeded', () => {
  const configInstructionsFileDef = createFakeDef({
    systemPromptDelivery: { strategy: 'config-instructions-file', varName: 'FAKE_CONFIG_CONTENT' },
  });
  const noStrategyDef = createFakeDef();
  const failBeforeSpawn = async (_runId: string, code: AgentExecutorErrorCode, message: string): Promise<never> => {
    throw new AgentExecutorError(code, message);
  };

  it('returns null (no staging) when the def has no systemPromptDelivery at all', async () => {
    const result = await prepareSystemPromptOverlayFileIfNeeded(
      { runId: 'run-1', def: noStrategyDef, overlay: 'Follow the house rules.' },
      { releaseStagedResources: async () => {}, failBeforeSpawn },
    );
    expect(result).toBeNull();
  });

  it('returns null (no staging) for a def declaring a DIFFERENT strategy', async () => {
    const result = await prepareSystemPromptOverlayFileIfNeeded(
      { runId: 'run-1', def: { ...configInstructionsFileDef, systemPromptDelivery: { strategy: 'env-var', varName: 'X' } }, overlay: 'Follow the house rules.' },
      { releaseStagedResources: async () => {}, failBeforeSpawn },
    );
    expect(result).toBeNull();
  });

  it('returns null (no staging) when there is no overlay to stage', async () => {
    const result = await prepareSystemPromptOverlayFileIfNeeded(
      { runId: 'run-1', def: configInstructionsFileDef, overlay: undefined },
      { releaseStagedResources: async () => {}, failBeforeSpawn },
    );
    expect(result).toBeNull();
  });

  it('stages the overlay text to a real temp file and cleans it up afterward', async () => {
    const result = await prepareSystemPromptOverlayFileIfNeeded(
      { runId: 'run-1', def: configInstructionsFileDef, overlay: 'Follow the house rules.' },
      { releaseStagedResources: async () => {}, failBeforeSpawn },
    );
    expect(result).not.toBeNull();
    const staged = await fs.readFile(result!.path, 'utf8');
    expect(staged).toBe('Follow the house rules.');
    await result!.cleanup();
    await expect(fs.readFile(result!.path, 'utf8')).rejects.toThrow();
  });

  it('cleanup is safe to call more than once', async () => {
    const result = await prepareSystemPromptOverlayFileIfNeeded(
      { runId: 'run-1', def: configInstructionsFileDef, overlay: 'Follow the house rules.' },
      { releaseStagedResources: async () => {}, failBeforeSpawn },
    );
    await result!.cleanup();
    await expect(result!.cleanup()).resolves.toBeUndefined();
  });
});

describe('mergeEnvContentInstructions', () => {
  it('starts a fresh document when there is no existing value', () => {
    expect(JSON.parse(mergeEnvContentInstructions(undefined, '/tmp/overlay.md'))).toEqual({
      instructions: ['/tmp/overlay.md'],
    });
  });

  it('appends to, never clobbers, an existing instructions array', () => {
    const existing = JSON.stringify({ instructions: ['/existing/one.md'] });
    expect(JSON.parse(mergeEnvContentInstructions(existing, '/tmp/overlay.md'))).toEqual({
      instructions: ['/existing/one.md', '/tmp/overlay.md'],
    });
  });

  it('preserves an existing mcp key untouched, alongside the new instructions entry — the coexistence this whole mechanism depends on', () => {
    const existing = JSON.stringify({ mcp: { jini: { type: 'local', command: ['node', 'x.mjs'], environment: {}, enabled: true } } });
    const merged = JSON.parse(mergeEnvContentInstructions(existing, '/tmp/overlay.md'));
    expect(merged).toEqual({
      mcp: { jini: { type: 'local', command: ['node', 'x.mjs'], environment: {}, enabled: true } },
      instructions: ['/tmp/overlay.md'],
    });
  });

  it('starts fresh (does not throw) when the existing value is unparseable JSON', () => {
    expect(JSON.parse(mergeEnvContentInstructions('not json{', '/tmp/overlay.md'))).toEqual({
      instructions: ['/tmp/overlay.md'],
    });
  });

  it('ignores non-string entries in an existing instructions array rather than propagating malformed data', () => {
    const existing = JSON.stringify({ instructions: ['/existing/one.md', 42, null] });
    expect(JSON.parse(mergeEnvContentInstructions(existing, '/tmp/overlay.md'))).toEqual({
      instructions: ['/existing/one.md', '/tmp/overlay.md'],
    });
  });
});

describe('computeChildEnv — stagedInstructionsFile param', () => {
  it('merges the staged instructions file into the named var, alongside an existing mcp-key value on the same var', () => {
    const mcpBridge: McpBridgeDelivery = {
      kind: 'env-content',
      envVarName: 'OPENCODE_CONFIG_CONTENT',
      serverEntry: { command: '/usr/bin/jini-mcp', args: ['--quiet'], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4242' } },
    };
    const result = computeChildEnv({}, mcpBridge, undefined, undefined, {
      varName: 'OPENCODE_CONFIG_CONTENT',
      path: '/tmp/overlay.md',
    });
    expect(JSON.parse(result.OPENCODE_CONFIG_CONTENT!)).toEqual({
      mcp: {
        jini: {
          type: 'local',
          command: ['/usr/bin/jini-mcp', '--quiet'],
          environment: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
          enabled: true,
        },
      },
      instructions: ['/tmp/overlay.md'],
    });
  });

  it('is a no-op when no instructions file was staged (undefined, the default)', () => {
    const result = computeChildEnv({ FOO: 'bar' }, null);
    expect(result).toEqual({ FOO: 'bar' });
  });
});

describe("computeChildEnv — 'env-passthrough' kind (antigravity)", () => {
  it('sets the bridge entry env keys directly on the child env, alongside whatever the host already set', () => {
    const mcpBridge: McpBridgeDelivery = {
      kind: 'env-passthrough',
      serverEntry: {
        command: '/usr/bin/jini-mcp',
        args: ['--quiet'],
        env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4242', JINI_DAEMON_TOKEN: 'run-scoped-secret' },
      },
    };
    const result = computeChildEnv({ PATH: '/usr/bin', HOME: '/home/op' }, mcpBridge);
    // Existing, unrelated spawn env is preserved...
    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/home/op');
    // ...and the bridge's env lands as flat top-level vars, not nested in any document/carrier var.
    expect(result.JINI_RUN_ID).toBe('run-1');
    expect(result.JINI_DAEMON_URL).toBe('http://127.0.0.1:4242');
    expect(result.JINI_DAEMON_TOKEN).toBe('run-scoped-secret');
  });

  it('omits JINI_DAEMON_TOKEN when no credential was resolved, matching every other mechanism', () => {
    const mcpBridge: McpBridgeDelivery = {
      kind: 'env-passthrough',
      serverEntry: { command: '/usr/bin/jini-mcp', args: [], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4242' } },
    };
    const result = computeChildEnv({}, mcpBridge);
    expect(result.JINI_DAEMON_TOKEN).toBeUndefined();
  });

  it('is a no-op for every other bridge kind — env-passthrough only applies to its own kind', () => {
    const claudeBridge: McpBridgeDelivery = {
      kind: 'claude-mcp-json',
      mcpJsonPath: '/work/.mcp.jini-run-1.json',
      serverEntry: { command: '/usr/bin/jini-mcp', args: [], env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:4242' } },
    };
    const result = computeChildEnv({ FOO: 'bar' }, claudeBridge);
    expect(result).toEqual({ FOO: 'bar' });
    expect(result.JINI_RUN_ID).toBeUndefined();
  });
});

describe("AgentExecutor — 'acp-merge' MCP bridge delivery reaches attachAcpSession", () => {
  const mcpJsonInjection: McpJsonInjectionOptions = {
    command: '/usr/bin/jini-mcp',
    args: ['--quiet'],
    daemonUrl: 'http://127.0.0.1:4242',
  };

  async function runAcp(options: Parameters<typeof createAcpHarness>[0]) {
    const harness = createAcpHarness(options);
    const { run } = await harness.lifecycle.start({ contextRef: 'ctx-acp-mcp' });
    const runPromise = harness.executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'x', cwd: '/work' });
    await flushAsync();
    await runPromise;
    harness.child.emit('close', 0, null);
    await harness.lifecycle.waitForTerminal(run.id);
    return { ...harness, runId: run.id };
  }

  // The gap the review found: `attachAcpSession` always accepted `mcpServers`, but `wireAcpLifecycle`
  // never passed any, so all 8 ACP-native defs got zero MCP tools.
  it('passes the jini bridge server into the ACP session for an acp-merge def', async () => {
    const { attachCalls, runId } = await runAcp({
      def: { streamFormat: 'acp-json-rpc', externalMcpInjection: 'acp-merge' },
      mcpJsonInjection,
    });

    expect(attachCalls[0]?.mcpServers).toEqual([
      {
        type: 'stdio',
        name: 'jini',
        command: '/usr/bin/jini-mcp',
        args: ['--quiet'],
        env: { JINI_RUN_ID: runId, JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
      },
    ]);
  });

  it('delivers a per-run credential as JINI_DAEMON_TOKEN in the server env, never in its args', async () => {
    const { attachCalls, runId } = await runAcp({
      def: { streamFormat: 'acp-json-rpc', externalMcpInjection: 'acp-merge' },
      mcpJsonInjection: { ...mcpJsonInjection, credential: (id: string) => `token-for-${id}` },
    });

    const server = attachCalls[0]?.mcpServers?.[0] as { args: string[]; env: Record<string, string> };
    expect(server.env.JINI_DAEMON_TOKEN).toBe(`token-for-${runId}`);
    expect(server.args).toEqual(['--quiet']);
  });

  // Passing `mcpServers: []` is not the same as passing nothing for every downstream ACP agent, so
  // "no bridge configured" has to stay byte-identical to before the field existed.
  it('passes no mcpServers key at all when the host configured no injection', async () => {
    const { attachCalls } = await runAcp({ def: { streamFormat: 'acp-json-rpc', externalMcpInjection: 'acp-merge' } });
    expect(attachCalls[0]?.mcpServers).toBeUndefined();
  });

  it('passes no mcpServers for an ACP def that declares no injection strategy, even when configured', async () => {
    const { attachCalls } = await runAcp({ def: { streamFormat: 'acp-json-rpc' }, mcpJsonInjection });
    expect(attachCalls[0]?.mcpServers).toBeUndefined();
  });

  // An ACP def must not get the `.mcp.json` mechanism's filesystem effect as a side effect of the
  // shared credential resolution now covering it.
  it('writes no .mcp.json for an acp-merge def', async () => {
    const writeCalls: string[] = [];
    await runAcp({
      def: { streamFormat: 'acp-json-rpc', externalMcpInjection: 'acp-merge' },
      mcpJsonInjection: {
        ...mcpJsonInjection,
        readFile: async () => {
          throw new Error('should not be read');
        },
        writeFile: async (p: string) => {
          writeCalls.push(p);
        },
      },
    });
    expect(writeCalls).toEqual([]);
  });
});

describe("AgentExecutor — env-content MCP bridge delivery (opencode / mimo)", () => {
  const mcpJsonInjection: McpJsonInjectionOptions = {
    command: '/usr/bin/jini-mcp',
    args: ['--quiet'],
    daemonUrl: 'http://127.0.0.1:4242',
  };

  function spawnedEnv(spawnCalls: SpawnCall[]): Record<string, string> {
    return (spawnCalls[0]!.options.env ?? {}) as Record<string, string>;
  }

  it("serialises the bridge into OPENCODE_CONFIG_CONTENT for an 'opencode-env-content' def", async () => {
    const def = createFakeDef({ id: 'opencode', externalMcpInjection: 'opencode-env-content' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'opencode', prompt: 'hi', cwd: '/work' });

    expect(JSON.parse(spawnedEnv(spawnCalls).OPENCODE_CONFIG_CONTENT!)).toEqual({
      mcp: {
        jini: {
          type: 'local',
          command: ['/usr/bin/jini-mcp', '--quiet'],
          environment: { JINI_RUN_ID: run.id, JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
          enabled: true,
        },
      },
    });
    expect(spawnedEnv(spawnCalls).MIMOCODE_CONFIG_CONTENT).toBeUndefined();
  });

  it("serialises the same schema under MIMOCODE_CONFIG_CONTENT for a 'mimo-env-content' def", async () => {
    const def = createFakeDef({ id: 'mimo', externalMcpInjection: 'mimo-env-content' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'mimo', prompt: 'hi', cwd: '/work' });

    const env = spawnedEnv(spawnCalls);
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(JSON.parse(env.MIMOCODE_CONFIG_CONTENT!).mcp.jini).toEqual({
      type: 'local',
      command: ['/usr/bin/jini-mcp', '--quiet'],
      environment: { JINI_RUN_ID: run.id, JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
      enabled: true,
    });
  });

  // Both labels, one serialiser: the payloads must be byte-identical apart from which variable
  // carries them. If they ever need to diverge, this is the test that has to change deliberately.
  it('emits byte-identical config content for both env-content strategies', async () => {
    const contents: string[] = [];
    for (const [id, strategy, varName] of [
      ['opencode', 'opencode-env-content', 'OPENCODE_CONFIG_CONTENT'],
      ['mimo', 'mimo-env-content', 'MIMOCODE_CONFIG_CONTENT'],
    ] as const) {
      const def = createFakeDef({ id, externalMcpInjection: strategy });
      const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
      const { run } = await lifecycle.start({ contextRef: `ctx-${id}` });
      await executor.run({ runId: run.id, agentId: id, prompt: 'hi', cwd: '/work' });
      contents.push(spawnedEnv(spawnCalls)[varName]!.replace(run.id, '<RUN>'));
    }
    expect(contents[0]).toBe(contents[1]);
  });

  // A host may already be handing OpenCode the *user's* configured MCP servers through this exact
  // variable; the bridge must merge in beside them, not replace them.
  it("merges into a host-supplied existing value instead of clobbering it", async () => {
    const def = createFakeDef({ id: 'opencode', externalMcpInjection: 'opencode-env-content' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({
      runId: run.id,
      agentId: 'opencode',
      prompt: 'hi',
      cwd: '/work',
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { openai: {} }, mcp: { userServer: { type: 'local' } } }),
      },
    });

    const parsed = JSON.parse(spawnedEnv(spawnCalls).OPENCODE_CONFIG_CONTENT!);
    expect(parsed.provider).toEqual({ openai: {} });
    expect(Object.keys(parsed.mcp).sort()).toEqual(['jini', 'userServer']);
  });

  // SEC: the credential rides in the child's environment. It must not appear anywhere in argv, where
  // any other local user could read it out of `ps`.
  it('delivers the credential through the environment and never through process arguments', async () => {
    const def = createFakeDef({ id: 'opencode', externalMcpInjection: 'opencode-env-content' });
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      mcpJsonInjection: { ...mcpJsonInjection, credential: () => 'run-scoped-secret' },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'opencode', prompt: 'hi', cwd: '/work' });

    expect(JSON.stringify(spawnCalls[0]!.args)).not.toContain('run-scoped-secret');
    expect(JSON.parse(spawnedEnv(spawnCalls).OPENCODE_CONFIG_CONTENT!).mcp.jini.environment.JINI_DAEMON_TOKEN).toBe(
      'run-scoped-secret',
    );
  });

  it('leaves the spawn env untouched when the host configured no injection', async () => {
    const def = createFakeDef({ id: 'opencode', externalMcpInjection: 'opencode-env-content' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'opencode', prompt: 'hi', cwd: '/work' });

    expect(spawnedEnv(spawnCalls).OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });

  it('sets no config-content variable for a def declaring a different strategy', async () => {
    const def = createFakeDef({ externalMcpInjection: 'claude-mcp-json' });
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      mcpJsonInjection: { ...mcpJsonInjection, readFile: async () => '', writeFile: async () => {} },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    const env = spawnedEnv(spawnCalls);
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(env.MIMOCODE_CONFIG_CONTENT).toBeUndefined();
  });
});

describe("AgentExecutor — 'codex-toml' MCP bridge delivery (Codex CODEX_HOME relocation)", () => {
  /** Fakes the `'codex-toml'`-only seams (`mkdtemp`/`readFile`/`writeFile`/`removeDir`) — the directory analogue of `createMcpFsSpies` above. `readFile` serves `config.toml`/`auth.json` content by path suffix and ENOENTs everything else; `mkdtemp` returns a fully deterministic `/fake/tmp/<prefix>` directory (no real disk I/O, matching this package's "no real filesystem by default in tests" convention). */
  function createCodexHomeFsSpies(seed: { existingConfigToml?: string; existingAuthJson?: string } = {}): {
    mcpJsonInjection: McpJsonInjectionOptions;
    mkdtempCalls: string[];
    readCalls: string[];
    writeCalls: Array<{ path: string; content: string }>;
    removeDirCalls: string[];
  } {
    const mkdtempCalls: string[] = [];
    const readCalls: string[] = [];
    const writeCalls: Array<{ path: string; content: string }> = [];
    const removeDirCalls: string[] = [];
    const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/jini-mcp',
      args: ['--quiet'],
      daemonUrl: 'http://127.0.0.1:4242',
      mkdtemp: async (prefix: string) => {
        mkdtempCalls.push(prefix);
        return `/fake/tmp/${prefix}`;
      },
      readFile: async (p: string) => {
        readCalls.push(p);
        if (p.endsWith('config.toml')) {
          if (seed.existingConfigToml === undefined) throw enoent();
          return seed.existingConfigToml;
        }
        if (p.endsWith('auth.json')) {
          if (seed.existingAuthJson === undefined) throw enoent();
          return seed.existingAuthJson;
        }
        throw enoent();
      },
      writeFile: async (p: string, content: string) => {
        writeCalls.push({ path: p, content });
      },
      removeDir: async (p: string) => {
        removeDirCalls.push(p);
      },
    };
    return { mcpJsonInjection, mkdtempCalls, readCalls, writeCalls, removeDirCalls };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('spawns normally with no CODEX_HOME set when mcpJsonInjection is unconfigured, even for a codex-toml def', async () => {
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CODEX_HOME).toBeUndefined();
  });

  it('does not stage CODEX_HOME for a def whose externalMcpInjection is not codex-toml, even when configured', async () => {
    const { mcpJsonInjection, mkdtempCalls } = createCodexHomeFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'acp-merge' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(mkdtempCalls).toEqual([]);
    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CODEX_HOME).toBeUndefined();
  });

  it('stages a scratch config.toml (real config appended) and sets CODEX_HOME on the spawned env, strictly before spawn', async () => {
    vi.stubEnv('CODEX_HOME', '/real/codex/home');
    const { mcpJsonInjection, mkdtempCalls, readCalls, writeCalls } = createCodexHomeFsSpies({
      existingConfigToml: '[sandbox]\nmode = "workspace-write"\n',
    });
    const def = createFakeDef({ id: 'codex', externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'codex', prompt: 'hi', cwd: '/work' });

    expect(mkdtempCalls).toHaveLength(1);
    expect(mkdtempCalls[0]).toContain(run.id);
    const stagedDir = `/fake/tmp/${mkdtempCalls[0]}`;

    expect(readCalls).toEqual(expect.arrayContaining(['/real/codex/home/config.toml']));
    const configWrite = writeCalls.find((c) => c.path === `${stagedDir}/config.toml`);
    expect(configWrite?.content).toContain('[sandbox]\nmode = "workspace-write"');
    expect(configWrite?.content).toContain('[mcp_servers.jini]');
    expect(configWrite?.content).toContain(`JINI_RUN_ID = "${run.id}"`);

    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CODEX_HOME).toBe(stagedDir);
    expect(spawnCalls).toHaveLength(1);
  });

  it('treats a missing real config.toml (ENOENT) as "start fresh", not a failure', async () => {
    const { mcpJsonInjection, writeCalls } = createCodexHomeFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    const configWrite = writeCalls.find((c) => c.path.endsWith('config.toml'));
    expect(configWrite?.content).toBe(
      buildCodexMcpServerToml({
        command: '/usr/bin/jini-mcp',
        args: ['--quiet'],
        env: { JINI_RUN_ID: run.id, JINI_DAEMON_URL: 'http://127.0.0.1:4242' },
      }),
    );
    expect(spawnCalls).toHaveLength(1);
  });

  it('copies the real auth.json into the scratch CODEX_HOME so the spawned CLI stays logged in', async () => {
    const { mcpJsonInjection, writeCalls } = createCodexHomeFsSpies({ existingAuthJson: '{"token":"real-login"}' });
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    const authWrite = writeCalls.find((c) => c.path.endsWith('auth.json'));
    expect(authWrite?.content).toBe('{"token":"real-login"}');
  });

  // Best-effort by design: a real headless spawn against a CODEX_HOME with no auth.json at all was
  // confirmed (installed Codex CLI 0.151.0) to fail fast with a structured 401, never hang — so a
  // missing/unreadable credential must not block staging or the run.
  it('spawns normally with no auth.json staged when the real install has no stored login', async () => {
    const { mcpJsonInjection, writeCalls } = createCodexHomeFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(writeCalls.some((c) => c.path.endsWith('auth.json'))).toBe(false);
    expect(spawnCalls).toHaveLength(1);
  });

  it('fails the run before spawn (never a bare throw) when mkdtemp rejects', async () => {
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/jini-mcp',
      daemonUrl: 'http://127.0.0.1:4242',
      mkdtemp: async () => {
        throw new Error('ENOSPC: no space left on device');
      },
    };
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(spawnCalls).toHaveLength(0);
    const events = await collectEvents(lifecycle, run.id);
    expect(events.find((e) => e.kind === 'end')?.payload).toMatchObject({ status: 'failed', resumable: false });
  });

  // Adversarial (partial-failure state leak): a failure AFTER mkdtemp succeeds must not leave an
  // orphaned directory that may already hold a copied credential.
  it('removes the already-created directory when writing config.toml fails, so a partial stage does not leak', async () => {
    const removeDirCalls: string[] = [];
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const mcpJsonInjection: McpJsonInjectionOptions = {
      command: '/usr/bin/jini-mcp',
      daemonUrl: 'http://127.0.0.1:4242',
      mkdtemp: async (prefix: string) => `/fake/tmp/${prefix}`,
      readFile: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      writeFile: async () => {
        throw new Error('EACCES: permission denied');
      },
      removeDir: async (p: string) => void removeDirCalls.push(p),
    };
    const { lifecycle, executor, spawnCalls } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(spawnCalls).toHaveLength(0);
    expect(removeDirCalls).toHaveLength(1);
    expect(removeDirCalls[0]).toContain(run.id);
  });

  it('resolves a per-run credential and writes it into the TOML env table, never into spawn argv', async () => {
    const { mcpJsonInjection, writeCalls } = createCodexHomeFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      mcpJsonInjection: { ...mcpJsonInjection, credential: (runId: string) => `token-for-${runId}` },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    const configWrite = writeCalls.find((c) => c.path.endsWith('config.toml'));
    expect(configWrite?.content).toContain(`JINI_DAEMON_TOKEN = "token-for-${run.id}"`);
    expect(JSON.stringify(spawnCalls[0]!.args)).not.toContain(`token-for-${run.id}`);
  });

  it('removes the scratch CODEX_HOME once the child closes, so a copied credential is not left on disk', async () => {
    const { mcpJsonInjection, writeCalls, removeDirCalls } = createCodexHomeFsSpies();
    const def = createFakeDef({ streamFormat: 'plain', externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor, child } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await runPromise;
    expect(removeDirCalls).toEqual([]);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const stagedDir = writeCalls.find((c) => c.path.endsWith('config.toml'))!.path.replace('/config.toml', '');
    expect(removeDirCalls).toEqual([stagedDir]);
  });

  it('removes the scratch CODEX_HOME on a pre-spawn failure after it was already staged', async () => {
    const { mcpJsonInjection, writeCalls, removeDirCalls } = createCodexHomeFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor } = createHarness({ def, mcpJsonInjection, spawnThrows: new Error('EACCES') });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });

    const stagedDir = writeCalls.find((c) => c.path.endsWith('config.toml'))!.path.replace('/config.toml', '');
    expect(removeDirCalls).toEqual([stagedDir]);
  });

  // Removal is best-effort cleanup of a directory the run no longer needs. It must not be able to
  // do what the guarded post-close steps already exist to prevent — see the identical claude-mcp-json
  // precedent above.
  it('still finishes the run when removing the scratch CODEX_HOME fails', async () => {
    const { mcpJsonInjection } = createCodexHomeFsSpies();
    const def = createFakeDef({ streamFormat: 'plain', externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor, child, onCleanupFailure } = createHarness({
      def,
      mcpJsonInjection: {
        ...mcpJsonInjection,
        removeDir: async () => {
          throw new Error('EPERM: operation not permitted');
        },
      },
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await runPromise;

    child.emit('close', 0, null);
    expect((await lifecycle.waitForTerminal(run.id)).state).toBe('succeeded');
    expect(onCleanupFailure.mock.calls[0]![0]).toMatchObject({ runId: run.id, phase: 'staged-file-cleanup' });
  });

  // A run id reaches this driver from a host and lands in a mkdtemp prefix. Anything path-like in
  // it must not be able to steer the staged directory outside os.tmpdir() — same discipline as
  // claude-mcp-json's identical run-id-in-a-filename guard above.
  it('sanitizes a path-like run id out of the mkdtemp prefix', async () => {
    const { mcpJsonInjection, mkdtempCalls } = createCodexHomeFsSpies();
    const def = createFakeDef({ externalMcpInjection: 'codex-toml' });
    const { lifecycle, executor } = createHarness({ def, mcpJsonInjection });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1', runId: '../../etc/evil' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(mkdtempCalls[0]).not.toContain('..');
    expect(mkdtempCalls[0]).not.toContain('/');
  });
});

describe("AgentExecutor — Finding 1 (SEC-assistant-env-isolation-2026-09-07): claude CLAUDE_CONFIG_DIR isolation", () => {
  /** Fakes the Claude-config-dir-only seams (`mkdtemp`/`readFile`/`writeFile`/`removeDir`) — the directory analogue of `createCodexHomeFsSpies` above. `readFile` serves `.credentials.json` content and ENOENTs everything else; `mkdtemp` returns a fully deterministic `/fake/tmp/<prefix>` directory. */
  function createClaudeConfigDirFsSpies(seed: { existingCredentialsJson?: string } = {}): {
    claudeConfigDirIsolation: ClaudeConfigDirIsolationOptions;
    mkdtempCalls: string[];
    readCalls: string[];
    writeCalls: Array<{ path: string; content: string }>;
    removeDirCalls: string[];
  } {
    const mkdtempCalls: string[] = [];
    const readCalls: string[] = [];
    const writeCalls: Array<{ path: string; content: string }> = [];
    const removeDirCalls: string[] = [];
    const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const claudeConfigDirIsolation: ClaudeConfigDirIsolationOptions = {
      mkdtemp: async (prefix: string) => {
        mkdtempCalls.push(prefix);
        return `/fake/tmp/${prefix}`;
      },
      readFile: async (p: string) => {
        readCalls.push(p);
        if (p.endsWith('.credentials.json')) {
          if (seed.existingCredentialsJson === undefined) throw enoent();
          return seed.existingCredentialsJson;
        }
        throw enoent();
      },
      writeFile: async (p: string, content: string) => {
        writeCalls.push({ path: p, content });
      },
      removeDir: async (p: string) => {
        removeDirCalls.push(p);
      },
    };
    return { claudeConfigDirIsolation, mkdtempCalls, readCalls, writeCalls, removeDirCalls };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not stage CLAUDE_CONFIG_DIR for a def whose id is not "claude", even when the seams are configured and isolation is enabled', async () => {
    const { claudeConfigDirIsolation, mkdtempCalls } = createClaudeConfigDirFsSpies();
    const def = createFakeDef({ id: 'fake-agent' });
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      claudeConfigDirIsolation,
      claudeConfigDirIsolationEnabled: true,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

    expect(mkdtempCalls).toEqual([]);
    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  // 2026-09-08 rollback (see CreateAgentExecutorOptions.claudeConfigDirIsolationEnabled's own doc):
  // isolation now requires an explicit opt-in. Without it, a "claude"-id def with seams configured
  // must NOT stage anything — this is the default the assistant's own Local CLI runtime ships with,
  // specifically so the operator's real Keychain login is visible to the spawned CLI.
  it('does not stage CLAUDE_CONFIG_DIR for a "claude"-id def by default (claudeConfigDirIsolationEnabled omitted), even when the seams are configured', async () => {
    const { claudeConfigDirIsolation, mkdtempCalls } = createClaudeConfigDirFsSpies();
    const def = createFakeDef({ id: 'claude' });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, claudeConfigDirIsolation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work' });

    expect(mkdtempCalls).toEqual([]);
    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('stages a scratch, empty-by-default CLAUDE_CONFIG_DIR and sets it on the spawned env for a "claude"-id def once isolation is explicitly enabled (no mcpJsonInjection required)', async () => {
    const { claudeConfigDirIsolation, mkdtempCalls, writeCalls } = createClaudeConfigDirFsSpies();
    const def = createFakeDef({ id: 'claude' });
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      claudeConfigDirIsolation,
      claudeConfigDirIsolationEnabled: true,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work' });

    expect(mkdtempCalls).toHaveLength(1);
    expect(mkdtempCalls[0]).toContain(run.id);
    const stagedDir = `/fake/tmp/${mkdtempCalls[0]}`;

    // Deliberately empty by default — no config.json/settings.json written, unlike Codex's
    // config.toml copy. See prepareClaudeConfigDirForRun's own doc for why this is the fix, not a
    // gap: the operator's real skills/plugins/agents/memory index must not carry over implicitly.
    expect(writeCalls).toEqual([]);

    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CLAUDE_CONFIG_DIR).toBe(stagedDir);
    expect(spawnCalls).toHaveLength(1);
  });

  it("does NOT leak the operator's real HOME-derived config dir — HOME itself is untouched, but CLAUDE_CONFIG_DIR overrides where claude actually resolves its config", async () => {
    const { claudeConfigDirIsolation } = createClaudeConfigDirFsSpies();
    const def = createFakeDef({ id: 'claude' });
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      claudeConfigDirIsolation,
      claudeConfigDirIsolationEnabled: true,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work' });

    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CLAUDE_CONFIG_DIR).not.toBe(path.join(os.homedir(), '.claude'));
    expect(env.CLAUDE_CONFIG_DIR).toMatch(/^\/fake\/tmp\//);
  });

  it('copies the real .credentials.json into the scratch dir so a file-based login (Linux/Windows/Keychain-locked-macOS-fallback) is preserved', async () => {
    const { claudeConfigDirIsolation, writeCalls } = createClaudeConfigDirFsSpies({
      existingCredentialsJson: '{"claudeAiOauth":{"accessToken":"real-login"}}',
    });
    const def = createFakeDef({ id: 'claude' });
    const { lifecycle, executor } = createHarness({
      def,
      claudeConfigDirIsolation,
      claudeConfigDirIsolationEnabled: true,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work' });

    const credentialsWrite = writeCalls.find((c) => c.path.endsWith('.credentials.json'));
    expect(credentialsWrite?.content).toBe('{"claudeAiOauth":{"accessToken":"real-login"}}');
  });

  // Verified live (2026-09-07, installed Claude Code 2.1.263, macOS): a scratch CLAUDE_CONFIG_DIR
  // with nothing staged reports `loggedIn: false` via `claude auth status` — this is a real,
  // accepted, documented trade-off (see prepareClaudeConfigDirForRun's own doc), not a bug this test
  // is missing. Mirrors Codex's identical accepted outcome for a missing auth.json.
  it('spawns normally with no .credentials.json staged when the real config dir has no file-based login (the common macOS-Keychain-only case)', async () => {
    const { claudeConfigDirIsolation, writeCalls } = createClaudeConfigDirFsSpies();
    const def = createFakeDef({ id: 'claude' });
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      claudeConfigDirIsolation,
      claudeConfigDirIsolationEnabled: true,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work' });

    expect(writeCalls.some((c) => c.path.endsWith('.credentials.json'))).toBe(false);
    expect(spawnCalls).toHaveLength(1);
  });

  it('fails the run before spawn (never a bare throw) when mkdtemp rejects', async () => {
    const def = createFakeDef({ id: 'claude' });
    const claudeConfigDirIsolation: ClaudeConfigDirIsolationOptions = {
      mkdtemp: async () => {
        throw new Error('ENOSPC: no space left on device');
      },
    };
    const { lifecycle, executor, spawnCalls } = createHarness({
      def,
      claudeConfigDirIsolation,
      claudeConfigDirIsolationEnabled: true,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    await expect(
      executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work' }),
    ).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(spawnCalls).toHaveLength(0);
  });

  it('removes the scratch CLAUDE_CONFIG_DIR once the child closes, so a copied credential is not left on disk', async () => {
    const { claudeConfigDirIsolation, mkdtempCalls, removeDirCalls } = createClaudeConfigDirFsSpies();
    const def = createFakeDef({ id: 'claude', streamFormat: 'plain' });
    const { lifecycle, executor, child } = createHarness({
      def,
      claudeConfigDirIsolation,
      claudeConfigDirIsolationEnabled: true,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });

    const runPromise = executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work' });
    await flushAsync();
    await runPromise;
    expect(removeDirCalls).toEqual([]);

    child.emit('close', 0, null);
    await lifecycle.waitForTerminal(run.id);

    const stagedDir = `/fake/tmp/${mkdtempCalls[0]}`;
    expect(removeDirCalls).toEqual([stagedDir]);
  });

  it('sanitizes a path-like run id out of the mkdtemp prefix', async () => {
    const { claudeConfigDirIsolation, mkdtempCalls } = createClaudeConfigDirFsSpies();
    const def = createFakeDef({ id: 'claude' });
    const { lifecycle, executor } = createHarness({
      def,
      claudeConfigDirIsolation,
      claudeConfigDirIsolationEnabled: true,
    });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1', runId: '../../etc/evil' });
    await executor.run({ runId: run.id, agentId: 'claude', prompt: 'hi', cwd: '/work' });

    expect(mkdtempCalls[0]).not.toContain('..');
    expect(mkdtempCalls[0]).not.toContain('/');
  });

  // Independence proof for the assistant's default Local CLI runtime (2026-09-08): the tool
  // restriction (AgentExecutorRunInput.disallowedTools, Finding 2) and CLAUDE_CONFIG_DIR isolation
  // (Finding 1, gated by claudeConfigDirIsolationEnabled above) are two unrelated mechanisms —
  // disallowedTools flows through buildAgentBuildArgsOptions into the def's own buildArgs/argv,
  // while isolation flows through prepareClaudeConfigDirIfNeeded into the spawned env. Nothing in
  // either path reads the other's flag. This run exercises both in one real `.run()` call, with
  // isolation left at its default (disabled), to prove the host's own tool restriction is not
  // collateral damage of the 2026-09-08 default-off rollback.
  it('still applies disallowedTools to a "claude"-id def\'s argv when CLAUDE_CONFIG_DIR isolation is left at its default (disabled)', async () => {
    const { claudeConfigDirIsolation, mkdtempCalls } = createClaudeConfigDirFsSpies();
    const def = createFakeDef({
      id: 'claude',
      // Mirrors @jini-ai/agent-runtime's real claude.ts buildArgs handling of
      // RuntimeBuildOptions.disallowedTools (see that file's own '--disallowedTools' push) closely
      // enough to prove this driver forwards the value through to argv — createFakeDef's own
      // default buildArgs ignores its options entirely, which would prove nothing here.
      buildArgs: (_prompt, _imagePaths, _extraAllowedDirs, options?: RuntimeBuildOptions) =>
        options?.disallowedTools && options.disallowedTools.length > 0
          ? ['--disallowedTools', ...options.disallowedTools]
          : ['--flag'],
    });
    const { lifecycle, executor, spawnCalls } = createHarness({ def, claudeConfigDirIsolation });
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({
      runId: run.id,
      agentId: 'claude',
      prompt: 'hi',
      cwd: '/work',
      disallowedTools: ['Bash', 'Edit', 'Write'],
    });

    // Isolation stayed off (the default) ...
    expect(mkdtempCalls).toEqual([]);
    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    // ... yet the tool restriction still reached the spawned CLI's own argv.
    expect(spawnCalls[0]!.args).toEqual(['--disallowedTools', 'Bash', 'Edit', 'Write']);
  });
});

describe('AgentExecutor — SEC-001 deny-by-default subprocess environment', () => {
  const SENTINEL_KEY = 'JINI_TEST_SECRET_TOKEN';

  it('never forwards arbitrary host env vars (a daemon secret) to the spawned agent by default', async () => {
    vi.stubEnv(SENTINEL_KEY, 'should-never-appear');
    vi.stubEnv('DATABASE_URL', 'postgres://should-never-appear');
    try {
      const { lifecycle, executor, spawnCalls } = createHarness();
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

      expect(spawnCalls).toHaveLength(1);
      const env = spawnCalls[0]!.options.env as Record<string, string>;
      expect(env[SENTINEL_KEY]).toBeUndefined();
      expect(env.DATABASE_URL).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('still forwards the baseline allowlist (PATH/HOME/locale) so the spawned agent can actually run', async () => {
    vi.stubEnv('PATH', '/usr/bin:/bin');
    vi.stubEnv('HOME', '/home/test-user');
    vi.stubEnv('LANG', 'en_US.UTF-8');
    try {
      const { lifecycle, executor, spawnCalls } = createHarness();
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

      const env = spawnCalls[0]!.options.env as Record<string, string>;
      expect(env.PATH).toBe('/usr/bin:/bin');
      expect(env.HOME).toBe('/home/test-user');
      expect(env.LANG).toBe('en_US.UTF-8');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('forwards USER — a spawned `claude` CLI cannot find its own login state without it, even with HOME present (see tovu-learnings.md §9)', async () => {
    vi.stubEnv('USER', 'test-user');
    try {
      const { lifecycle, executor, spawnCalls } = createHarness();
      const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
      await executor.run({ runId: run.id, agentId: 'fake-agent', prompt: 'hi', cwd: '/work' });

      const env = spawnCalls[0]!.options.env as Record<string, string>;
      expect(env.USER).toBe('test-user');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('delegates a run-specific credential via credentialEnv even though it is absent from process.env', async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const { lifecycle, executor, spawnCalls } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'hi',
      cwd: '/work',
      credentialEnv: { ANTHROPIC_API_KEY: 'sk-test-explicit' },
    });

    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-explicit');
  });

  it('the explicit input.env escape hatch still bypasses the allowlist entirely (advanced-caller path)', async () => {
    const { lifecycle, executor, spawnCalls } = createHarness();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1' });
    await executor.run({
      runId: run.id,
      agentId: 'fake-agent',
      prompt: 'hi',
      cwd: '/work',
      env: { PATH: '/custom/bin', CUSTOM_UNALLOWLISTED_VAR: 'present-because-caller-opted-in' },
    });

    const env = spawnCalls[0]!.options.env as Record<string, string>;
    expect(env.CUSTOM_UNALLOWLISTED_VAR).toBe('present-because-caller-opted-in');
  });
});

describe('isAgentExecutorSupported / assessAgentExecutorCompatibility', () => {
  const defOf = (id: string): RuntimeAgentDef => {
    const def = getAgentDef(id);
    if (!def) throw new Error(`test setup: no def registered for "${id}"`);
    return def;
  };

  it('accepts the JSON-stream and ACP families', () => {
    expect(isAgentExecutorSupported(defOf('claude'))).toBe(true);
    expect(isAgentExecutorSupported(defOf('codex'))).toBe(true);
  });

  // THE regression guard for this predicate. `aider` and `deepseek` are `streamFormat: 'plain'` with
  // neither `promptViaStdin` nor `promptViaFile` — they qualify solely via `maxPromptArgBytes`. That
  // field is one of the ones `DetectedAgent` omits, so a predicate written against the projected
  // discovery type instead of the full def would silently drop two working agents from every
  // consumer's picker while fixing one broken one.
  it.each(['aider', 'deepseek'])('accepts the argv-bound def %s (qualifies only via maxPromptArgBytes)', (id) => {
    const def = defOf(id);
    expect(def.promptViaStdin).not.toBe(true);
    expect(def.promptViaFile).not.toBe(true);
    expect(typeof def.maxPromptArgBytes).toBe('number');
    expect(isAgentExecutorSupported(def)).toBe(true);
  });

  // Antigravity was the one registered def this predicate rejected. It is now
  // accepted, and its two former blockers are met by def fields the driver
  // reads generically — asserted here from the *real registry def*, not a fake,
  // so the def and the driver cannot drift apart silently. It no longer
  // declares `runtimeLock`: that was the settings.json-write mutex, retired
  // once `agy` gained a real `--model` flag (see `defs/antigravity.ts`'s own
  // doc) — `isAgentExecutorSupported` never required it in the first place.
  it('accepts the real antigravity def, which declares both spawn-orchestration fields it still needs', () => {
    const def = defOf('antigravity');
    expect(def.needsAgentLogFile).toBe(true);
    expect(def.stdoutPolicy?.buffering).toBe('until-close');
    expect(def.stdoutPolicy?.buffering === 'until-close' && typeof def.stdoutPolicy.sanitize).toBe('function');
    expect(def.runtimeLock).toBeUndefined();
    expect(isAgentExecutorSupported(def)).toBe(true);
  });

  // All 24 registered defs are now driveable. A def added later that this
  // driver cannot actually run should fail *here*, at the point someone can
  // still decide what to do about it, rather than at a user's first run.
  it('accepts every one of the 24 registered defs', () => {
    const rejected = AGENT_DEFS.filter((def) => !isAgentExecutorSupported(def)).map((def) => def.id);
    expect(rejected).toEqual([]);
    expect(AGENT_DEFS).toHaveLength(24);
  });

  // The three new fields must stay opt-in: exactly one def declares them, and
  // the other 23 keep their pre-existing behavior by declaring none.
  it('leaves the other 23 defs — including the 4 other plain-format ones — declaring none of the three new fields', () => {
    const withNewFields = AGENT_DEFS.filter(
      (def) => def.needsAgentLogFile !== undefined || def.stdoutPolicy !== undefined || def.runtimeLock !== undefined,
    ).map((def) => def.id);
    expect(withNewFields).toEqual(['antigravity']);

    for (const id of ['grok-build', 'aider', 'deepseek', 'qwen']) {
      const def = defOf(id);
      expect(def.streamFormat).toBe('plain');
      // No `stdoutPolicy` at all — so `wireChildLifecycle` takes the live path,
      // byte-for-byte as before this feature existed.
      expect(def.stdoutPolicy).toBeUndefined();
      expect(def.needsAgentLogFile).toBeUndefined();
      expect(def.runtimeLock).toBeUndefined();
    }
  });

  it('rejects an unrecognized streamFormat', () => {
    const result = assessAgentExecutorCompatibility({
      ...defOf('claude'),
      streamFormat: 'some-future-format',
    } as RuntimeAgentDef);
    expect(result.supported).toBe(false);
    expect(result.supported === false && result.reason).toContain('not implemented in v1');
  });

  it('rejects a def with no viable prompt-delivery path', () => {
    // The key is omitted rather than set to `undefined`: `maxPromptArgBytes` is an optional `number`,
    // and the predicate's check is `typeof def.maxPromptArgBytes !== 'number'`, so absence — not an
    // explicit undefined — is the state under test.
    const { maxPromptArgBytes: _argvBudget, ...withoutArgvBudget } = defOf('aider');
    const result = assessAgentExecutorCompatibility({
      ...withoutArgvBudget,
      promptViaStdin: false,
      promptViaFile: false,
    });
    expect(result.supported).toBe(false);
    expect(result.supported === false && result.reason).toContain('prompt delivery path');
  });

  it('returns the narrowed streamFormat on success', () => {
    const result = assessAgentExecutorCompatibility(defOf('claude'));
    expect(result.supported === true && result.streamFormat).toBe(defOf('claude').streamFormat);
  });

  // The anti-drift guarantee. The predicate exists to answer, at discovery time, exactly what `run()`
  // would decide — so the two must agree on every def in the real registry, not just the ones someone
  // remembered to write a case for. A new def added to `AGENT_DEFS` is covered automatically.
  it('agrees with run() for every def in AGENT_DEFS', async () => {
    expect(AGENT_DEFS.length).toBeGreaterThan(20);
    for (const def of AGENT_DEFS) {
      const predicted = isAgentExecutorSupported(def);
      const { lifecycle, executor } = createHarness({ def });
      const { run } = await lifecycle.start({ contextRef: `ctx-${def.id}` });
      let rejectedAsUnsupported = false;
      try {
        await executor.run({ runId: run.id, agentId: def.id, prompt: 'hi', cwd: '/work' });
      } catch (error) {
        rejectedAsUnsupported =
          error instanceof AgentExecutorError && error.code === 'AGENT_RUNTIME_UNSUPPORTED';
      }
      expect(rejectedAsUnsupported, `${def.id}: predicate said supported=${predicted}`).toBe(!predicted);
    }
  });
});

// ---------------------------------------------------------------------------
// System-prompt overlay — ACTUAL DELIVERY through every prompt transport.
//
// WHAT THE `resolveSystemPromptOverlayDelivery` BLOCK ABOVE COVERS, AND WHY IT
// IS NOT ENOUGH. That block tests the pure resolver in isolation: given a def's
// declared strategy, what does the function RETURN. Its registry-wide
// "no def is silently dropped" case is a necessary invariant but a VACUOUS
// proof of delivery — a def with no declared strategy always falls through to
// the universal prompt prefix, so `delivery.prompt !== prompt` is
// unconditionally true for it, and that assertion would keep passing with
// `writePromptToStdin` deleted outright. It measures what the resolver
// returns, never what the child process receives.
//
// WHAT THIS BLOCK COVERS. The other half: whether the overlay reaches the bytes
// the child actually gets, on each of the four channels `run()` can use to
// carry a prompt —
//   1. stdin                (`writePromptToStdin`)   e.g. qwen, codex
//   2. the ACP session      (`runAcpDispatch`)       e.g. kimi, kiro
//   3. the pi-rpc session   (`runPiRpcDispatch`)     pi
//   4. a staged prompt file (`stagePromptFile`)      grok-build
// — and, just as importantly, that it reaches EXACTLY ONE of them per def, so a
// def already served by `--append-system-prompt`, an env var, or a config file
// never also gets it inline. Every case drives a REAL registry def through the
// real `run()`; only the process, the transports, and the staging are faked.
// ---------------------------------------------------------------------------

const OVERLAY_TEXT = 'HOUSE-RULES-OVERLAY: always call the credential tool before curl.';
const OVERLAY_USER_PROMPT = 'summarize the repo';

/** A `PromptAugmenter` whose only job is to return `OVERLAY_TEXT` from `systemOverlay()`. */
function createOverlayAugmenter(overlay: string | null = OVERLAY_TEXT): PromptAugmenter {
  return {
    contextKinds: () => [],
    augmentUserRequest: ({ basePrompt }) => basePrompt,
    systemOverlay: () => overlay,
  };
}

/** Every channel a prompt (and therefore an overlay) can actually reach the child on, captured from one real `run()`. */
interface OverlayDeliveryProbe {
  /** argv as handed to `spawn` — carries `--append-system-prompt` / `--message` / `-p` style delivery. */
  readonly argv: readonly string[];
  /** The spawn env — carries `'env-var'` delivery (reasonix) and `'config-instructions-file'` content (opencode). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Everything written to the child's stdin, concatenated. */
  readonly stdin: string;
  /** The prompt string handed to `attachAcpSession`, or `undefined` for a non-ACP def. */
  readonly acpPrompt: string | undefined;
  /** The prompt string handed to `attachPiRpcSession`, or `undefined` for a non-pi-rpc def. */
  readonly piRpcPrompt: string | undefined;
  /** The bytes `stagePromptFile` wrote, or `undefined` for a def without `promptViaFile`. */
  readonly promptFile: string | undefined;
  /**
   * The bytes `prepareSystemPromptOverlayFileIfNeeded` staged for a `'config-instructions-file'`
   * def (opencode), read back through the very path its env var advertises — the fifth and last
   * channel an overlay can reach a CLI on. Read via the env var rather than by intercepting the
   * stager so the assertion covers the whole chain (stage the file, merge its path into the config
   * document, hand that document to the child), not just the write.
   */
  readonly configInstructionsFile: string | undefined;
}

/**
 * Drives one REAL registry def through the real `run()` with a `promptAugmenter` configured, and
 * returns every channel the prompt could have travelled on. No real subprocess, no real ACP/pi-rpc
 * handshake, and no real disk: the prompt-file and log-file stagers are faked so a `promptViaFile`
 * def's staged bytes can be read back without touching `os.tmpdir()`.
 *
 * @param def - A def from the live registry, passed verbatim. Deliberately not a `createFakeDef`
 * replica: the whole class of bug this block guards against is a real def's `buildArgs` discarding
 * its prompt argument, which a fake with a hand-written `buildArgs` cannot reproduce.
 * @complexity O(1) per call — one fake spawn, no I/O.
 */
async function probeOverlayDelivery(
  def: RuntimeAgentDef,
  options: { readonly overlay?: string | null; readonly resumeSessionId?: string } = {},
): Promise<OverlayDeliveryProbe> {
  const eventLog = createInMemoryEventLog();
  const lifecycle = createRunLifecycle({ eventLog });
  const child = createFakeChild(7100);
  const spawnCalls: SpawnCall[] = [];
  let acpPrompt: string | undefined;
  let piRpcPrompt: string | undefined;
  let promptFile: string | undefined;

  const fakeSpawn = ((command: string, args: readonly string[], spawnOptions: unknown) => {
    spawnCalls.push({ command, args: [...args], options: spawnOptions as SpawnCall['options'] });
    queueMicrotask(() => child.emit('spawn'));
    return child as unknown as ChildProcess;
  }) as unknown as typeof nodeSpawn;

  const executor = createAgentExecutor({
    lifecycle,
    getAgentDef: (id: string) => (def.id === id ? def : null),
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
    promptAugmenter: createOverlayAugmenter(options.overlay === undefined ? OVERLAY_TEXT : options.overlay),
    preparePromptFileForAgent: (async (promptFileDef: RuntimeAgentDef | null | undefined, prompt: string) => {
      if (!promptFileDef?.promptViaFile) return null;
      promptFile = prompt;
      return { path: '/fake/staged/prompt.md', cleanup: async () => {} };
    }) as unknown as typeof preparePromptFileForAgent,
    prepareAgentLogFile: (async (logFileDef: RuntimeAgentDef | null | undefined) =>
      logFileDef?.needsAgentLogFile
        ? { path: '/fake/staged/agent.log', cleanup: async () => {} }
        : null) as unknown as typeof prepareAgentLogFile,
    attachAcpSession: ((attachOptions: { prompt: string }) => {
      acpPrompt = attachOptions.prompt;
      return {
        hasFatalError: () => false,
        getDurableSessionId: () => null,
        completedSuccessfully: () => true,
        abort: vi.fn(),
      } as AcpSessionController;
    }) as unknown as typeof attachAcpSession,
    attachPiRpcSession: ((attachOptions: { prompt: string }) => {
      piRpcPrompt = attachOptions.prompt;
      return { hasFatalError: () => false, getLastSessionPath: () => null, abort: vi.fn() } as PiRpcSession;
    }) as unknown as typeof attachPiRpcSession,
    listProcessSnapshots: async () => [{ pid: child.pid ?? 0, ppid: 1, command: 'fake-bin' }],
    stopProcesses: async () => ({ alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }),
    onCleanupFailure: vi.fn(),
  });

  const { run } = await lifecycle.start({ contextRef: `ctx-overlay-${def.id}` });
  const runPromise = executor.run({
    runId: run.id,
    agentId: def.id,
    prompt: OVERLAY_USER_PROMPT,
    cwd: '/work',
    ...(options.resumeSessionId !== undefined ? { resumeSessionId: options.resumeSessionId } : {}),
  });
  await flushAsync();
  await runPromise;

  const env = (spawnCalls[0]?.options.env ?? {}) as Record<string, string | undefined>;

  return {
    argv: spawnCalls[0]?.args ?? [],
    env,
    stdin: (child.stdin?.writes ?? []).join(''),
    acpPrompt,
    piRpcPrompt,
    promptFile,
    configInstructionsFile: await readConfigInstructionsFile(def, env),
  };
}

/**
 * Reads back the overlay file a `'config-instructions-file'` def's spawn env points at, then removes
 * it. The real stager is not injectable, so this is genuine disk I/O; the run's own cleanup only
 * fires when the child closes, which this probe deliberately never does, so the file is still there
 * and would otherwise leak a temp directory per probed def.
 *
 * @returns The staged overlay text, or `undefined` for any def not using that strategy.
 */
async function readConfigInstructionsFile(
  def: RuntimeAgentDef,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | undefined> {
  const delivery = def.systemPromptDelivery;
  if (delivery?.strategy !== 'config-instructions-file') return undefined;
  const raw = env[delivery.varName];
  if (raw === undefined) return undefined;
  const parsed: unknown = JSON.parse(raw);
  const instructions = isStringArray((parsed as { instructions?: unknown }).instructions)
    ? (parsed as { instructions: string[] }).instructions
    : [];
  const filePath = instructions.at(-1);
  if (filePath === undefined) return undefined;
  const content = await fs.readFile(filePath, 'utf8');
  await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  return content;
}

/** Narrow an unknown JSON field to `string[]`. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** How many times `OVERLAY_TEXT` appears in `haystack`; `indexOf`-based, so an overlapping match is impossible. */
function countOverlayOccurrences(haystack: string | undefined): number {
  if (haystack === undefined) return 0;
  let count = 0;
  let from = 0;
  for (let at = haystack.indexOf(OVERLAY_TEXT, from); at !== -1; at = haystack.indexOf(OVERLAY_TEXT, from)) {
    count += 1;
    from = at + OVERLAY_TEXT.length;
  }
  return count;
}

/**
 * Total overlay copies across EVERY channel of one probe — the single number the no-double-delivery
 * invariant is stated in. argv is joined with a space so an overlay split across two adjacent argv
 * tokens can never be miscounted as one delivery.
 */
function totalOverlayDeliveries(probe: OverlayDeliveryProbe): number {
  const envValues = Object.values(probe.env).filter((value): value is string => typeof value === 'string');
  return (
    countOverlayOccurrences(probe.argv.join(' ')) +
    countOverlayOccurrences(envValues.join(' ')) +
    countOverlayOccurrences(probe.stdin) +
    countOverlayOccurrences(probe.acpPrompt) +
    countOverlayOccurrences(probe.piRpcPrompt) +
    countOverlayOccurrences(probe.promptFile) +
    countOverlayOccurrences(probe.configInstructionsFile)
  );
}

/** Looks a def up in the live registry, failing loudly rather than silently testing a fake. */
function registryDef(id: string): RuntimeAgentDef {
  const def = getAgentDef(id);
  if (!def) throw new Error(`test setup: no def registered for "${id}"`);
  return def;
}

describe('AgentExecutor — system-prompt overlay reaches the bytes each transport actually sends', () => {
  // Transport 1 of 4: stdin. These 8 defs' `buildArgs` declares `_prompt` and discards it, so argv can
  // never carry the overlay for them; the stdin write is the only channel there is.
  it.each(['amp', 'codebuddy', 'codex', 'copilot', 'cursor-agent', 'mimo', 'qoder', 'qwen'])(
    'stdin transport (%s): the overlay is in the bytes written to the child stdin, ahead of the user prompt',
    async (id) => {
      const probe = await probeOverlayDelivery(registryDef(id));

      expect(probe.stdin).toContain(OVERLAY_TEXT);
      expect(probe.stdin).toContain(OVERLAY_USER_PROMPT);
      expect(probe.stdin.indexOf(OVERLAY_TEXT)).toBeLessThan(probe.stdin.indexOf(OVERLAY_USER_PROMPT));
      expect(totalOverlayDeliveries(probe)).toBe(1);
    },
  );

  // Transport 2 of 4: the ACP JSON-RPC session. `runAcpDispatch` hands `attachAcpSession` its own
  // prompt string; these 8 defs' `buildArgs` returns a bare `['acp']` with no prompt argv at all.
  it.each(['amr', 'devin', 'hermes', 'kilo', 'kimi', 'kiro', 'trae-cli', 'vibe'])(
    'ACP transport (%s): the overlay is in the prompt handed to attachAcpSession',
    async (id) => {
      const probe = await probeOverlayDelivery(registryDef(id));

      expect(probe.acpPrompt).toContain(OVERLAY_TEXT);
      expect(probe.acpPrompt).toContain(OVERLAY_USER_PROMPT);
      expect(probe.acpPrompt!.indexOf(OVERLAY_TEXT)).toBeLessThan(probe.acpPrompt!.indexOf(OVERLAY_USER_PROMPT));
      expect(totalOverlayDeliveries(probe)).toBe(1);
    },
  );

  // Transport 3 of 4: a staged prompt file. grok-build's `buildArgs` passes only the PATH
  // (`--prompt-file <path>`), so the overlay has to be in the staged bytes or it is nowhere.
  it('prompt-file transport (grok-build): the overlay is in the staged file bytes, and only the path reaches argv', async () => {
    const probe = await probeOverlayDelivery(registryDef('grok-build'));

    expect(probe.promptFile).toContain(OVERLAY_TEXT);
    expect(probe.promptFile).toContain(OVERLAY_USER_PROMPT);
    expect(probe.argv).toContain('--prompt-file');
    expect(probe.argv).toContain('/fake/staged/prompt.md');
    // grok-build declares `promptViaStdin: false`. stdin is still written and closed (this driver
    // always spawns with piped stdio and the CLI needs the EOF), but it must NOT carry a second
    // copy of the overlay on top of the staged file's.
    expect(probe.stdin).not.toContain(OVERLAY_TEXT);
    expect(totalOverlayDeliveries(probe)).toBe(1);
  });

  // Transport 4 of 4: pi-rpc. pi declares `'append-flag'`, so this doubles as a control — the
  // overlay must ride argv and the RPC prompt must stay clean.
  it('pi-rpc transport (pi): declares append-flag, so the overlay rides argv and the RPC prompt stays clean', async () => {
    const probe = await probeOverlayDelivery(registryDef('pi'));

    expect(probe.argv).toContain('--append-system-prompt');
    expect(probe.argv).toContain(OVERLAY_TEXT);
    expect(probe.piRpcPrompt).toBe(OVERLAY_USER_PROMPT);
    expect(totalOverlayDeliveries(probe)).toBe(1);
  });

  // ---- No-double-delivery controls: defs that ALREADY worked before this fix. Each has a real,
  // non-prompt delivery channel; every assertion below exists to prove that threading the decision
  // out to the prompt transports did not ALSO start prefixing their prompt text.

  it('no double delivery (aider): the overlay rides the --message argv exactly once, and stdin does not repeat it', async () => {
    const probe = await probeOverlayDelivery(registryDef('aider'));

    const messageIndex = probe.argv.indexOf('--message');
    expect(messageIndex).toBeGreaterThanOrEqual(0);
    const messageValue = probe.argv[messageIndex + 1]!;
    expect(messageValue).toContain(OVERLAY_TEXT);
    expect(messageValue).toContain(OVERLAY_USER_PROMPT);
    expect(countOverlayOccurrences(messageValue)).toBe(1);
    // aider does not declare `promptViaStdin`: its prompt is argv-bound, so the stdin write this
    // driver always performs must stay overlay-free.
    expect(probe.stdin).not.toContain(OVERLAY_TEXT);
    expect(totalOverlayDeliveries(probe)).toBe(1);
  });

  it('no double delivery (claude): the append-flag argv carries the overlay and the stdin prompt stays clean', async () => {
    const probe = await probeOverlayDelivery(registryDef('claude'));

    expect(probe.argv).toContain('--append-system-prompt');
    expect(probe.argv).toContain(OVERLAY_TEXT);
    expect(probe.stdin).not.toContain(OVERLAY_TEXT);
    expect(probe.stdin).toContain(OVERLAY_USER_PROMPT);
    expect(totalOverlayDeliveries(probe)).toBe(1);
  });

  it('no double delivery (reasonix): the env-var strategy carries the overlay and the ACP prompt stays clean', async () => {
    const probe = await probeOverlayDelivery(registryDef('reasonix'));

    expect(Object.values(probe.env)).toContain(OVERLAY_TEXT);
    expect(probe.acpPrompt).toBe(OVERLAY_USER_PROMPT);
    expect(totalOverlayDeliveries(probe)).toBe(1);
  });

  it('no double delivery (opencode): the staged config-instructions file carries the overlay and the stdin prompt stays clean', async () => {
    const probe = await probeOverlayDelivery(registryDef('opencode'));

    expect(probe.configInstructionsFile).toBe(OVERLAY_TEXT);
    expect(probe.stdin).not.toContain(OVERLAY_TEXT);
    expect(probe.stdin).toContain(OVERLAY_USER_PROMPT);
    expect(totalOverlayDeliveries(probe)).toBe(1);
  });

  it('no overlay configured: nothing is prefixed anywhere, byte-identical to no promptAugmenter at all', async () => {
    const probe = await probeOverlayDelivery(registryDef('qwen'), { overlay: null });

    expect(probe.stdin).toBe(OVERLAY_USER_PROMPT);
    expect(totalOverlayDeliveries(probe)).toBe(0);
  });

  // THE registry-wide delivery guard, and the one this task exists to establish. Unlike the pure
  // resolver's own registry loop above, this drives every registered def through the real `run()`
  // and looks at the channels a child process would actually read. `toBe(1)` — not
  // `toBeGreaterThan(0)` — so one assertion catches both failure directions at once: a def that
  // receives no overlay (the bug this fixes) and a def that receives two (the hazard that threading
  // one decision through four transports introduces).
  it('every registered def receives the overlay on exactly one real channel, never zero and never twice', async () => {
    for (const def of AGENT_DEFS) {
      const probe = await probeOverlayDelivery(def);
      expect(totalOverlayDeliveries(probe), `def "${def.id}" (streamFormat ${def.streamFormat})`).toBe(1);
    }
  });

  // The deliberate exception documented on `resolveSystemPromptOverlayDelivery`'s fallback branch:
  // a resume-capable def continuing an EXISTING session must not be re-prefixed, or the overlay
  // compounds in that CLI's own persisted history turn after turn. Asserted here through the real
  // transport rather than the resolver, because the transport is where the compounding would
  // actually happen.
  it('a resume-capable fallback def continuing an existing session is not re-prefixed on any channel', async () => {
    const codex = registryDef('codex');
    expect(codex.resumesSessionViaCli === true || codex.resumesSessionViaAcpLoad === true).toBe(true);

    const probe = await probeOverlayDelivery(codex, { resumeSessionId: 'sess-existing-1' });

    expect(probe.stdin).not.toContain(OVERLAY_TEXT);
    expect(totalOverlayDeliveries(probe)).toBe(0);
  });
});

