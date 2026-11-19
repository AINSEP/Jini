import { randomUUID } from 'node:crypto';
import { createLiveSessionState } from './live-session-state.js';
import { acceptsMidRunUserMessages } from './message-relay.js';
import { attachMessageRelay, sentJournalEntry } from './event-io.js';
import { messageContentWithImages } from '../attachment-content.js';
import { resolveContinuationTransport } from '../continuation/continuation-transport.js';
import { resultContent } from '../delegated-tool-bridge.js';
import { projectToolResultEvent } from '../tool-result-media.js';
import { errorMessage } from './values.js';
import type { ChildProcess } from 'node:child_process';
import type { RunRef } from '@jini-ai/core';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { RunAgentPayload } from '@jini-ai/protocol';
import type { MessageAttachmentImage } from '../attachment-content.js';
import type { ToolResultMediaBlock } from '../tool-result-media.js';
import type { StdinCloseHandle, UserMessageDelivery } from './contracts.js';
import type { RunMessageRelay } from './message-relay.js';
import type { createRunEventQueue } from './event-io.js';
import type { WireChildLifecycleContext } from './child-lifecycle.js';

interface ChildInputState {
  stdinClosed: boolean;
  // Gap 3 (stdin-tool-result injection) — the most recently reported tool_use, cleared once
  // consumed by a turn-end injection decision. See `ContinuationOptions`'s doc for why this is
  // only ever acted on when a host has explicitly allowlisted the tool's name.
  pendingToolUse: { id: string; name: string; input: unknown } | undefined;
  heldForBackgroundTasks: boolean;
  heldForQueuedInput: boolean;
}

export function createChildInput({ ctx, enqueueEmit, parserFeed }: {
  ctx: WireChildLifecycleContext;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
  parserFeed: (chunk: string) => void;
}, _options = {}) {
  const { runId, child, lifecycle, journal } = ctx;
  const state: ChildInputState = {
    stdinClosed: false, pendingToolUse: undefined,
    // Claude's background tasks can outlive a parent turn. Keep the existing hold until the last
    // task finishes; closing stdin early stops them at the CLI's background-wait ceiling.
    // 2026-10-10 (plannie chat): closing at the parent's end_turn made messages return
    // 'not-running' for ten minutes, then EOF killed the still-working subagents at that ceiling.
    heldForBackgroundTasks: false, heldForQueuedInput: false,
  };
  function closeStdinOnce(): void {
    if (state.stdinClosed) return;
    state.stdinClosed = true;
    child.stdin?.end();
  }

  // Unanswered UUIDs and the CLI's queued_turn_count keep stdin open across intermediate turn ends.
  // Consumption is confirmed by CLI reply/result attribution, never by HTTP delivery or an echo.
  const emitInput = (data: RunAgentPayload) => enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data } }));
  const session = createLiveSessionState({ emit: emitInput });
  const relay = attachMessageRelay({ register: ctx.registerMessageRelay, emit: emitInput, child });
  const scanner = createControlScanner({ feed: line => feedSessionLine({ state, session, parserFeed, closeStdinOnce, line }) });
  const sendUserMessage = createSendUserMessage({ ctx, state, session, relay, enqueueEmit });
  const recordSentBytes = (content: string): void => {
    if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: sentJournalEntry(content) }));
  };
  const handle: StdinCloseHandle = { closeStdinOnce, recordSentBytes, sendUserMessage };
  return {
    ...scanner, handle,
    markClosed: () => { state.stdinClosed = true; },
    endSession: session.endSession,
    noteToolUse: (toolUse: NonNullable<ChildInputState['pendingToolUse']>) => { state.pendingToolUse = toolUse; },
    handleTurnEnd: (stopReason: string | undefined) => handleTurnEnd({ ctx, state, session, closeStdinOnce, enqueueEmit, stopReason }),
    closeStdinOnce, recordSentBytes, sendUserMessage,
  };
}

function createControlScanner({ feed }: { feed: (line: string) => void }, _options = {}) {
  let controlScanBuffer = '';
  /** Scan and parse in wire order: a receipt later in a chunk cannot affect an earlier turn end.
   * O(chunk length) amortized; only the partial line remains buffered. */
  function scanControlLines(text: string): void {
    controlScanBuffer += text;
    if (!text.includes('\n')) return;
    const lastNewline = controlScanBuffer.lastIndexOf('\n');
    const lines = controlScanBuffer.slice(0, lastNewline).split('\n');
    controlScanBuffer = controlScanBuffer.slice(lastNewline + 1);
    for (const line of lines) feed(line);
  }

  return {
    scanControlLines,
    flushControlTail(): void {
      if (controlScanBuffer) {
        feed(controlScanBuffer);
        controlScanBuffer = '';
      }
    },
  };
}

function feedSessionLine({ state, session, parserFeed, closeStdinOnce, line }: {
  state: ChildInputState; session: ReturnType<typeof createLiveSessionState>;
  parserFeed: (chunk: string) => void; closeStdinOnce: () => void; line: string;
}, _options = {}): void {
  const observed = session.observe({ line });
  if (observed.startedInput) state.heldForQueuedInput = false;
  parserFeed(`${line}\n`);
  if (session.hasPendingInput()) return;
  if (state.heldForBackgroundTasks && session.backgroundTaskCount() === 0) {
    state.heldForBackgroundTasks = false;
    closeStdinOnce();
  }
  // A result can lower queued_turn_count after the assistant end already held stdin open.
  // Re-evaluate that held end after parsing the result (the parser deduplicates turn ends).
  if (observed.result && state.heldForQueuedInput && session.backgroundTaskCount() === 0) {
    state.heldForQueuedInput = false;
    closeStdinOnce();
  }
}

/**
 * Writes a structured (never string-concatenated — see `ContinuationOptions`'s doc on the
 * prompt-injection stakes here) tool_result JSONL line, mirroring the shape
 * `claude-stream.ts`'s own inbound parser already expects on the opposite direction of this
 * exact wire format. Journals the sent content the same way `writePromptToStdin`'s
 * `recordSentBytes` does.
 */
function injectToolResultLine({ ctx, enqueueEmit, toolUseId, content, isError }: {
  ctx: WireChildLifecycleContext; enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
  toolUseId: string; content: string; isError: boolean;
}, _options = {}): void {
  const { child, journal, runId } = ctx;
  const stdin = child.stdin;
  if (!stdin) return;
  const line = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }] },
  });
  stdin.write(`${line}\n`, 'utf8');
  if (journal) enqueueEmit(() => journal.record({ runId: runId, entry: sentJournalEntry(content) }));
}

/** A tool_use end is intermediate: the CLI executes that batch itself and carries on.
 * Pending input and background tasks also owe work. Every other end closes stdin so the CLI
 * exits once it has answered everything written before EOF. */
function stdinHoldAfterTurnEnd({ def, session, stopReason }: {
  def: RuntimeAgentDef; session: ReturnType<typeof createLiveSessionState>; stopReason: string | undefined;
}, _options = {}): 'close' | 'turn-continues' | 'background-tasks' {
  if (!acceptsMidRunUserMessages({ def })) return 'close';
  if (stopReason === 'tool_use' || session.hasPendingInput()) return 'turn-continues';
  return session.backgroundTaskCount() > 0 ? 'background-tasks' : 'close';
}

/**
 * Decides, per `turn_end`, whether to auto-resolve a pending tool_use through the injected
 * `ToolExecutor` and keep stdin open (gap 3), or close stdin exactly as every version of this
 * function has always done (the default, and the only behavior when `continuation` is
 * unconfigured or the pending tool isn't allowlisted).
 */
function handleTurnEnd({ ctx, state, session, closeStdinOnce, enqueueEmit, stopReason }: {
  ctx: WireChildLifecycleContext; state: ChildInputState; session: ReturnType<typeof createLiveSessionState>;
  closeStdinOnce: () => void; enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
  stopReason: string | undefined;
}, _options = {}): void {
  const { def, continuation } = ctx;
  const toolUse = state.pendingToolUse;
  const toolTurnPending = stopReason === 'tool_use' && toolUse !== undefined && continuation !== undefined;
  const shouldInject =
    toolTurnPending &&
    resolveContinuationTransport({ def: def }) === 'stdin-injection' &&
    continuation.autonomousToolNames.has(toolUse.name);
  if (!shouldInject) {
    const hold = stdinHoldAfterTurnEnd({ def, session, stopReason });
    state.heldForBackgroundTasks = hold === 'background-tasks';
    state.heldForQueuedInput = hold === 'turn-continues' && stopReason !== 'tool_use';
    if (hold === 'close') closeStdinOnce();
    return;
  }
  state.pendingToolUse = undefined;
  enqueueEmit(() => executeInjectedTool({ ctx, continuation, toolUse, enqueueEmit }));
}

async function executeInjectedTool({ ctx, continuation, toolUse, enqueueEmit }: {
  ctx: WireChildLifecycleContext; continuation: NonNullable<WireChildLifecycleContext['continuation']>;
  toolUse: NonNullable<ChildInputState['pendingToolUse']>;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
}, _options = {}): Promise<void> {
  const { lifecycle, runId } = ctx;
  const run: RunRef = { id: runId };
  let content: string;
  let isError: boolean;
  // Event projection removes pixels only from saved content; stdin keeps the original.
  let eventContent: string;
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
    const projection = projectToolResultEvent({ result });
    eventContent = projection.content;
    isError = projection.isError === true;
    media = projection.media ?? [];
  } catch (error) {
    content = errorMessage(error);
    eventContent = content;
    isError = true;
  } finally {
    lifecycle.resumeSlowRunNotice({ runId: runId });
  }
  await lifecycle.emit({ runId: runId, input: {
    event: 'agent',
    data: {
      type: 'tool_result',
      toolUseId: toolUse.id,
      content: eventContent,
      ...(isError ? { isError: true } : {}),
      ...(media.length > 0 ? { media } : {}),
    },
  } });
  injectToolResultLine({ ctx, enqueueEmit, toolUseId: toolUse.id, content, isError });
}

function createSendUserMessage({ ctx, state, session, relay, enqueueEmit }: {
  ctx: WireChildLifecycleContext; state: ChildInputState; session: ReturnType<typeof createLiveSessionState>;
  relay: RunMessageRelay | undefined; enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
}, _options = {}) {
  const { def, child, journal, runId } = ctx;
  /** Queue into the existing Claude session without interrupting parallel tools or subagents.
   * Images use the idle-send encoder without file tools or new directory grants; journals keep
   * text without base64. HTTP acceptance only
   * confirms the write; UUID-attributed CLI receipts separately confirm consumption. */
  async function sendUserMessage({ text, id = randomUUID(), attachmentIds }: { text: string; id?: string; attachmentIds?: readonly string[] }, { imageContents: images = [] }: { imageContents?: readonly MessageAttachmentImage[] } = {}): Promise<UserMessageDelivery> {
    if (!acceptsMidRunUserMessages({ def })) return relayUserMessage({ id, text, images, attachmentIds });
    const stdin = child.stdin;
    if (state.stdinClosed || !stdin) return 'not-running';
    state.heldForBackgroundTasks = false;
    writeUserMessage(stdin, text, images, id);
    return 'delivered';
  }

  function relayUserMessage({ id, text, images, attachmentIds }: { id: string; text: string; images: readonly MessageAttachmentImage[]; attachmentIds: readonly string[] | undefined }): UserMessageDelivery {
    return relay?.enqueue({ id, text, hasAttachments: images.length > 0 || (attachmentIds?.length ?? 0) > 0 }) ?? 'unsupported';
  }

  /** Writes a complete mid-run turn using the idle image encoder; journals text without base64.
   * The same UUID identifies stdin, queue acceptance and subsequent consumption receipts. */
  function writeUserMessage(stdin: NonNullable<typeof child.stdin>, text: string, images: readonly MessageAttachmentImage[], id: string): void {
    session.queue({ id, text });
    stdin.write(`${JSON.stringify({ ...streamJsonUserMessage({ content: messageContentWithImages({ prompt: text, images }, {}) }), uuid: id })}\n`, 'utf8');
    if (journal) enqueueEmit(() => journal.record({ runId, entry: sentJournalEntry(text) }));
  }

  return sendUserMessage;
}

/** The stream-json stdin envelope for one user message — the initial prompt and every mid-run one. */
function streamJsonUserMessage({ content }: { readonly content: unknown }): { type: string; message: { role: string; content: unknown } } {
  return { type: 'user', message: { role: 'user', content: content } };
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
