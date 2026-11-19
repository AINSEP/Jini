import { createModelReceiptTracker } from './model-receipts.js';
import { observeRunOutput } from './run-output.js';
import { classifyRunCloseStatus } from '../close-status.js';
import { createRunEventQueue, receivedJournalEntry } from './event-io.js';
import { reportPostCloseFailure, cleanupStagedFilesSafely, classifyFailureSafely, terminateChildTreeBestEffort } from './event-cleanup.js';
import { createStdoutDiagnostics, createChildStdout } from './child-stdout.js';
import { createChildInput } from './child-input.js';
import { createChildStreamHandler } from './child-stream-events.js';
import type { ChildProcess } from 'node:child_process';
import type { RuntimeAgentDef, ModelCatalogSnapshot } from '@jini-ai/core/contracts/agents';
import type { DelegatedResultCorrelation } from '../delegated-result-correlation.js';
import type { StdoutJournalBlobPort } from '../tool-result-diagnostics.js';
import type { RunLifecycle } from '../run-lifecycle.js';
import type { RunByteJournal } from '../continuation/journal.js';
import type { RunMessageRelay } from './message-relay.js';
import type { probeMcpBridge } from './mcp-bridge-probe.js';
import type { TerminateChildTreeDeps, ChildDrivenStreamFormat, AgentCleanupFailureContext,
  ContinuationOptions, ClassifyFailure, StdinCloseHandle, StreamHandler } from './contracts.js';

export interface WireChildLifecycleContext extends TerminateChildTreeDeps {
  readonly registerMessageRelay?: (relay: RunMessageRelay) => void;
  readonly delegatedResultCorrelation?: DelegatedResultCorrelation;
  readonly stdoutJournalBlobs?: StdoutJournalBlobPort;
  readonly startingModel?: string;
  readonly modelCatalog?: ModelCatalogSnapshot;
  readonly runId: string;
  readonly def: RuntimeAgentDef;
  readonly streamFormat: ChildDrivenStreamFormat;
  readonly child: ChildProcess;
  readonly lifecycle: RunLifecycle;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /**
   * Removes every temp file `run()` staged for this run — a `promptViaFile`
   * def's prompt file (grok-build) and a `needsAgentLogFile` def's log file
   * (antigravity) — after the child exits. Deliberately one composed closure
   * rather than one field per file: the two are staged at the same point and
   * must be released on the same set of paths, and a second parallel field
   * is exactly how one of them ends up forgotten on a path the other covers.
   * A no-op default when neither was staged — see `run()`'s
   * `preparePromptFileForAgent`/`prepareAgentLogFile` call sites.
   */
  readonly cleanupStagedFiles: () => Promise<void>;
  /** Gap 1's byte-journal (see `continuation/journal.ts`). `undefined` when a caller configured none — every journal call site below is then a no-op. */
  readonly journal: RunByteJournal | undefined;
  /** Gap 3's stdin-tool-result injection config. `undefined` means every `turn_end` closes stdin unconditionally — see `ContinuationOptions`'s own doc. */
  readonly continuation: ContinuationOptions | undefined;
  /** Gap 4's failure classifier. `undefined` means every `'failed'` outcome stays `resumable: false` — byte-identical to pre-gap-4 behavior. See `ClassifyFailure`'s own doc. */
  readonly classifyFailure: ClassifyFailure | undefined;
  /** Ceiling on the `'until-close'` stdout accumulator — see {@link DEFAULT_BUFFERED_STDOUT_MAX_BYTES}. Always resolved by `run()`, never left to this function to default. */
  readonly bufferedStdoutMaxBytes: number;
  /**
   * True when this run's CLI was handed the `jini` bridge (`'claude-mcp-json'` delivery). The first
   * init frame's MCP report is then checked, and a bridge that is not connected stops the run with
   * {@link MCP_BRIDGE_UNAVAILABLE} instead of letting it continue without the host's tools.
   */
  readonly expectsJiniBridge: boolean;
  readonly bridgeProbeEntry: Parameters<typeof probeMcpBridge>[0]['entry'] | undefined;
  readonly probeMcpBridge: typeof probeMcpBridge;
}

export interface ChildRunSignals {
  cancelRequested: boolean;
  // Gap 5 (session resume) — the last session/thread id a 'status' event reported, threaded into
  // finish()'s sessionRef below. `streamFormat === 'plain'` defs have no structured parser and
  // therefore never populate this — an honest scope limit, not an oversight.
  capturedSessionId: string | undefined;
  // Real `FailureClassificationContext.sideEffects` signals (2026-07-22) — see that interface's
  // own doc for exactly what these two mean and why the other two `RunRetrySideEffectState`
  // fields aren't tracked here at all.
  userVisibleOutputSeen: boolean;
  toolCallSeen: boolean;
}

export interface ChildBridgeState {
  bridgeChecked: boolean;
  bridgeUnavailable: boolean;
}

/**
 * Wires one spawned child's full observable lifecycle: raw stdout/stderr
 * forwarding, structured stream-parser dispatch (translated via
 * {@link translateAgentRuntimeEvent}), cancellation (subscribes
 * `lifecycle.onCancelRequested` and escalates via `stopProcesses` on the
 * child's full descendant tree), and the terminal `close` → `finish()`
 * transition. Registered *before* the caller awaits spawn confirmation so
 * no early `'error'`/`'close'` event is ever missed.
 *
 * Every `lifecycle.emit()` call is funneled through a per-run FIFO queue
 * (`enqueueEmit`) rather than fired independently: a single stdout `data`
 * chunk can synchronously produce several parsed events (a JSON line's
 * `feed()` call may invoke `onEvent` more than once), and successive
 * `data` events must not have their derived `emit()` calls race each
 * other out of order. The queue also absorbs an individual `emit()`
 * rejection (e.g. a race against an already-terminal run) without losing
 * subsequently queued events, and the `close` handler awaits it fully
 * drained before computing the terminal outcome — so `finish()`'s `'end'`
 * event is always durably last, never interleaved with a still-in-flight
 * `'agent'`/`'stdout'`/`'stderr'` append.
 *
 * `streamFormat: 'plain'` gets no `createStreamHandlerForDef` parser at
 * all (Option B — see index.ts module doc and
 * `ADS-memory/reports/proposals/PROP-plain-format-agent-driving-2026-07-21.md`
 * §3): every raw stdout chunk is forwarded verbatim as a `text_delta`
 * `'agent'` event, through the same `enqueueEmit` FIFO queue every other
 * emit already goes through — no new parser state machine.
 * **Deliberately un-hygiened for v1**: no ANSI/terminal-control-sequence
 * stripping is applied (there is no Jini equivalent of OD's
 * `TerminalControlSequenceStripper` yet) — a documented decision, not an
 * oversight; see `070311a07^:packages/daemon/source-map.md`'s 2026-07-21 addition for
 * the reasoning.
 *
 * *When* those chunks leave is the def's call, via `def.stdoutPolicy`:
 *
 *   - `'live'` (the default) — emit per
 *     chunk, as it arrives.
 *   - `'until-close'` — accumulate, and emit the whole thing exactly once
 *     from the `close` handler, after `def.stdoutPolicy.sanitize`. For an
 *     adapter that can print a secret to stdout and still exit 0, no
 *     per-chunk decision is safe: the pattern to redact can straddle two
 *     `'data'` events.
 *   - `'line'` — sanitize each bounded complete wire line before both raw delivery and parsing;
 *     retain only its partial tail. Secrets split across chunks stay private without waiting for exit.
 *
 * The buffered path holds back the raw `'stdout'` echo too, not just the
 * `'agent'`/`text_delta`, and sanitizes both. Emitting an unsanitized raw
 * echo while withholding the chat copy would leak the exact string the
 * sanitizer exists to remove to any client subscribed to the run's events —
 * the raw channel is a different *purpose*, not a different audience.
 * `journal` is the one thing still recorded per-chunk and verbatim: it is
 * the host's own byte record, deliberately kept in a **separate** `EventLog`
 * instance that is never replayed to run-event subscribers (see
 * `continuation/journal.ts`'s module doc), and "every byte received" is its
 * whole contract.
 *
 * @param ctx - Run/def/child/lifecycle plus the cancellation-escalation ports.
 * @returns A handle exposing `closeStdinOnce` for the initial prompt write to share.
 * @complexity Registration is O(1); steady-state per-chunk cost is the
 * chosen stream parser's own `feed()` cost plus O(1) queue bookkeeping.
 * @overallScore 100/100
 */
export function wireChildLifecycle(ctx: WireChildLifecycleContext): StdinCloseHandle {
  const { runId, def, streamFormat, child, lifecycle } = ctx;
  const stdoutDiagnostics = createStdoutDiagnostics({ ctx, enqueueEmit: task => queue.enqueueEmit(task) });
  const output = observeRunOutput({ lifecycle, runId, agentName: def.name }, { plainStdout: streamFormat === 'plain' });
  const modelReceipt = createModelReceiptTracker(ctx.startingModel, ctx.modelCatalog?.models);
  const queue = createRunEventQueue({});
  const { enqueueEmit } = queue;
  const signals: ChildRunSignals = {
    cancelRequested: false, capturedSessionId: undefined, userVisibleOutputSeen: false, toolCallSeen: false,
  };
  const tools = observeUnresolvedToolCalls({ ctx });
  // Bridge guard (see `expectsJiniBridge`): checked on the first init frame only. Once the bridge is
  // found unavailable, the child is being stopped and nothing it still prints is forwarded.
  const bridge: ChildBridgeState = { bridgeChecked: !ctx.expectsJiniBridge, bridgeUnavailable: false };
  const stdout = createChildStdout({ ctx, signals, stdoutDiagnostics, enqueueEmit,
    scanControlLines: text => input.scanControlLines(text), getParser: () => streamHandler });
  if (ctx.startingModel) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'status', label: 'starting_model', model: ctx.startingModel! } } }));
  const input = createChildInput({ ctx, enqueueEmit, parserFeed: chunk => streamHandler!.feed({ chunk }) });
  const streamHandler = createChildStreamHandler({ ctx, signals, bridge, enqueueEmit, input, modelReceipt });
  child.stdout?.on('data', stdout.onData);
  const unsubscribeCancel = registerChildLifecycle({ ctx, signals, enqueueEmit });
  child.on('close', (code, signal) => {
    input.markClosed();
    void finishChildOnClose({ ctx, signals, bridge, queue, tools, stdout, input, streamHandler,
      stdoutDiagnostics, unsubscribeCancel, output, code, signal });
  });
  return input.handle;
}

function observeUnresolvedToolCalls({ ctx }: { ctx: WireChildLifecycleContext }, _options = {}) {
  const { lifecycle, runId, child } = ctx;
  // Observe the canonical lifecycle, including delegated calls that bypass the CLI parser.
  // A single latest tool_use cannot represent all parallel calls at explicit cancellation.
  const unresolvedToolCalls = new Set<string>();
  const toolSubscription = lifecycle.stream({ runId, onEvent: (event) => {
    if (event.kind !== 'agent') return;
    if (event.payload.type === 'tool_use') unresolvedToolCalls.add(event.payload.id);
    if (event.payload.type === 'tool_result') unresolvedToolCalls.delete(event.payload.toolUseId);
  } }).catch(error => {
    // Observing tools is fallible I/O too: report it, but never strand close/finish on a replay
    // failure or leave an unhandled rejection while the child is still running.
    reportPostCloseFailure(ctx.onCleanupFailure, { runId, phase: 'tool-cancellation', pid: child.pid, error });
    return null;
  });

  /** Run on the same FIFO as parsed results, after the aborted segment has drained.
   * O(t) in unresolved calls; completed results are never replaced with cancellation. */
  async function cancelUnresolvedToolCalls(): Promise<void> {
    await toolSubscription;
    for (const toolUseId of [...unresolvedToolCalls]) {
      if (!unresolvedToolCalls.has(toolUseId)) continue;
      await lifecycle.emit({ runId, input: { event: 'agent', data: {
        type: 'tool_result', toolUseId, content: 'Tool execution cancelled.', isError: true,
      } } }).catch(error => {
        reportPostCloseFailure(ctx.onCleanupFailure, { runId, phase: 'tool-cancellation', pid: child.pid, error });
      });
    }
  }
  return { toolSubscription, cancelUnresolvedToolCalls };
}

function registerChildLifecycle({ ctx, signals, enqueueEmit }: {
  ctx: WireChildLifecycleContext; signals: ChildRunSignals;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
}, _options = {}) {
  const { runId, child, lifecycle, journal } = ctx;
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: receivedJournalEntry('stderr', text) }));
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'stderr', data: { chunk: text } } }));
  });

  // EPIPE-tolerant: a fast-exiting child that closes its stdin read end
  // before every queued write lands must not crash the host process with
  // an unhandled stream error — the real failure (if any) surfaces through
  // the 'close' handler below regardless.
  child.stdin?.on('error', () => {});
  // Safety net for any child-level 'error' event that fires after the
  // spawn-confirmation race (see waitForSpawnOrError) has already settled —
  // EventEmitter throws on an unheard 'error' otherwise. The real outcome
  // is still decided by 'close' below.
  child.on('error', () => {});

  const unsubscribeCancel = lifecycle.onCancelRequested({ runId: runId, listener: () => {
    signals.cancelRequested = true;
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  } });
  return unsubscribeCancel;
}

async function finishChildOnClose({ ctx, signals, bridge, queue, tools, stdout, input, streamHandler,
  stdoutDiagnostics, unsubscribeCancel, output, code, signal }: {
  ctx: WireChildLifecycleContext; signals: ChildRunSignals; bridge: ChildBridgeState;
  queue: ReturnType<typeof createRunEventQueue>; tools: ReturnType<typeof observeUnresolvedToolCalls>;
  stdout: ReturnType<typeof createChildStdout>; input: ReturnType<typeof createChildInput>;
  streamHandler: StreamHandler | null; stdoutDiagnostics: ReturnType<typeof createStdoutDiagnostics>;
  unsubscribeCancel: () => void; output: ReturnType<typeof observeRunOutput>;
  code: number | null; signal: NodeJS.Signals | null;
}, _options = {}): Promise<void> {
  const { runId, lifecycle } = ctx;
  // Not wrapped in try/catch: all 4 supported parser factories'
  // flush() implementations already internally guard their own
  // JSON.parse/dispatch and degrade a malformed trailing buffered
  // line to a `{type:'raw'}` event rather than throwing (confirmed by
  // reading each of the 4 modules in full — see index.ts module doc). A guard
  // here would be dead code for the fixed, closed set of parsers this
  // driver dispatches to. `streamHandler` is null for `'plain'` (no
  // parser, hence nothing to flush) — `?.` skips it cleanly.
  input.flushControlTail();
  stdout.flushBufferedStdout();
  stdout.flushLine();
  streamHandler?.flush();
  input.endSession();
  stdoutDiagnostics.flush();
  // The buffered flush is queued before `await emitQueue` so its sanitized events are durable
  // ahead of `finish()`'s `'end'`, exactly like every live-path emit already is.
  await queue.getTail();
  if (signals.cancelRequested) await tools.cancelUnresolvedToolCalls();
  const subscribedTools = await tools.toolSubscription;
  if (subscribedTools?.kind === 'ok') subscribedTools.unsubscribe();
  unsubscribeCancel();
  // Both of the next two steps are guarded: neither a failed cleanup nor a rejecting host
  // classifier may prevent the terminal transition below — see each helper's own doc.
  await cleanupStagedFilesSafely(ctx);
  const status = await output.settle({ status: bridge.bridgeUnavailable ? 'failed' : classifyRunCloseStatus({ cancelRequested: signals.cancelRequested, code }, { signal }) });
  const resumable = await resolveChildResumable({ ctx, signals, bridge, status, code, signal }, {});
  await lifecycle.finish({ runId, status, code, signal: signal ?? null, resumable }, { ...(signals.capturedSessionId !== undefined ? { sessionRef: signals.capturedSessionId } : {}) });
}

async function resolveChildResumable(
  { ctx, signals, bridge, status, code, signal }: {
    ctx: WireChildLifecycleContext; signals: ChildRunSignals; bridge: ChildBridgeState;
    status: string; code: number | null; signal: NodeJS.Signals | null;
  }, _options = {},
): Promise<boolean> {
  const { classifyFailure, runId, def } = ctx;
  // A bridge failure is not resumable: resuming would start the same CLI with the same bridge.
  return status === 'failed' && !bridge.bridgeUnavailable && classifyFailure !== undefined
    ? await classifyFailureSafely(ctx, classifyFailure, {
        runId,
        agentId: def.id,
        code,
        signal: signal ?? null,
        sideEffects: { userVisibleOutputSeen: signals.userVisibleOutputSeen, toolCallSeen: signals.toolCallSeen },
      })
    : false;
}

