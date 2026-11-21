import { createModelReceiptTracker } from './model-receipts.js';
import { observeRunOutput } from './run-output.js';
import { createRunEventQueue, receivedJournalEntry, attachMessageRelay } from './event-io.js';
import { cleanupStagedFilesSafely, classifyFailureSafely, terminateChildTreeBestEffort, reportPostCloseFailure } from './event-cleanup.js';
import { translateAgentRuntimeEvent, applyAgentTranslationSideEffects, translateAcpError } from './event-translation.js';
import { errorMessage } from './values.js';
import type { ChildProcess } from 'node:child_process';
import type { ModelCatalogSnapshot } from '@jini-ai/core/contracts/agents';
import type { RunLifecycle } from '../run-lifecycle.js';
import type { RunByteJournal } from '../continuation/journal.js';
import type { RunMessageRelay } from './message-relay.js';
import type { TerminateChildTreeDeps, AgentCleanupFailureContext, ClassifyFailure,
  CreateAgentExecutorOptions, FailBeforeSpawn, McpBridgeDelivery } from './contracts.js';

interface WireAcpLifecycleContext extends TerminateChildTreeDeps {
  readonly registerMessageRelay?: (relay: RunMessageRelay) => void;
  readonly runId: string;
  readonly agentId: string;
  readonly child: ChildProcess;
  readonly lifecycle: RunLifecycle;
  readonly prompt: string;
  readonly cwd: string;
  readonly permissionMode: 'bypass' | 'restricted' | undefined;
  readonly cliParity?: boolean | undefined;
  readonly model: string | undefined;
  readonly resumeSessionId?: string | null | undefined;
  readonly resumesViaAcpLoad?: boolean | undefined;
  readonly effort?: string | undefined;
  readonly modelCatalog?: ModelCatalogSnapshot;
  readonly imagePaths: readonly string[];
  readonly envFormat: 'array' | 'map' | undefined;
  /**
   * The `'acp-merge'` delivery mechanism's entire surface: `mcpServers` for this run's `session/new`
   * params. Set for every def declaring `externalMcpInjection: 'acp-merge'` when the host configured
   * MCP injection; `undefined` otherwise, which reproduces having no MCP servers at all.
   *
   * **Fixed here, once, for all 8 ACP-native defs.** `attachAcpSession` has always accepted
   * `mcpServers`; the gap was that this wrapper never passed any, so declaring the strategy bought a
   * def nothing. Because the gap was in this shared function rather than in the defs, closing it
   * required no per-def change and automatically covers a 9th def that declares `'acp-merge'` later.
   * Each entry's `env` stays a plain object — `buildAcpSessionNewParams` converts it to the array or
   * map wire shape per `envFormat`, so the per-vendor difference stays in the one module that owns it.
   */
  readonly mcpServers: Extract<McpBridgeDelivery, { kind: 'acp-merge' }>['mcpServers'] | undefined;
  readonly onPermissionRequest: NonNullable<CreateAgentExecutorOptions['acpPermissionHandler']> | undefined;
  readonly attachAcpSession: NonNullable<CreateAgentExecutorOptions['attachAcpSession']>;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /** Same seam as `WireChildLifecycleContext.cleanupStagedFiles` — no current ACP def declares `promptViaFile` or `needsAgentLogFile`, so this is always the no-op default in practice today, threaded through for consistency rather than special-cased away. */
  readonly cleanupStagedFiles: () => Promise<void>;
  /** Gap 1's byte-journal (see `continuation/journal.ts`). Covers this wrapper's own raw stdout/stderr forwarding only — the actual ACP prompt delivery happens inside `attachAcpSession`'s own transport, out of this module's direct view, so sent bytes are not journaled on this path (an honestly-scoped v1 gap, not an oversight). */
  readonly journal: RunByteJournal | undefined;
  /** Gap 4's failure classifier — see `ClassifyFailure`'s own doc. `undefined` means every `'failed'` outcome stays `resumable: false`. */
  readonly classifyFailure: ClassifyFailure | undefined;
}

function acpRepairOptions({ ctx, state }: { ctx: WireAcpLifecycleContext; state: { descendantPids: number[] } }) {
  return { ...(ctx.resumesViaAcpLoad && ctx.resumeSessionId ? { resumeSessionId: ctx.resumeSessionId } : {}),
    ...(ctx.effort ? { effort: ctx.effort } : {}),
    beforeRelease: () => recordDescendants({ ctx, state }) };
}

/** Preserve ACP's distinction between absent fields and explicitly supplied empty values. */
function acpSessionOptions({ ctx, state }: { ctx: WireAcpLifecycleContext; state: { descendantPids: number[] } }, _options = {}): Parameters<NonNullable<CreateAgentExecutorOptions['attachAcpSession']>>[1] {
  return {
    cwd: ctx.cwd,
    ...(ctx.cliParity ? { cliParity: true, stageTimeoutMs: 0 } : {}),
    ...(ctx.permissionMode !== undefined ? { permissionMode: ctx.permissionMode } : {}),
    ...(ctx.model !== undefined ? { model: ctx.model } : {}),
    ...(ctx.imagePaths.length > 0 ? { imagePaths: [...ctx.imagePaths] } : {}),
    ...(ctx.envFormat !== undefined ? { envFormat: ctx.envFormat } : {}),
    // Spread-when-present rather than always: passing `mcpServers: []` is not the same as passing
    // nothing for every downstream ACP agent, and "no bridge configured" must stay byte-identical
    // to before this field existed.
    ...(ctx.mcpServers !== undefined && ctx.mcpServers.length > 0 ? { mcpServers: [...ctx.mcpServers] } : {}),
    ...(ctx.onPermissionRequest !== undefined ? { onPermissionRequest: ctx.onPermissionRequest } : {}),
    ...acpRepairOptions({ ctx, state }),
  };
}

/**
 * Wires an ACP child to a run. Unlike the JSON-stream path, ACP owns the
 * prompt protocol and reports its parsed events through `attachAcpSession`'s
 * callback. This wrapper retains raw stdout/stderr for diagnostics, preserves
 * event order through the same FIFO discipline, forwards cancellation both as
 * ACP `session/cancel` and an OS process-tree stop, and uses the controller's
 * clean-prompt signal rather than SIGTERM (expected ACP cleanup) to determine
 * success.
 */
function wireAcpLifecycle(ctx: WireAcpLifecycleContext): ReturnType<WireAcpLifecycleContext['attachAcpSession']> {
  const modelReceipt = createModelReceiptTracker({}, { startingModel: ctx.model, models: ctx.modelCatalog?.models });
  const { runId, agentId, child, lifecycle, journal } = ctx;
  const output = observeRunOutput({ lifecycle, runId, agentName: agentId });
  const state = {
    cancelRequested: false,
    descendantPids: [] as number[],
    // Gap 5 (session resume) — see wireChildLifecycle's identical local for the full rationale.
    capturedSessionId: undefined as string | undefined,
    // Real `FailureClassificationContext.sideEffects` signals — see that interface's own doc.
    userVisibleOutputSeen: false, toolCallSeen: false,
  };
  const { enqueueEmit, getTail } = createRunEventQueue({});
  attachMessageRelay({ register: ctx.registerMessageRelay, child,
    emit: data => enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data } })),
  });

  if (ctx.model) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'status', label: 'starting_model', model: ctx.model! } } }));

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: receivedJournalEntry('stdout', text) }));
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'stdout', data: { chunk: text } } }));
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: receivedJournalEntry('stderr', text) }));
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'stderr', data: { chunk: text } } }));
  });
  child.stdin?.on('error', () => {});
  child.on('error', () => {});

  let controller: ReturnType<WireAcpLifecycleContext['attachAcpSession']> | null = null;
  const unsubscribeCancel = lifecycle.onCancelRequested({ runId: runId, listener: () => {
    state.cancelRequested = true;
    controller?.abort();
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  } });

  child.on('close', (code, signal) => {
    void finishAcpOnClose({ ctx, state, getTail, unsubscribeCancel, output, code, signal,
      getController: () => controller });
  });

  controller = ctx.attachAcpSession({ child, prompt: ctx.prompt,
    send: createAcpEventSender({ ctx, state, modelReceipt, enqueueEmit }) }, acpSessionOptions({ ctx, state }, {}));
  return controller;
}

async function finishAcpOnClose({ ctx, state, getTail, unsubscribeCancel, output, code, signal, getController }: {
  ctx: WireAcpLifecycleContext;
  state: { cancelRequested: boolean; capturedSessionId: string | undefined; userVisibleOutputSeen: boolean; toolCallSeen: boolean; descendantPids: number[] };
  getTail: ReturnType<typeof createRunEventQueue>['getTail']; unsubscribeCancel: () => void;
  output: ReturnType<typeof observeRunOutput>; code: number | null; signal: NodeJS.Signals | null;
  getController: () => ReturnType<WireAcpLifecycleContext['attachAcpSession']> | null;
}, _options = {}): Promise<void> {
  const { runId, agentId, lifecycle, classifyFailure } = ctx;
  await getTail();
  unsubscribeCancel();
  await stopRecordedDescendants({ ctx, state });
  // Guarded for the same reasons as the child-driven handler above.
  await cleanupStagedFilesSafely(ctx);
  let finalStatus: 'cancelled' | 'succeeded' | 'failed' = 'cancelled';
  if (!state.cancelRequested) finalStatus = getController()?.completedSuccessfully() ? 'succeeded' : 'failed';
  const status = await output.settle({ status: finalStatus });
  const resumable =
    status === 'failed' && classifyFailure !== undefined
      ? await classifyFailureSafely({ ctx, classifyFailure, context: {
          runId,
          agentId,
          code,
          signal: signal ?? null,
          sideEffects: { userVisibleOutputSeen: state.userVisibleOutputSeen, toolCallSeen: state.toolCallSeen },
        } })
      : false;
  const sessionRef = acpSessionRef({ ctx, state, controller: getController() });
  await lifecycle.finish({ runId, status, code, signal: signal ?? null, resumable }, { ...(sessionRef !== undefined ? { sessionRef } : {}) });
}

async function recordDescendants({ ctx, state }: { ctx: WireAcpLifecycleContext; state: { descendantPids: number[] } }): Promise<void> {
  if (ctx.child.pid == null) return;
  try {
    const processes = await ctx.listProcessSnapshots();
    state.descendantPids = ctx.collectProcessTreePids({ processes, rootPids: [ctx.child.pid] });
  } catch (error) {
    reportPostCloseFailure({ onCleanupFailure: ctx.onCleanupFailure, context: { runId: ctx.runId, phase: 'acp-release', pid: ctx.child.pid, error } });
  }
}

async function stopRecordedDescendants({ ctx, state }: { ctx: WireAcpLifecycleContext; state: { descendantPids: number[] } }): Promise<void> {
  if (state.descendantPids.length === 0) return;
  try {
    await ctx.stopProcesses({ pids: state.descendantPids });
  } catch (error) {
    reportPostCloseFailure({ onCleanupFailure: ctx.onCleanupFailure, context: { runId: ctx.runId, phase: 'acp-release', pid: ctx.child.pid, error } });
  }
}

function acpSessionRef({ ctx, state, controller }: {
  ctx: WireAcpLifecycleContext;
  state: { capturedSessionId: string | undefined };
  controller: ReturnType<WireAcpLifecycleContext['attachAcpSession']> | null;
}) {
  return state.capturedSessionId ?? (ctx.resumesViaAcpLoad ? controller?.getDurableSessionId() ?? undefined : undefined);
}

function createAcpEventSender({ ctx, state, modelReceipt, enqueueEmit }: {
  ctx: WireAcpLifecycleContext;
  state: { cancelRequested: boolean; capturedSessionId: string | undefined; userVisibleOutputSeen: boolean; toolCallSeen: boolean };
  modelReceipt: ReturnType<typeof createModelReceiptTracker>;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
}, _options = {}): Parameters<WireAcpLifecycleContext['attachAcpSession']>[0]['send'] {
  const { runId, lifecycle } = ctx;
  return ({ event, payload }) => {
    if (event === 'agent') {
      const translation = translateAgentRuntimeEvent({ rawEvent: payload });
      if (translation.kind === 'agent') {
          const receipt = modelReceipt(translation.payload);
          if (receipt) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: receipt } }));
        applyAgentTranslationSideEffects({ payload: translation.payload, sessionId: translation.sessionId, sink: {
          onSessionId: ({ sessionId }) => { state.capturedSessionId = sessionId; },
          onToolCall: () => { state.toolCallSeen = true; },
          onUserVisibleOutput: () => { state.userVisibleOutputSeen = true; },
        } });
        enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: translation.payload } }));
      }
      if (translation.kind === 'error') {
        enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'error', data: translation.payload } }));
      }
      return;
    }
    if (event === 'error') {
      enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'error', data: translateAcpError({ payload }) } }));
    }
  };
}

interface RunAcpDispatchInput {
  readonly runId: string;
  readonly agentId: string;
  readonly child: ChildProcess;
  readonly prompt: string;
  readonly cwd: string;
  readonly permissionMode: 'bypass' | 'restricted' | undefined;
  readonly cliParity?: boolean | undefined;
  readonly model: string | undefined;
  readonly resumeSessionId?: string | null | undefined;
  readonly resumesViaAcpLoad?: boolean | undefined;
  readonly effort?: string | undefined;
  readonly modelCatalog?: ModelCatalogSnapshot;
  readonly imagePaths: readonly string[];
  readonly envFormat: 'array' | 'map' | undefined;
  readonly mcpBridge: McpBridgeDelivery | null;
}

interface RunAcpDispatchDeps extends TerminateChildTreeDeps {
  readonly registerMessageRelay?: (relay: RunMessageRelay) => void;
  readonly lifecycle: RunLifecycle;
  readonly attachAcpSession: NonNullable<CreateAgentExecutorOptions['attachAcpSession']>;
  readonly onPermissionRequest: NonNullable<CreateAgentExecutorOptions['acpPermissionHandler']> | undefined;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  readonly cleanupStagedFiles: () => Promise<void>;
  readonly journal: RunByteJournal | undefined;
  readonly classifyFailure: ClassifyFailure | undefined;
  readonly releaseStagedResources: () => Promise<void>;
  readonly failBeforeSpawn: FailBeforeSpawn;
}

/** Phase 15 (ACP branch): attaches the ACP session, escalating process-tree teardown and failing the run through `failBeforeSpawn` on an attach-time throw. */
export async function runAcpDispatch({ input, deps }: { readonly input: RunAcpDispatchInput; readonly deps: RunAcpDispatchDeps }): Promise<void> {
  try {
    wireAcpLifecycle({
      ...(deps.registerMessageRelay ? { registerMessageRelay: deps.registerMessageRelay } : {}),
      runId: input.runId,
      agentId: input.agentId,
      child: input.child,
      lifecycle: deps.lifecycle,
      prompt: input.prompt,
      cwd: input.cwd,
      permissionMode: input.permissionMode,
      cliParity: input.cliParity,
      model: input.model,
      resumeSessionId: input.resumeSessionId, resumesViaAcpLoad: input.resumesViaAcpLoad, effort: input.effort,
      ...(input.modelCatalog ? { modelCatalog: input.modelCatalog } : {}),
      imagePaths: input.imagePaths,
      envFormat: input.envFormat,
      // Mechanism 2 of 5 — see `WireAcpLifecycleContext.mcpServers`. `undefined` for any def that
      // did not declare `'acp-merge'` and for an unconfigured host.
      mcpServers: input.mcpBridge?.kind === 'acp-merge' ? input.mcpBridge.mcpServers : undefined,
      onPermissionRequest: deps.onPermissionRequest,
      attachAcpSession: deps.attachAcpSession,
      listProcessSnapshots: deps.listProcessSnapshots,
      collectProcessTreePids: deps.collectProcessTreePids,
      stopProcesses: deps.stopProcesses,
      onCleanupFailure: deps.onCleanupFailure,
      cleanupStagedFiles: deps.cleanupStagedFiles,
      journal: deps.journal,
      classifyFailure: deps.classifyFailure,
    });
  } catch (err) {
    // Unlike the cancellation-listener call sites, we are already in an async function about to
    // call finish() and throw — nothing else races this, so cleanup is awaited here rather than
    // fired-and-forgotten (SEC-007: "await where lifecycle ordering allows it").
    await terminateChildTreeBestEffort(
      { listProcessSnapshots: deps.listProcessSnapshots, collectProcessTreePids: deps.collectProcessTreePids, stopProcesses: deps.stopProcesses },
      input.child,
      input.runId,
      'acp-attach-failure',
      deps.onCleanupFailure,
    );
    await deps.releaseStagedResources();
    // `failBeforeSpawn` always rejects (`Promise<never>`); awaiting it propagates that rejection.
    await deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not attach ACP session for agent "${input.agentId}": ${errorMessage({ err })}` },
    );
  }
}
