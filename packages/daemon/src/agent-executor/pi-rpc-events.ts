import { createModelReceiptTracker } from './model-receipts.js';
import { observeRunOutput } from './run-output.js';
import { createRunEventQueue, receivedJournalEntry } from './event-io.js';
import { cleanupStagedFilesSafely, classifyFailureSafely, terminateChildTreeBestEffort } from './event-cleanup.js';
import { translateAgentRuntimeEvent, applyAgentTranslationSideEffects } from './event-translation.js';
import { errorMessage } from './values.js';
import type { ChildProcess } from 'node:child_process';
import type { ModelCatalogSnapshot } from '@jini-ai/core/contracts/agents';
import type { RunLifecycle } from '../run-lifecycle.js';
import type { RunByteJournal } from '../continuation/journal.js';
import type { TerminateChildTreeDeps, AgentCleanupFailureContext, ClassifyFailure,
  CreateAgentExecutorOptions, FailBeforeSpawn } from './contracts.js';

interface WirePiRpcLifecycleContext extends TerminateChildTreeDeps {
  readonly runId: string;
  readonly agentId: string;
  readonly child: ChildProcess;
  readonly lifecycle: RunLifecycle;
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string | undefined;
  readonly modelCatalog?: ModelCatalogSnapshot;
  readonly imagePaths: readonly string[];
  readonly uploadRoot: string | undefined;
  readonly attachPiRpcSession: NonNullable<CreateAgentExecutorOptions['attachPiRpcSession']>;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /** Same seam as `WireChildLifecycleContext.cleanupStagedFiles` — no current pi-rpc def declares `promptViaFile` or `needsAgentLogFile`, so this is always the no-op default in practice today, threaded through for consistency rather than special-cased away. */
  readonly cleanupStagedFiles: () => Promise<void>;
  /** Gap 1's byte-journal (see `continuation/journal.ts`). Same scope boundary as `WireAcpLifecycleContext.journal`: covers this wrapper's own raw stdout/stderr forwarding only, not the prompt bytes `attachPiRpcSession` sends through its own transport. */
  readonly journal: RunByteJournal | undefined;
  /** Gap 4's failure classifier — see `ClassifyFailure`'s own doc. `undefined` means every `'failed'` outcome stays `resumable: false`. */
  readonly classifyFailure: ClassifyFailure | undefined;
}

/**
 * Wires a pi-rpc child to a run. Like ACP, pi owns its own prompt-delivery
 * protocol (`prompt`/`new_session`/`abort` RPC commands over stdin) and
 * reports parsed events through `attachPiRpcSession`'s `send` callback —
 * unlike ACP's callback, pi-rpc's `send` always uses the `'agent'` channel
 * (confirmed by reading every `mapPiRpcEvent` call site: error-ness is
 * signaled via the payload's own `type: 'error'` field, never a separate
 * channel), so this wrapper runs every payload through the same
 * `translateAgentRuntimeEvent` pipeline ACP/JSON-stream already use, with no
 * channel branch needed. Raw stdout/stderr are still forwarded for
 * diagnostics (same as ACP) even though `attachPiRpcSession` also consumes
 * `child.stdout` itself for its own JSON-RPC parsing — Node multicasts
 * `'data'` events to every listener, so both coexist safely.
 *
 * v1 omits `parentSession` — none of
 * `AgentExecutorRunInput`'s fields carry them yet (matching this module's
 * established "explicitly out of scope" discipline for other follow-ups:
 * multi-turn tool continuation, resumable session ids, etc.).
 */
function wirePiRpcLifecycle(ctx: WirePiRpcLifecycleContext): ReturnType<WirePiRpcLifecycleContext['attachPiRpcSession']> {
  const modelReceipt = createModelReceiptTracker({}, { startingModel: ctx.model, models: ctx.modelCatalog?.models });
  const { runId, agentId, child, lifecycle, journal } = ctx;
  const output = observeRunOutput({ lifecycle, runId, agentName: agentId });
  const state = {
    cancelRequested: false,
    // Gap 5 (session resume) — see wireChildLifecycle's identical local for the full rationale.
    capturedSessionId: undefined as string | undefined,
    // Real `FailureClassificationContext.sideEffects` signals — see that interface's own doc.
    userVisibleOutputSeen: false, toolCallSeen: false,
  };
  const { enqueueEmit, getTail } = createRunEventQueue({});
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

  let session: ReturnType<WirePiRpcLifecycleContext['attachPiRpcSession']> | null = null;
  const unsubscribeCancel = lifecycle.onCancelRequested({ runId: runId, listener: () => {
    state.cancelRequested = true;
    session?.abort();
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  } });

  child.on('close', (code, signal) => {
    void finishPiRpcOnClose({ ctx, state, getTail, unsubscribeCancel, output, code, signal,
      getSession: () => session });
  });

  session = ctx.attachPiRpcSession({ child: ctx.child, prompt: ctx.prompt,
    send: createPiRpcEventSender({ ctx, state, modelReceipt, enqueueEmit }) }, { cwd: ctx.cwd, ...(ctx.model !== undefined ? { model: ctx.model } : {}), ...(ctx.imagePaths.length > 0 ? { imagePaths: [...ctx.imagePaths] } : {}), ...(ctx.uploadRoot !== undefined ? { uploadRoot: ctx.uploadRoot } : {}) });
  return session;
}

async function finishPiRpcOnClose({ ctx, state, getTail, unsubscribeCancel, output, code, signal, getSession }: {
  ctx: WirePiRpcLifecycleContext;
  state: { cancelRequested: boolean; capturedSessionId: string | undefined; userVisibleOutputSeen: boolean; toolCallSeen: boolean };
  getTail: ReturnType<typeof createRunEventQueue>['getTail']; unsubscribeCancel: () => void;
  output: ReturnType<typeof observeRunOutput>; code: number | null; signal: NodeJS.Signals | null;
  getSession: () => ReturnType<WirePiRpcLifecycleContext['attachPiRpcSession']> | null;
}, _options = {}): Promise<void> {
  const { runId, agentId, lifecycle, classifyFailure } = ctx;
  await getTail();
  unsubscribeCancel();
  // Guarded for the same reasons as the child-driven handler above.
  await cleanupStagedFilesSafely(ctx);
  let finalStatus: 'cancelled' | 'succeeded' | 'failed' = 'cancelled';
  if (!state.cancelRequested) finalStatus = getSession()?.hasFatalError() ? 'failed' : 'succeeded';
  const status = await output.settle({ status: finalStatus });
  const resumable =
    status === 'failed' && classifyFailure !== undefined
      ? await classifyFailureSafely(ctx, classifyFailure, {
          runId,
          agentId,
          code,
          signal: signal ?? null,
          sideEffects: { userVisibleOutputSeen: state.userVisibleOutputSeen, toolCallSeen: state.toolCallSeen },
        })
      : false;
  await lifecycle.finish({ runId, status, code, signal: signal ?? null, resumable }, { ...(state.capturedSessionId !== undefined ? { sessionRef: state.capturedSessionId } : {}) });
}

function createPiRpcEventSender({ ctx, state, modelReceipt, enqueueEmit }: {
  ctx: WirePiRpcLifecycleContext;
  state: { cancelRequested: boolean; capturedSessionId: string | undefined; userVisibleOutputSeen: boolean; toolCallSeen: boolean };
  modelReceipt: ReturnType<typeof createModelReceiptTracker>;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
}, _options = {}): Parameters<WirePiRpcLifecycleContext['attachPiRpcSession']>[0]['send'] {
  const { runId, lifecycle } = ctx;
  return ({ payload }) => {
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
  };
}

interface RunPiRpcDispatchInput {
  readonly runId: string;
  readonly agentId: string;
  readonly child: ChildProcess;
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string | undefined;
  readonly modelCatalog?: ModelCatalogSnapshot;
  readonly imagePaths: readonly string[];
  readonly uploadRoot: string | undefined;
}

interface RunPiRpcDispatchDeps extends TerminateChildTreeDeps {
  readonly lifecycle: RunLifecycle;
  readonly attachPiRpcSession: NonNullable<CreateAgentExecutorOptions['attachPiRpcSession']>;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  readonly cleanupStagedFiles: () => Promise<void>;
  readonly journal: RunByteJournal | undefined;
  readonly classifyFailure: ClassifyFailure | undefined;
  readonly releaseStagedResources: () => Promise<void>;
  readonly failBeforeSpawn: FailBeforeSpawn;
}

/** Phase 15 (pi-rpc branch): same discipline as {@link runAcpDispatch}, for the one `'pi-rpc'` def. */
export async function runPiRpcDispatch({ input, deps }: { readonly input: RunPiRpcDispatchInput; readonly deps: RunPiRpcDispatchDeps }): Promise<void> {
  try {
    wirePiRpcLifecycle({
      runId: input.runId,
      agentId: input.agentId,
      child: input.child,
      lifecycle: deps.lifecycle,
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      ...(input.modelCatalog ? { modelCatalog: input.modelCatalog } : {}),
      imagePaths: input.imagePaths,
      uploadRoot: input.uploadRoot,
      attachPiRpcSession: deps.attachPiRpcSession,
      listProcessSnapshots: deps.listProcessSnapshots,
      collectProcessTreePids: deps.collectProcessTreePids,
      stopProcesses: deps.stopProcesses,
      onCleanupFailure: deps.onCleanupFailure,
      cleanupStagedFiles: deps.cleanupStagedFiles,
      journal: deps.journal,
      classifyFailure: deps.classifyFailure,
    });
  } catch (err) {
    // Same discipline as the ACP attach-failure path above: await cleanup here rather than
    // fire-and-forget (SEC-007).
    await terminateChildTreeBestEffort(
      { listProcessSnapshots: deps.listProcessSnapshots, collectProcessTreePids: deps.collectProcessTreePids, stopProcesses: deps.stopProcesses },
      input.child,
      input.runId,
      'pi-rpc-attach-failure',
      deps.onCleanupFailure,
    );
    await deps.releaseStagedResources();
    await deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not attach pi-rpc session for agent "${input.agentId}": ${errorMessage({ err })}` },
    );
  }
}
