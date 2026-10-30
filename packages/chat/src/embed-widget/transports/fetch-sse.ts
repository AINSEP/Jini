import type { AgentEvent } from '../../core/events.js';
import type { ChatMessage } from '../../core/messages.js';
import type { ChatTransport, RunHandlers, StartRunInput } from '../../core/transport.js';

export interface DecodedSseFrame { readonly event: string | null; readonly data: string }
/** Structurally satisfied by the existing agent-runtime decodeSseStream; host binds it. */
export type SseDecoderPort = (args: { source: AsyncIterable<Uint8Array | string> }) => AsyncIterable<DecodedSseFrame>;
export interface HistoryTurn { readonly role: ChatMessage['role']; readonly content: string }
export interface FetchSseRequest {
  readonly endpoint: string;
  readonly agentId: string;
  readonly message: string;
  readonly history: readonly HistoryTurn[];
  readonly input: StartRunInput;
}
export type FetchSseFrameResult = { readonly event?: AgentEvent; readonly error?: Error; readonly done?: boolean };
export interface FetchSseTransportArgs {
  readonly endpoint: string;
  readonly agentId: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly ids: (args: Record<string, never>) => string;
  readonly decode: SseDecoderPort;
  readonly requestBuilder: (args: FetchSseRequest) => RequestInit;
  readonly frameMapper: (args: { frame: DecodedSseFrame }) => FetchSseFrameResult;
  readonly maxHistoryMessages: number;
  readonly maxHistoryMessageChars: number;
  readonly copy: {
    readonly noUserMessage: string;
    readonly missingBody: string;
    readonly requestFailed: (args: { status: number }) => string;
  };
}
export interface FetchSseTransportOptions {
  readonly createAbortController?: (args: Record<string, never>) => AbortController;
  readonly onLifecycle?: (args: { runId: string; phase: 'started' | 'settled' | 'error' | 'aborted' }) => void;
}
/** Default JSON wire request is an explicit host choice, never a hidden endpoint default. O(history). */
export function buildJsonChatRequest({ message, history }: FetchSseRequest): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history }) };
}
/** Maps the text/error/end/directive JSON protocol with required directive vocabulary and copy. O(data). */
export function mapJsonChatSseFrame({ frame, directiveEventName, streamError }: {
  frame: DecodedSseFrame; directiveEventName: string; streamError: string;
}): FetchSseFrameResult {
  if (!frame.data) return {};
  const data: unknown = JSON.parse(frame.data);
  const obj = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  switch (frame.event) {
    case 'text':
      if (typeof obj.delta !== 'string') throw new Error('Invalid text frame');
      return { event: { kind: 'text', text: obj.delta } };
    case 'error': return { error: new Error(nonEmptyString(obj.message) ?? streamError) };
    case 'end': return { done: true };
    default: return frame.event === directiveEventName ? { event: { kind: 'ext', name: directiveEventName, data } } : {};
  }
}
const nonEmptyString = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
async function* responseChunks(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    try { await reader.cancel(); } catch { /* Already closed or aborted. */ }
    reader.releaseLock();
  }
}
/**
 * Creates a cancellable, one-POST-per-run transport with no reattachable server state.
 * Uses the host-bound SSE decoder rather than implementing another parser. Every run
 * owns its controller, listeners and event log; cancellation and end settle once and
 * prevent late events. Input and cancelSignal aborts release readers/listeners, and frames after
 * end cannot mutate the settled reply. A later settlement clears an earlier pending directive.
 * Default request bytes retain the {message, history} wire shape; a host requestBuilder may carry
 * required agent identity differently. No browser module imports a Node-backed runtime barrel.
 * The returned positional methods implement the existing ChatTransport.
 * @complexity O(history + streamed bytes + emitted events); O(emitted events + decoder buffer) space.
 */
export function createFetchSseTransport(args: FetchSseTransportArgs, options: FetchSseTransportOptions = {}): ChatTransport {
  for (const limit of [args.maxHistoryMessages, args.maxHistoryMessageChars]) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid history limit');
  }
  if (!args.endpoint || !args.agentId) throw new Error('Endpoint and agent identity are required');
  const activeRuns = new Map<string, AbortController>();
  const observe = (runId: string, phase: RunPhase) => {
    try { options.onLifecycle?.({ runId, phase }); } catch { /* Telemetry cannot break a run. */ }
  };
  return {
    async startRun(input, handlers) {
      const latestIndex = latestUserIndex(input.history);
      const message = input.history[latestIndex]?.content;
      if (!message) throw new Error(args.copy.noUserMessage);
      const history = priorHistory({ history: input.history, latestIndex, maxMessages: args.maxHistoryMessages, maxChars: args.maxHistoryMessageChars });
      // Build before registering a run, so a synchronous host-builder failure leaks no state.
      const request = args.requestBuilder({ endpoint: args.endpoint, agentId: args.agentId, message, history, input });
      const runId = args.ids({});
      if (!runId || activeRuns.has(runId)) throw new Error('Run ID must be unique and nonempty');
      const controller = options.createAbortController?.({}) ?? new AbortController();
      activeRuns.set(runId, controller);
      const run = openRun({ controller, input, handlers },
        { observe: phase => observe(runId, phase), release: () => activeRuns.delete(runId) });
      void pumpRun({ run, args, request });
      return { runId };
    },
    async reattachRun(_runId, handlers) { handlers.onDone([]); },
    async fetchRunStatus() { return null; },
    async stopRun(runId) { activeRuns.get(runId)?.abort(); },
  };
}

type RunPhase = 'started' | 'settled' | 'error' | 'aborted';
/** One run's settle-once state: its controller, listeners and collected event log. */
interface ActiveRun {
  readonly controller: AbortController;
  readonly handlers: RunHandlers;
  readonly collected: AgentEvent[];
  isSettled(): boolean;
  finish(): void;
  report(error: Error): void;
}

function latestUserIndex(history: readonly ChatMessage[]): number {
  let index = history.length - 1;
  while (index >= 0 && history[index]?.role !== 'user') index -= 1;
  return index;
}

/** Prior turns only (the latest user turn travels as `message`), non-empty, count- and char-bounded. */
function priorHistory({ history, latestIndex, maxMessages, maxChars }: {
  history: readonly ChatMessage[]; latestIndex: number; maxMessages: number; maxChars: number;
}): HistoryTurn[] {
  return (maxMessages === 0 ? [] : history.slice(Math.max(0, latestIndex - maxMessages), latestIndex))
    .filter(m => m.content.trim().length > 0)
    .map(m => ({ role: m.role, content: m.content.slice(0, maxChars) }));
}

/** Wires abort listeners and returns the settle-once handle; an already-aborted signal aborts at once. */
function openRun({ controller, input, handlers }: { controller: AbortController; input: StartRunInput; handlers: RunHandlers },
  { observe, release }: { observe: (phase: RunPhase) => void; release: () => void }): ActiveRun {
  const collected: AgentEvent[] = [];
  let settled = false;
  const signals = [input.signal, ...(input.cancelSignal ? [input.cancelSignal] : [])];
  const finish = () => {
    if (settled) return;
    settled = true;
    release();
    for (const signal of signals) signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAborted);
    observe('settled');
    handlers.onDone([...collected]);
  };
  const onAborted = () => { observe('aborted'); finish(); };
  const abort = () => controller.abort();
  controller.signal.addEventListener('abort', onAborted, { once: true });
  for (const signal of signals) signal.addEventListener('abort', abort, { once: true });
  observe('started');
  if (signals.some(signal => signal.aborted)) abort();
  const report = (error: Error) => { observe('error'); handlers.onError(error); };
  return { controller, handlers, collected, isSettled: () => settled, finish, report };
}

/** Performs the POST and streams frames; always settles the run exactly once when it returns. */
async function pumpRun({ run, args, request }: { run: ActiveRun; args: FetchSseTransportArgs; request: RequestInit }): Promise<void> {
  try {
    if (run.isSettled()) return;
    const response = await args.fetch(args.endpoint, { ...request, signal: run.controller.signal });
    await deliverResponse({ run, args, response });
  } catch (error) {
    if (!run.isSettled() && !run.controller.signal.aborted) run.report(error instanceof Error ? error : new Error(String(error)));
  } finally { run.finish(); }
}

async function deliverResponse({ run, args, response }: { run: ActiveRun; args: FetchSseTransportArgs; response: Response }): Promise<void> {
  if (run.isSettled()) { try { await response.body?.cancel(); } catch { /* closed body */ } return undefined; }
  if (!response.ok) return reportHttpFailure({ run, response, requestFailed: args.copy.requestFailed });
  if (!response.body) throw new Error(args.copy.missingBody);
  for await (const frame of args.decode({ source: responseChunks(response.body, run.controller.signal) })) {
    if (run.isSettled() || !dispatchFrame({ run, result: args.frameMapper({ frame }) })) break;
  }
  return undefined;
}

async function reportHttpFailure({ run, response, requestFailed }: {
  run: ActiveRun; response: Response; requestFailed: FetchSseTransportArgs['copy']['requestFailed'];
}): Promise<void> {
  const body: unknown = await response.json().catch(() => null);
  if (run.isSettled()) return;
  const serverError = typeof body === 'object' && body !== null && 'error' in body ? nonEmptyString(body.error) : undefined;
  run.report(new Error(serverError ?? requestFailed({ status: response.status })));
}

/** Delivers one mapped frame; returns false once the run is settled (by a handler or an end frame). */
function dispatchFrame({ run, result }: { run: ActiveRun; result: FetchSseFrameResult }): boolean {
  if (result.event) { run.collected.push(result.event); run.handlers.onEvent(result.event); }
  if (run.isSettled()) return false;
  if (result.error) run.report(result.error);
  if (run.isSettled() || result.done) { run.finish(); return false; }
  return true;
}
