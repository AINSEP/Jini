import type { AgentEvent } from '../../core/events.js';
import type { ChatMessage } from '../../core/messages.js';
import type { ChatTransport, StartRunInput } from '../../core/transport.js';

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
  if (frame.event === 'text') {
    if (typeof obj.delta !== 'string') throw new Error('Invalid text frame');
    return { event: { kind: 'text', text: obj.delta } };
  }
  if (frame.event === 'error') return { error: new Error(typeof obj.message === 'string' && obj.message ? obj.message : streamError) };
  if (frame.event === 'end') return { done: true };
  if (frame.event === directiveEventName) return { event: { kind: 'ext', name: directiveEventName, data } };
  return {};
}
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
  const observe = (runId: string, phase: 'started' | 'settled' | 'error' | 'aborted') => {
    try { options.onLifecycle?.({ runId, phase }); } catch { /* Telemetry cannot break a run. */ }
  };
  return {
    async startRun(input, handlers) {
      let latestIndex = input.history.length - 1;
      while (latestIndex >= 0 && input.history[latestIndex]?.role !== 'user') latestIndex -= 1;
      const message = input.history[latestIndex]?.content;
      if (!message) throw new Error(args.copy.noUserMessage);
      const history = (args.maxHistoryMessages === 0 ? [] : input.history.slice(Math.max(0, latestIndex - args.maxHistoryMessages), latestIndex))
        .filter(m => m.content.trim().length > 0)
        .map(m => ({ role: m.role, content: m.content.slice(0, args.maxHistoryMessageChars) }));
      // Build before registering a run, so a synchronous host-builder failure leaks no state.
      const request = args.requestBuilder({ endpoint: args.endpoint, agentId: args.agentId, message, history, input });
      const runId = args.ids({});
      if (!runId || activeRuns.has(runId)) throw new Error('Run ID must be unique and nonempty');
      const controller = options.createAbortController?.({}) ?? new AbortController();
      activeRuns.set(runId, controller);
      const collected: AgentEvent[] = [];
      let settled = false;
      const signals = [input.signal, ...(input.cancelSignal ? [input.cancelSignal] : [])];
      const finish = () => {
        if (settled) return;
        settled = true;
        activeRuns.delete(runId);
        for (const signal of signals) signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', onAborted);
        observe(runId, 'settled');
        handlers.onDone([...collected]);
      };
      const onAborted = () => { observe(runId, 'aborted'); finish(); };
      const abort = () => controller.abort();
      controller.signal.addEventListener('abort', onAborted, { once: true });
      for (const signal of signals) signal.addEventListener('abort', abort, { once: true });
      observe(runId, 'started');
      if (signals.some(signal => signal.aborted)) abort();
      void (async () => {
        try {
          if (settled) return;
          const response = await args.fetch(args.endpoint, { ...request, signal: controller.signal });
          if (settled) { try { await response.body?.cancel(); } catch { /* closed body */ } return; }
          if (!response.ok) {
            const body: unknown = await response.json().catch(() => null);
            if (settled) return;
            const error = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string' && body.error
              ? body.error : args.copy.requestFailed({ status: response.status });
            observe(runId, 'error');
            handlers.onError(new Error(error));
            return;
          }
          if (!response.body) throw new Error(args.copy.missingBody);
          for await (const frame of args.decode({ source: responseChunks(response.body, controller.signal) })) {
            if (settled) break;
            const result = args.frameMapper({ frame });
            if (result.event) { collected.push(result.event); handlers.onEvent(result.event); }
            if (settled) break;
            if (result.error) { observe(runId, 'error'); handlers.onError(result.error); }
            if (settled) break;
            if (result.done) { finish(); break; }
          }
        } catch (error) {
          if (!settled && !controller.signal.aborted) {
            observe(runId, 'error');
            handlers.onError(error instanceof Error ? error : new Error(String(error)));
          }
        } finally { finish(); }
      })();
      return { runId };
    },
    async reattachRun(_runId, handlers) { handlers.onDone([]); },
    async fetchRunStatus() { return null; },
    async stopRun(runId) { activeRuns.get(runId)?.abort(); },
  };
}
