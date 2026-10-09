import { randomUUID } from 'node:crypto';
import type { ModelCatalogSnapshot } from '@jini-ai/agent-runtime';
import { createModelReceiptTracker } from './model-receipts.js';
import { messageContentWithImages } from '../attachment-content.js';
import type {
   ChildProcess,
} from 'node:child_process';
import {
  redactSecrets,
  type RunRef,
} from '@jini-ai/core';
import type {
   JournalEntry,
   RunAgentPayload,
} from '@jini-ai/protocol';
import {
  createClaudeStreamHandler,
  createCopilotStreamHandler,
  createJsonEventStreamHandler,
  createQoderStreamHandler,
  attachAcpSession,
  attachPiRpcSession,
  type AcpMcpServerInput,
  type AcpPermissionHandler,
  type AcpSessionController,
  type PiRpcSession,
  type RuntimeAgentDef,
} from '@jini-ai/agent-runtime';
import {
  collectProcessTreePids,
  listProcessSnapshots,
  stopProcesses,
} from '@jini-ai/platform';
import {
  classifyRunCloseStatus,
} from '../close-status.js';
import {
  resolveContinuationTransport,
} from '../continuation/continuation-transport.js';
import type {
   RunByteJournal,
} from '../continuation/journal.js';
import {
  resultContent,
} from '../delegated-tool-bridge.js';
import {
  extractResultMedia,
  type ToolResultMediaBlock,
} from '../tool-result-media.js';
import type {
   RunLifecycle,
} from '../run-lifecycle.js';
import type {
   StreamHandler,
   JsonStreamFormat,
   ChildDrivenStreamFormat,
   TerminateChildTreeDeps,
   AgentCleanupFailurePhase,
   AgentCleanupFailureContext,
   StdinCloseHandle,
   UserMessageDelivery,
   ContinuationOptions,
   McpBridgeDelivery,
   FailureClassificationContext,
   ClassifyFailure,
   FailBeforeSpawn,
} from './contracts.js';
import {
  translateAgentRuntimeEvent,
  translateAcpError,
  applyAgentTranslationSideEffects,
} from './event-translation.js';
import {
  errorMessage,
  isRecord,
} from './values.js';
import {
  MCP_BRIDGE_UNAVAILABLE,
  unavailableJiniBridgeStatus,
  bridgeUnavailableMessage,
} from './mcp-bridge.js';

/** Carry PID only on structured status so the host can record its OS start identity early.
 * A PID alone is never proof of death; hosts verify PID reuse before native continuation. */
function statusWithChildIdentity(
  { payload, childPid }: { payload: RunAgentPayload; childPid: number | undefined }, _optional = {},
): RunAgentPayload {
  return { ...payload, ...(payload.type === 'status' && childPid !== undefined ? { childPid } : {}) };
}

/**
 * Selects and constructs the real stream-parser handler for a supported
 * `streamFormat`. `json-event-stream` additionally dispatches on
 * `def.eventParser` (the parser's own internal `kind` switch — e.g.
 * `'codex'`, `'cursor-agent'`, `'opencode'`; `mimo` shares `'opencode'`'s
 * `kind`); an unrecognized/absent `eventParser` degrades to that parser's
 * own `{type:'raw', line}` fallback rather than throwing, matching the
 * parser's own documented behavior. Never called for `streamFormat:
 * 'plain'` — `wireChildLifecycle` handles that format inline with no
 * parser at all (see `ChildDrivenStreamFormat`'s doc).
 * @param def - The resolved agent def (only `.eventParser` is read beyond `streamFormat`).
 * @param streamFormat - `def.streamFormat`, already narrowed by {@link isSupportedStreamFormat}.
 * @param onEvent - Sink the parser calls once per parsed (or malformed-raw) event.
 * @returns A `{feed, flush}` handle for the chosen parser.
 * @complexity O(1) dispatch; the returned handler's own per-chunk cost is the parser's.
 * @overallScore 100/100
 */
function createStreamHandlerForDef(
  def: RuntimeAgentDef,
  streamFormat: JsonStreamFormat,
  onEvent: (event: Record<string, unknown>) => void,
): StreamHandler {
  switch (streamFormat) {
    case 'claude-stream-json':
      return createClaudeStreamHandler({ onEvent: onEvent });
    case 'copilot-stream-json':
      return createCopilotStreamHandler({ onEvent: onEvent });
    case 'qoder-stream-json':
      return createQoderStreamHandler({ onEvent: onEvent });
    case 'json-event-stream':
      return createJsonEventStreamHandler({ kind: def.eventParser ?? '', onEvent: onEvent });
  }
}

/**
 * Enumerates `child`'s full descendant process tree and stops it (SIGTERM →
 * SIGKILL escalation, via the injected `stopProcesses` port).
 * @param deps - The process-snapshot/tree-collection/stop ports (real `@jini-ai/platform` implementations by default — see {@link CreateAgentExecutorOptions}).
 * @param child - The child whose descendant tree should be terminated.
 * @returns Resolves once escalation completes (or immediately, as a no-op, if `child.pid` was never assigned — spawn never actually started).
 * @complexity O(p) in the number of live OS processes (`listProcessSnapshots`'s own cost) plus O(1) escalation rounds.
 * @overallScore 100/100
 */
async function terminateChildTree(deps: TerminateChildTreeDeps, child: ChildProcess): Promise<void> {
  if (child.pid == null) return;
  const processes = await deps.listProcessSnapshots();
  const pids = deps.collectProcessTreePids({ processes, rootPids: [child.pid] });
  await deps.stopProcesses({ pids });
}

/** Default sink when a host does not supply `onCleanupFailure`: still observable, never silent. Redacted per SEC-007 (a spawn/permission error can embed paths/host detail). */
export function defaultCleanupFailureSink(context: AgentCleanupFailureContext): void {
  // eslint-disable-next-line no-console
  console.error(
    `[@jini-ai/daemon] agent-executor: process-tree cleanup failed for run "${context.runId}" (${context.phase}, pid=${context.pid})`,
    redactSecrets({ input: errorMessage(context.error) }),
  );
}

/**
 * Reports a contained post-close failure through the host's sink, absorbing a throwing sink.
 *
 * A diagnostic sink is host code too, and the whole point of these callers is that nothing
 * between `'close'` and `finish()` can strand the run — a sink that throws must not reintroduce
 * exactly that. Same reasoning `run-lifecycle.ts`'s `handleInactivityTimeout` already applies to its
 * own `onInternalError`.
 */
function reportPostCloseFailure(
  onCleanupFailure: (context: AgentCleanupFailureContext) => void,
  context: AgentCleanupFailureContext,
): void {
  try {
    onCleanupFailure(context);
  } catch {
    // Nothing further can be done from here, and the terminal transition below still must happen.
  }
}

/** The subset of a close handler's context the two post-close guards below need. */
interface PostCloseGuardContext {
  readonly runId: string;
  readonly child: ChildProcess;
  readonly cleanupStagedFiles: () => Promise<void>;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
}

/**
 * Removes this run's staged files, reporting rather than propagating a failure.
 *
 * Unguarded, a rejecting cleanup (EBUSY, a temp directory yanked out from under the daemon, a host
 * stager bug) escaped the `void (async () => …)()` wrapper in each close handler and took `finish()`
 * with it: the child was already gone, yet the run stayed `'running'` forever — unfinishable and
 * unresumable — and the rejection surfaced only as an unhandled promise. A leaked temp file is a real
 * problem, but it is strictly smaller than a permanently stranded run, and reporting it keeps it
 * visible.
 */
async function cleanupStagedFilesSafely(ctx: PostCloseGuardContext): Promise<void> {
  try {
    await ctx.cleanupStagedFiles();
  } catch (error) {
    reportPostCloseFailure(ctx.onCleanupFailure, {
      runId: ctx.runId,
      phase: 'staged-file-cleanup',
      pid: ctx.child.pid,
      error,
    });
  }
}

/**
 * Resolves `finish()`'s `resumable` flag from the host's classifier, falling back to `false` when the
 * classifier itself rejects.
 *
 * `classifyFailure` is host-supplied and may do real work (a keystore read, an HTTP call), so it can
 * fail for reasons unrelated to this run. `false` is the right fallback: it is already the answer for
 * every run with no classifier configured at all, so an unavailable classifier degrades to the
 * documented default rather than losing the run.
 */
async function classifyFailureSafely(
  ctx: PostCloseGuardContext,
  classifyFailure: ClassifyFailure,
  context: FailureClassificationContext,
): Promise<boolean> {
  try {
    return await classifyFailure(context);
  } catch (error) {
    reportPostCloseFailure(ctx.onCleanupFailure, {
      runId: ctx.runId,
      phase: 'failure-classification',
      pid: ctx.child.pid,
      error,
    });
    return false;
  }
}

/**
 * Fire-and-forget-safe wrapper around {@link terminateChildTree} for the cancellation paths
 * (a synchronous `onCancelRequested` listener, an ACP attach-failure catch) that observed this
 * promise with a bare `void` — silently swallowing any `listProcessSnapshots`/`stopProcesses`
 * rejection (e.g. EPERM — see `packages/platform/src/__tests__/process.test.ts`) and letting it
 * become an unhandled rejection, with descendants possibly still running and no diagnostic at
 * all (SEC-007). This never rejects: a tree-stop failure is reported through `onCleanupFailure`
 * (redacted) and followed by a best-effort direct kill of `child` itself, since the immediate
 * child is still worth trying even when tree enumeration/escalation failed.
 */
function terminateChildTreeBestEffort(
  deps: TerminateChildTreeDeps,
  child: ChildProcess,
  runId: string,
  phase: AgentCleanupFailurePhase,
  onCleanupFailure: (context: AgentCleanupFailureContext) => void,
): Promise<void> {
  return terminateChildTree(deps, child).catch((error: unknown) => {
    // `terminateChildTree` only reaches a rejecting call (rather than its own early return) once
    // its own `child.pid == null` guard has already passed, and a real ChildProcess's `pid` is
    // never unset after being assigned — so `child.pid` is provably a number here. The non-null
    // assertion documents that invariant instead of a `?? null` fallback that could never
    // actually be exercised (same pattern as `pi-rpc/session.ts`'s `resolveSessionPathChangedSince`).
    onCleanupFailure({ runId, phase, pid: child.pid!, error });
    try {
      if (child.pid != null && !child.killed) child.kill('SIGKILL');
    } catch {
      // Best-effort only — nothing further can be done from here.
    }
  });
}

/**
 * Gap 1's byte-journal record for bytes the host sent to the child's stdin — always `trust:
 * 'trusted'`, since these are bytes this driver itself composed and wrote, not agent output. See
 * `packages/daemon/src/continuation/journal.ts`'s module doc.
 */
function sentJournalEntry(content: string): JournalEntry {
  return { content, provenance: { source: 'host', channel: 'stdin' }, trust: 'trusted' };
}

/**
 * Gap 1's byte-journal record for bytes a child agent process produced on `channel` — always
 * `trust: 'untrusted'`, since this is attacker-influenceable agent output the kernel does not
 * control (see `@jini-ai/protocol`'s `JournalEntry` doc on why `trust` exists).
 */
function receivedJournalEntry(channel: 'stdout' | 'stderr', content: string): JournalEntry {
  return { content, provenance: { source: 'agent', channel }, trust: 'untrusted' };
}

/**
 * Default ceiling on the `'until-close'` stdout accumulator (see `RuntimeStdoutPolicy` in
 * `@jini-ai/agent-runtime`), in bytes of received UTF-8.
 *
 * A buffered def holds its child's entire stdout in one in-memory string until the process closes,
 * which is exactly what makes the accumulator a denial-of-service surface: the child is a
 * prompt-influenced agent CLI this driver already treats as potentially adversarial (SEC-001), and
 * nothing obliges it to ever close or to stop emitting. Without a ceiling one run could exhaust the
 * daemon's heap and take every unrelated run in the process down with it.
 *
 * 8 MiB is chosen to sit far above any real buffered-agent transcript (antigravity's print-mode
 * output — the only `'until-close'` def — is a few KiB of auth prompt and result text) while staying
 * small enough that a hostile child cannot meaningfully pressure the heap. A host that genuinely
 * needs more passes `CreateAgentExecutorOptions.bufferedStdoutMaxBytes`.
 */
export const DEFAULT_BUFFERED_STDOUT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The host-authored note appended to a truncated flush. Written *after* the def's own `sanitize`
 * runs, never before: it is this driver's own text, not agent output, and passing it through a
 * consumer-supplied redactor could silently delete the one line that says output is missing.
 */
function bufferedStdoutTruncationNotice(droppedBytes: number, maxBytes: number): string {
  return `\n[jini] agent stdout truncated: ${droppedBytes} byte(s) dropped after the ${maxBytes}-byte buffer limit was reached.\n`;
}

interface WireChildLifecycleContext extends TerminateChildTreeDeps {
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
 * oversight; see `packages/daemon/archived provenance ledger`'s 2026-07-21 addition for
 * the reasoning.
 *
 * *When* those chunks leave is the def's call, via `def.stdoutPolicy`:
 *
 *   - `'live'` (the default, and every def but antigravity) — emit per
 *     chunk, as it arrives.
 *   - `'until-close'` — accumulate, and emit the whole thing exactly once
 *     from the `close` handler, after `def.stdoutPolicy.sanitize`. For an
 *     adapter that can print a secret to stdout and still exit 0, no
 *     per-chunk decision is safe: the pattern to redact can straddle two
 *     `'data'` events.
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
  const { runId, def, streamFormat, child, lifecycle, journal, continuation, classifyFailure } = ctx;
  const modelReceipt = createModelReceiptTracker(ctx.startingModel, ctx.modelCatalog?.models);
  let stdinClosed = false;
  let cancelRequested = false;
  let emitQueue: Promise<void> = Promise.resolve();
  // Gap 5 (session resume) — the last session/thread id a 'status' event reported, threaded into
  // finish()'s sessionRef below. `streamFormat === 'plain'` defs have no structured parser and
  // therefore never populate this — an honest scope limit, not an oversight.
  let capturedSessionId: string | undefined;
  // Real `FailureClassificationContext.sideEffects` signals (2026-07-22) — see that interface's
  // own doc for exactly what these two mean and why the other two `RunRetrySideEffectState`
  // fields aren't tracked here at all.
  let userVisibleOutputSeen = false;
  let toolCallSeen = false;
  // Gap 3 (stdin-tool-result injection) — the most recently reported tool_use, cleared once
  // consumed by a turn-end injection decision. See `ContinuationOptions`'s doc for why this is
  // only ever acted on when a host has explicitly allowlisted the tool's name.
  let pendingToolUse: { id: string; name: string; input: unknown } | undefined;
  // Observe the canonical lifecycle, including delegated calls that bypass the CLI parser.
  // A single latest tool_use cannot represent parallel tools at an interrupt boundary.
  const unresolvedToolCalls = new Set<string>();
  const interruptedToolCalls = new Set<string>();
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
  async function cancelUnresolvedToolCalls(ids?: readonly string[]): Promise<void> {
    await toolSubscription;
    for (const toolUseId of ids ?? [...unresolvedToolCalls]) {
      if (!unresolvedToolCalls.has(toolUseId)) continue;
      await lifecycle.emit({ runId, input: { event: 'agent', data: {
        type: 'tool_result', toolUseId, content: 'Tool execution cancelled.', isError: true,
      } } }).catch(error => {
        reportPostCloseFailure(ctx.onCleanupFailure, { runId, phase: 'tool-cancellation', pid: child.pid, error });
      });
    }
  }
  // Bridge guard (see `expectsJiniBridge`): checked on the first init frame only. Once the bridge is
  // found unavailable, the child is being stopped and nothing it still prints is forwarded.
  let bridgeChecked = !ctx.expectsJiniBridge;
  let bridgeUnavailable = false;
  // `def.stdoutPolicy` read once, up front, so the per-chunk handler below is a single boolean
  // test rather than a repeated union narrowing. `undefined` (every def but antigravity) means
  // live — see this function's own doc.
  const stdoutPolicy = def.stdoutPolicy;
  const bufferStdoutUntilClose = stdoutPolicy?.buffering === 'until-close';
  const sanitizeBufferedStdout = stdoutPolicy?.buffering === 'until-close' ? stdoutPolicy.sanitize : undefined;
  // Accumulator for the `'until-close'` path. Stays `''` for every live def, and the flush below
  // is then a no-op that emits nothing. Bounded by `ctx.bufferedStdoutMaxBytes` — see
  // {@link DEFAULT_BUFFERED_STDOUT_MAX_BYTES} for why an unbounded accumulator was a
  // denial-of-service surface rather than merely untidy.
  let bufferedStdout = '';
  let bufferedStdoutBytes = 0;
  /** Bytes the ceiling refused, reported verbatim on flush so truncation is never silent. */
  let droppedStdoutBytes = 0;

  function enqueueEmit(task: () => Promise<unknown>): void {
    emitQueue = emitQueue.then(async () => {
      try {
        await task();
      } catch {
        // A single emit failing (e.g. a race against an already-terminal
        // run) must not block delivery of subsequently queued events —
        // see this function's own doc.
      }
    });
  }

  if (ctx.startingModel) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'status', label: 'starting_model', model: ctx.startingModel! } } }));

  function closeStdinOnce(): void {
    if (stdinClosed) return;
    stdinClosed = true;
    child.stdin?.end();
  }

  // Mid-run interrupts (see `sendUserMessage` below): each sent `interrupt` control request waits
  // here, by request id, for the CLI's `control_response`. Settled with `true` on the ack, `false`
  // when the process exits first. Bounded by the mid-run messages in flight on this one run.
  const pendingInterruptAcks = new Map<string, (acked: boolean) => void>();
  // Set once this run has interrupted its agent: from then on a turn the interrupt aborted
  // (`aborted_*` stop reason) is not the run's last — the message that follows starts a new one.
  let interruptSent = false;
  // stdout carry-over for spotting acks; only filled while an interrupt waits for one.
  let ackScanBuffer = '';

  /** Resolves every waiting interrupt whose `control_response` is in this stdout chunk. @complexity O(chunk length). */
  function scanForInterruptAcks(text: string): void {
    if (pendingInterruptAcks.size === 0) return;
    ackScanBuffer += text;
    const lines = ackScanBuffer.split('\n');
    ackScanBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.includes('"control_response"')) continue;
      const requestId = controlResponseRequestId({ line: line });
      const settle = requestId === undefined ? undefined : pendingInterruptAcks.get(requestId);
      if (!settle) continue;
      pendingInterruptAcks.delete(requestId!);
      settle(true);
    }
    if (pendingInterruptAcks.size === 0) ackScanBuffer = '';
  }

  /**
   * Writes a structured (never string-concatenated — see `ContinuationOptions`'s doc on the
   * prompt-injection stakes here) tool_result JSONL line, mirroring the shape
   * `claude-stream.ts`'s own inbound parser already expects on the opposite direction of this
   * exact wire format. Journals the sent content the same way `writePromptToStdin`'s
   * `recordSentBytes` does.
   */
  function injectToolResultLine(toolUseId: string, content: string, isError: boolean): void {
    const stdin = child.stdin;
    if (!stdin) return;
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }] },
    });
    stdin.write(`${line}\n`, 'utf8');
    if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: sentJournalEntry(content) }));
  }

  /**
   * Whether a `turn_end` leaves stdin open for a live agent that takes mid-run messages, because
   * the run is not over: a `tool_use` stop (the CLI runs the tool itself and carries on, and a
   * message sent while the tool runs must still reach it), any end while an interrupt still waits
   * for its ack (the message is about to be written), and the end of a turn an interrupt aborted
   * (the message written after it starts the next turn). Every other end closes stdin, so the CLI
   * exits once it has answered everything written before EOF.
   */
  function keepsStdinOpenAfterTurnEnd(stopReason: string | undefined): boolean {
    if (!acceptsMidRunUserMessages({ def: def })) return false;
    if (stopReason === 'tool_use' || pendingInterruptAcks.size > 0) return true;
    return interruptSent && stopReason !== undefined && stopReason.startsWith('aborted');
  }

  /**
   * Decides, per `turn_end`, whether to auto-resolve a pending tool_use through the injected
   * `ToolExecutor` and keep stdin open (gap 3), or close stdin exactly as every version of this
   * function has always done (the default, and the only behavior when `continuation` is
   * unconfigured or the pending tool isn't allowlisted).
   */
  function handleTurnEnd(stopReason: string | undefined): void {
    if (stopReason?.startsWith('aborted')) enqueueEmit(async () => {
      await cancelUnresolvedToolCalls([...interruptedToolCalls]);
      interruptedToolCalls.clear();
    });
    const toolUse = pendingToolUse;
    const shouldInject =
      stopReason === 'tool_use' &&
      toolUse !== undefined &&
      continuation !== undefined &&
      resolveContinuationTransport({ def: def }) === 'stdin-injection' &&
      continuation.autonomousToolNames.has(toolUse.name);
    if (!shouldInject) {
      if (!keepsStdinOpenAfterTurnEnd(stopReason)) closeStdinOnce();
      return;
    }
    pendingToolUse = undefined;
    enqueueEmit(async () => {
      const run: RunRef = { id: runId };
      let content: string;
      let isError: boolean;
      // Same extraction `delegated-tool-bridge.ts`'s `execute()` runs, kept consistent per
      // `resultContent`'s own doc ("both callers share one mapping"). This path never ran
      // `splitToolResultSurfaces` (it has no `mcp-ui` withhold-from-model concept — the flattened
      // `content` below already carries the whole raw output, a pre-existing, unrelated gap), so
      // there is no `remainder` to thread back in — only the extracted blocks are used here.
      let media: readonly ToolResultMediaBlock[] = [];
      // Suspend the slow-run watchdog for the duration of this daemon-awaited execution: the daemon
      // knows exactly why the run is quiet here (it dispatched the tool itself and is waiting on it),
      // so a legitimately long tool (an install, a build, a repo-wide scan) must not be mistaken for
      // the CPU-starved-and-silent condition the watchdog exists to catch. Resumed in `finally` so a
      // genuinely stalled stretch *after* this tool settles is still caught — see
      // `RunLifecycle.suspendSlowRunNotice`'s own doc.
      lifecycle.suspendSlowRunNotice({ runId: runId });
      try {
        const result = await continuation.toolExecutor.execute({ principal: continuation.principal, run: run, toolId: toolUse.name, input: toolUse.input });
        content = resultContent({ result: result });
        isError = result.status !== 'completed';
        media = extractResultMedia({ output: result.output }).media;
      } catch (error) {
        content = errorMessage(error);
        isError = true;
      } finally {
        lifecycle.resumeSlowRunNotice({ runId: runId });
      }
      await lifecycle.emit({ runId: runId, input: {
        event: 'agent',
        data: {
          type: 'tool_result',
          toolUseId: toolUse.id,
          content,
          ...(isError ? { isError: true } : {}),
          ...(media.length > 0 ? { media } : {}),
        },
      } });
      injectToolResultLine(toolUse.id, content, isError);
    });
  }

  const streamHandler: StreamHandler | null =
    streamFormat === 'plain'
      ? null
      : createStreamHandlerForDef(def, streamFormat, (rawEvent) => {
          if (bridgeUnavailable) return;
          const translation = translateAgentRuntimeEvent({ rawEvent: rawEvent });
          if (translation.kind === 'agent') {
            const receipt = modelReceipt(translation.payload);
            if (receipt) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: receipt } }));
            if (translation.sessionId !== undefined) capturedSessionId = translation.sessionId;
            if (!bridgeChecked && translation.payload.type === 'status' && translation.payload.label === 'initializing') {
              bridgeChecked = true;
              const bridgeStatus = unavailableJiniBridgeStatus({ rawEvent: rawEvent });
              if (bridgeStatus !== undefined) {
                stopForUnavailableBridge(translation.payload, bridgeStatus);
                return;
              }
            }
            if (translation.payload.type === 'tool_use') {
              pendingToolUse = { id: translation.payload.id, name: translation.payload.name, input: translation.payload.input };
              toolCallSeen = true;
            } else if (
              (translation.payload.type === 'text_delta' || translation.payload.type === 'thinking_delta') &&
              translation.payload.delta.length > 0
            ) {
              userVisibleOutputSeen = true;
            }
            enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: statusWithChildIdentity({ payload: translation.payload, childPid: ctx.child.pid }, {}) } }));
          } else if (translation.kind === 'error') {
            enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'error', data: translation.payload } }));
          } else if (translation.kind === 'turn-end') {
            handleTurnEnd(translation.stopReason);
          }
        });

  /**
   * Ends a run whose CLI started without the `jini` bridge: emits the init status and a
   * {@link MCP_BRIDGE_UNAVAILABLE} error, then stops the child's process tree before the model can
   * answer with no host tools. The close handler then finishes the run `'failed'` whatever exit code
   * the child reports.
   */
  function stopForUnavailableBridge(initStatus: RunAgentPayload, bridgeStatus: string): void {
    bridgeUnavailable = true;
    const message = bridgeUnavailableMessage(bridgeStatus);
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: initStatus } }));
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'error', data: { message, error: { code: MCP_BRIDGE_UNAVAILABLE, message } } } }));
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  }

  /**
   * Emits the accumulated `'until-close'` stdout — sanitized — as exactly one raw `'stdout'` echo
   * plus one `text_delta`, through the same `enqueueEmit` FIFO queue every other emit uses, so the
   * flush is ordered after every already-queued event and before `finish()`'s `'end'`. A no-op for
   * every live-streaming def (nothing was ever accumulated) and for a buffered run that produced
   * no stdout at all — an empty `text_delta` is noise, not information.
   *
   * A run whose accumulator hit its ceiling is the one case that still emits when the sanitized text
   * is empty: "the sanitizer redacted everything" and "we dropped output on the floor" must not look
   * identical to a client, so the truncation notice is information in its own right.
   */
  function flushBufferedStdout(): void {
    if (bufferedStdout.length === 0 && droppedStdoutBytes === 0) return;
    const safe = sanitizeBufferedStdout ? sanitizeBufferedStdout({ fullText: bufferedStdout }) : bufferedStdout;
    bufferedStdout = '';
    bufferedStdoutBytes = 0;
    const text =
      droppedStdoutBytes > 0
        ? `${safe}${bufferedStdoutTruncationNotice(droppedStdoutBytes, ctx.bufferedStdoutMaxBytes)}`
        : safe;
    droppedStdoutBytes = 0;
    if (text.length === 0) return;
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'stdout', data: { chunk: text } } }));
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: { type: 'text_delta', delta: text } } }));
  }

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString('utf8');
    if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: receivedJournalEntry('stdout', text) }));
    if (streamFormat === 'plain') {
      if (text.length > 0) userVisibleOutputSeen = true;
      if (bufferStdoutUntilClose) {
        // Nothing is emitted on *either* channel yet — see this function's doc on why holding the
        // raw echo back matters as much as holding back the chat copy.
        //
        // Whole chunks only: a chunk that would cross the ceiling is dropped entirely rather than
        // sliced to fit, which keeps the accumulator free of half-written multi-byte characters (a
        // `data` event boundary already need not align with one) and makes the kept prefix exactly
        // the bytes some prefix of chunks produced. Everything after the first refusal is dropped
        // too — the point is a hard ceiling on resident bytes, not a best-effort tail.
        const chunkBytes = Buffer.byteLength(text, 'utf8');
        if (droppedStdoutBytes > 0 || bufferedStdoutBytes + chunkBytes > ctx.bufferedStdoutMaxBytes) {
          droppedStdoutBytes += chunkBytes;
          return;
        }
        bufferedStdout += text;
        bufferedStdoutBytes += chunkBytes;
        return;
      }
      enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'stdout', data: { chunk: text } } }));
      enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: { type: 'text_delta', delta: text } } }));
      return;
    }
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'stdout', data: { chunk: text } } }));
    // Before the parser: an ack and the aborted turn's end can share a chunk, and the turn end must
    // see that no interrupt is still waiting (see `keepsStdinOpenAfterTurnEnd`).
    scanForInterruptAcks(text);
    // Non-null: `streamHandler` is only ever null when `streamFormat === 'plain'` (see its
    // construction above), the branch this statement is provably unreachable from.
    streamHandler!.feed({ chunk: text });
  });

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
    cancelRequested = true;
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  } });

  child.on('close', (code, signal) => {
    for (const settle of pendingInterruptAcks.values()) settle(false);
    pendingInterruptAcks.clear();
    void (async () => {
      // Not wrapped in try/catch: all 4 supported parser factories'
      // flush() implementations already internally guard their own
      // JSON.parse/dispatch and degrade a malformed trailing buffered
      // line to a `{type:'raw'}` event rather than throwing (confirmed by
      // reading each of the 4 modules in full — see index.ts module doc). A guard
      // here would be dead code for the fixed, closed set of parsers this
      // driver dispatches to. `streamHandler` is null for `'plain'` (no
      // parser, hence nothing to flush) — `?.` skips it cleanly.
      streamHandler?.flush();
      // Queued before `await emitQueue` so the flushed text is durably appended ahead of
      // `finish()`'s `'end'` event, exactly like every live-path emit already is.
      flushBufferedStdout();
      await emitQueue;
      if (cancelRequested) await cancelUnresolvedToolCalls();
      const subscribedTools = await toolSubscription;
      if (subscribedTools?.kind === 'ok') subscribedTools.unsubscribe();
      unsubscribeCancel();
      // Both of the next two steps are guarded: neither a failed cleanup nor a rejecting host
      // classifier may prevent the terminal transition below — see each helper's own doc.
      await cleanupStagedFilesSafely(ctx);
      const status = bridgeUnavailable ? 'failed' : classifyRunCloseStatus({ cancelRequested, code }, { signal });
      // A bridge failure is not resumable: resuming would start the same CLI with the same bridge.
      const resumable =
        status === 'failed' && !bridgeUnavailable && classifyFailure !== undefined
          ? await classifyFailureSafely(ctx, classifyFailure, {
              runId,
              agentId: def.id,
              code,
              signal: signal ?? null,
              sideEffects: { userVisibleOutputSeen, toolCallSeen },
            })
          : false;
      await lifecycle.finish({ runId, status, code, signal: signal ?? null, resumable }, { ...(capturedSessionId !== undefined ? { sessionRef: capturedSessionId } : {}) });
    })();
  });

  /**
   * A mid-run message: first an `interrupt` control request on the still-open stdin, so the agent
   * stops generating (or abandons the tool it is running) at once instead of finishing its whole
   * reply; then, once the CLI acknowledges, the message as the next user line, which the CLI
   * answers straight away in the same session; then the run's own `user_message` event through the
   * same FIFO as the agent's output, so the message sits in the stream where it took effect.
   * An ack that never comes (an agent that ignores control requests) only delays the write by
   * {@link INTERRUPT_ACK_TIMEOUT_MS}: the CLI then folds the line in at its next step. Once
   * `turn_end` has closed stdin, or the process exits before the ack, there is no session left to
   * reach — `'not-running'`.
   */
  async function sendUserMessage(text: string): Promise<UserMessageDelivery> {
    if (!acceptsMidRunUserMessages({ def: def })) return 'unsupported';
    const stdin = child.stdin;
    if (stdinClosed || !stdin) return 'not-running';
    const requestId = `jini-interrupt-${randomUUID()}`;
    interruptSent = true;
    // Capture before requesting the interrupt. Its result can precede the acknowledgement, or
    // arrive after the next segment starts: neither ordering may cancel that segment's new tools.
    enqueueEmit(async () => {
      await toolSubscription;
      for (const id of interruptedToolCalls) if (!unresolvedToolCalls.has(id)) interruptedToolCalls.delete(id);
      for (const id of unresolvedToolCalls) interruptedToolCalls.add(id);
    });
    const acked = new Promise<boolean>((resolve) => pendingInterruptAcks.set(requestId, resolve));
    stdin.write(`${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } })}\n`, 'utf8');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), INTERRUPT_ACK_TIMEOUT_MS);
    });
    const processAlive = await Promise.race([acked, timedOut]);
    clearTimeout(timer);
    pendingInterruptAcks.delete(requestId);
    if (!processAlive || stdinClosed) return 'not-running';
    stdin.write(`${JSON.stringify(streamJsonUserMessage({ content: [{ type: 'text', text: text }] }))}\n`, 'utf8');
    if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: sentJournalEntry(text) }));
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: { type: 'user_message', id: randomUUID(), text: text } } }));
    return 'delivered';
  }

  return {
    closeStdinOnce,
    recordSentBytes(content: string): void {
      if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: sentJournalEntry(content) }));
    },
    sendUserMessage,
  };
}

/**
 * Whether a def's live process can take another user message mid-run: only a stream-json stdin
 * transport keeps stdin open for more JSONL user lines (see `RuntimeAgentDef.promptInputFormat`).
 * Deliberately not `resolveContinuationTransport`: that answers how a tool result gets back, and
 * reports `'mcp-callback'` for Claude even though its stdin takes user lines all the same.
 */
export function acceptsMidRunUserMessages({ def }: { readonly def: RuntimeAgentDef }): boolean {
  return def.promptViaStdin === true && def.promptInputFormat === 'stream-json';
}

/**
 * How long a mid-run message waits for the CLI to acknowledge its interrupt before being written
 * anyway. Claude Code acks within milliseconds (it answers before the aborted turn's own result);
 * the ceiling only bounds an agent that ignores control requests.
 */
export const INTERRUPT_ACK_TIMEOUT_MS = 5_000;

/** The `request_id` of a stream-json `control_response` line, or `undefined` for anything else. */
function controlResponseRequestId({ line }: { readonly line: string }): string | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed) || parsed.type !== 'control_response' || !isRecord(parsed.response)) return undefined;
    return typeof parsed.response.request_id === 'string' ? parsed.response.request_id : undefined;
  } catch {
    return undefined;
  }
}

/** The stream-json stdin envelope for one user message — the initial prompt and every mid-run one. */
function streamJsonUserMessage({ content }: { readonly content: unknown }): unknown {
  return { type: 'user', message: { role: 'user', content: content } };
}

interface WireAcpLifecycleContext extends TerminateChildTreeDeps {
  readonly runId: string;
  readonly agentId: string;
  readonly child: ChildProcess;
  readonly lifecycle: RunLifecycle;
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string | undefined;
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
  readonly mcpServers: readonly AcpMcpServerInput[] | undefined;
  readonly onPermissionRequest: AcpPermissionHandler | undefined;
  readonly attachAcpSession: typeof attachAcpSession;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
  /** Same seam as `WireChildLifecycleContext.cleanupStagedFiles` — no current ACP def declares `promptViaFile` or `needsAgentLogFile`, so this is always the no-op default in practice today, threaded through for consistency rather than special-cased away. */
  readonly cleanupStagedFiles: () => Promise<void>;
  /** Gap 1's byte-journal (see `continuation/journal.ts`). Covers this wrapper's own raw stdout/stderr forwarding only — the actual ACP prompt delivery happens inside `attachAcpSession`'s own transport, out of this module's direct view, so sent bytes are not journaled on this path (an honestly-scoped v1 gap, not an oversight). */
  readonly journal: RunByteJournal | undefined;
  /** Gap 4's failure classifier — see `ClassifyFailure`'s own doc. `undefined` means every `'failed'` outcome stays `resumable: false`. */
  readonly classifyFailure: ClassifyFailure | undefined;
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
function wireAcpLifecycle(ctx: WireAcpLifecycleContext): AcpSessionController {
  const modelReceipt = createModelReceiptTracker(ctx.model, ctx.modelCatalog?.models);
  const { runId, agentId, child, lifecycle, journal, classifyFailure } = ctx;
  let cancelRequested = false;
  let emitQueue: Promise<void> = Promise.resolve();
  // Gap 5 (session resume) — see wireChildLifecycle's identical local for the full rationale.
  let capturedSessionId: string | undefined;
  // Real `FailureClassificationContext.sideEffects` signals — see that interface's own doc.
  let userVisibleOutputSeen = false;
  let toolCallSeen = false;

  function enqueueEmit(task: () => Promise<unknown>): void {
    emitQueue = emitQueue.then(async () => {
      try {
        await task();
      } catch {
        // A late event racing a terminal lifecycle is intentionally dropped;
        // it must not prevent subsequent queued cleanup from running.
      }
    });
  }

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

  let controller: AcpSessionController | null = null;
  const unsubscribeCancel = lifecycle.onCancelRequested({ runId: runId, listener: () => {
    cancelRequested = true;
    controller?.abort();
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  } });

  child.on('close', (code, signal) => {
    void (async () => {
      await emitQueue;
      unsubscribeCancel();
      // Guarded for the same reasons as the child-driven handler above.
      await cleanupStagedFilesSafely(ctx);
      const status = cancelRequested ? 'cancelled' : controller?.completedSuccessfully() ? 'succeeded' : 'failed';
      const resumable =
        status === 'failed' && classifyFailure !== undefined
          ? await classifyFailureSafely(ctx, classifyFailure, {
              runId,
              agentId,
              code,
              signal: signal ?? null,
              sideEffects: { userVisibleOutputSeen, toolCallSeen },
            })
          : false;
      await lifecycle.finish({ runId, status, code, signal: signal ?? null, resumable }, { ...(capturedSessionId !== undefined ? { sessionRef: capturedSessionId } : {}) });
    })();
  });

  controller = ctx.attachAcpSession({ child, prompt: ctx.prompt, send({ event, payload }) {
      if (event === 'agent') {
        const translation = translateAgentRuntimeEvent({ rawEvent: payload });
        if (translation.kind === 'agent') {
            const receipt = modelReceipt(translation.payload);
            if (receipt) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: receipt } }));
          applyAgentTranslationSideEffects({ payload: translation.payload, sessionId: translation.sessionId, sink: {
            onSessionId: ({ sessionId }) => { capturedSessionId = sessionId; },
            onToolCall: () => { toolCallSeen = true; },
            onUserVisibleOutput: () => { userVisibleOutputSeen = true; },
          } });
          enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: translation.payload } }));
        } else if (translation.kind === 'error') {
          enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'error', data: translation.payload } }));
        }
        return;
      }
      if (event === 'error') {
        enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'error', data: translateAcpError(payload) } }));
      }
    } }, { cwd: ctx.cwd, ...(ctx.model !== undefined ? { model: ctx.model } : {}), ...(ctx.imagePaths.length > 0 ? { imagePaths: [...ctx.imagePaths] } : {}), ...(ctx.envFormat !== undefined ? { envFormat: ctx.envFormat } : {}),
    // Spread-when-present rather than always: passing `mcpServers: []` is not the same as passing
    // nothing for every downstream ACP agent, and "no bridge configured" must stay byte-identical
    // to before this field existed.
    ...(ctx.mcpServers !== undefined && ctx.mcpServers.length > 0 ? { mcpServers: [...ctx.mcpServers] } : {}), ...(ctx.onPermissionRequest !== undefined ? { onPermissionRequest: ctx.onPermissionRequest } : {}) });
  return controller;
}

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
  readonly attachPiRpcSession: typeof attachPiRpcSession;
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
function wirePiRpcLifecycle(ctx: WirePiRpcLifecycleContext): PiRpcSession {
  const modelReceipt = createModelReceiptTracker(ctx.model, ctx.modelCatalog?.models);
  const { runId, agentId, child, lifecycle, journal, classifyFailure } = ctx;
  let cancelRequested = false;
  let emitQueue: Promise<void> = Promise.resolve();
  // Gap 5 (session resume) — see wireChildLifecycle's identical local for the full rationale.
  let capturedSessionId: string | undefined;
  // Real `FailureClassificationContext.sideEffects` signals — see that interface's own doc.
  let userVisibleOutputSeen = false;
  let toolCallSeen = false;

  function enqueueEmit(task: () => Promise<unknown>): void {
    emitQueue = emitQueue.then(async () => {
      try {
        await task();
      } catch {
        // A late event racing a terminal lifecycle is intentionally dropped;
        // it must not prevent subsequent queued cleanup from running.
      }
    });
  }

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

  let session: PiRpcSession | null = null;
  const unsubscribeCancel = lifecycle.onCancelRequested({ runId: runId, listener: () => {
    cancelRequested = true;
    session?.abort();
    void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
  } });

  child.on('close', (code, signal) => {
    void (async () => {
      await emitQueue;
      unsubscribeCancel();
      // Guarded for the same reasons as the child-driven handler above.
      await cleanupStagedFilesSafely(ctx);
      const status = cancelRequested ? 'cancelled' : session?.hasFatalError() ? 'failed' : 'succeeded';
      const resumable =
        status === 'failed' && classifyFailure !== undefined
          ? await classifyFailureSafely(ctx, classifyFailure, {
              runId,
              agentId,
              code,
              signal: signal ?? null,
              sideEffects: { userVisibleOutputSeen, toolCallSeen },
            })
          : false;
      await lifecycle.finish({ runId, status, code, signal: signal ?? null, resumable }, { ...(capturedSessionId !== undefined ? { sessionRef: capturedSessionId } : {}) });
    })();
  });

  session = ctx.attachPiRpcSession({ child: ctx.child, prompt: ctx.prompt, send({ payload }) {
      const translation = translateAgentRuntimeEvent({ rawEvent: payload });
      if (translation.kind === 'agent') {
            const receipt = modelReceipt(translation.payload);
            if (receipt) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: receipt } }));
        if (translation.sessionId !== undefined) capturedSessionId = translation.sessionId;
        if (translation.payload.type === 'tool_use') {
          toolCallSeen = true;
        } else if (
          (translation.payload.type === 'text_delta' || translation.payload.type === 'thinking_delta') &&
          translation.payload.delta.length > 0
        ) {
          userVisibleOutputSeen = true;
        }
        enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: translation.payload } }));
      } else if (translation.kind === 'error') {
        enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'error', data: translation.payload } }));
      }
    } }, { cwd: ctx.cwd, ...(ctx.model !== undefined ? { model: ctx.model } : {}), ...(ctx.imagePaths.length > 0 ? { imagePaths: [...ctx.imagePaths] } : {}), ...(ctx.uploadRoot !== undefined ? { uploadRoot: ctx.uploadRoot } : {}) });
  return session;
}

/**
 * Writes the initial user turn to the child's stdin per `def.promptInputFormat`
 * (both branches only run for `promptViaStdin: true` defs — the only shape
 * `run()` supports in v1, see index.ts module doc):
 * - `'text'` (default): the raw prompt buffer, then stdin is closed —
 *   matches `RuntimeAgentDef.promptInputFormat`'s own doc.
 * - `'stream-json'`: one JSONL line wrapping the prompt as an Anthropic
 *   user message; stdin is deliberately left open so a message the human
 *   sends mid-run can follow it (`StdinCloseHandle.sendUserMessage`), and
 *   {@link wireChildLifecycle}'s `turn_end` handling closes it once the
 *   agent's own stream reports the turn ended.
 * @param def - The resolved agent def (only `.promptInputFormat` is read).
 * @param child - The spawned child (no-ops if `.stdin` is unexpectedly absent).
 * @param prompt - The composed user turn.
 * @param handle - Shared stdin-close guard so a `'text'` write's immediate close and a later `turn_end` close never race into a double-`end()`; also carries gap 1's byte-journal recorder (see `StdinCloseHandle.recordSentBytes`).
 * @complexity O(1) plus the underlying stream write's own cost.
 * @overallScore 100/100
 */
export function writePromptToStdin(def: RuntimeAgentDef, child: ChildProcess, prompt: string, handle: StdinCloseHandle): void {
  const stdin = child.stdin;
  if (!stdin) return;
  if (def.promptInputFormat === 'stream-json') {
    const line = JSON.stringify(streamJsonUserMessage({ content: messageContentWithImages({ prompt, images: handle.imageContents ?? [] }, {}) }));
    stdin.write(`${line}\n`, 'utf8');
    handle.recordSentBytes(prompt);
    return;
  }
  stdin.write(prompt, 'utf8');
  handle.recordSentBytes(prompt);
  handle.closeStdinOnce();
}

interface RunAcpDispatchInput {
  readonly runId: string;
  readonly agentId: string;
  readonly child: ChildProcess;
  readonly prompt: string;
  readonly cwd: string;
  readonly model: string | undefined;
  readonly modelCatalog?: ModelCatalogSnapshot;
  readonly imagePaths: readonly string[];
  readonly envFormat: 'array' | 'map' | undefined;
  readonly mcpBridge: McpBridgeDelivery | null;
}

interface RunAcpDispatchDeps extends TerminateChildTreeDeps {
  readonly lifecycle: RunLifecycle;
  readonly attachAcpSession: typeof attachAcpSession;
  readonly onPermissionRequest: AcpPermissionHandler | undefined;
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
      runId: input.runId,
      agentId: input.agentId,
      child: input.child,
      lifecycle: deps.lifecycle,
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
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
    await deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not attach ACP session for agent "${input.agentId}": ${errorMessage(err)}` },
    );
  }
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
  readonly attachPiRpcSession: typeof attachPiRpcSession;
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
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not attach pi-rpc session for agent "${input.agentId}": ${errorMessage(err)}` },
    );
  }
}
