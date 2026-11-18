/**
 * @file Server-Sent Events as a web `Response`: a bounded, pull-based stream any host adapter can
 * write out, with no Node API and no ambient timer (the keepalive scheduler is injected).
 */

/** The minimal shape any event needs to flow through an `SseStream`: a cursor for `Last-Event-ID` reconnect bookkeeping and a `kind` used as the wire `event:` field. */
export interface SseEvent {
  readonly opaqueCursor: string;
  readonly kind: string;
}

/**
 * Cap on events queued for one client. A stalled or malicious client would otherwise let an
 * unbounded producer grow the queue without limit (SEC-006). Once exceeded, the connection is
 * dropped rather than accepting unbounded memory growth.
 */
export const DEFAULT_MAX_QUEUED_SSE_EVENTS = 1000;

/** Keepalive timer the host supplies, so core holds no timer of its own. */
export interface SseSchedulerPort {
  every(required: { callback: () => void; intervalMs: number }, optional?: Record<string, never>): unknown;
  cancel(required: { handle: unknown }, optional?: Record<string, never>): void;
}

/** One open SSE stream: the `Response` to return, and the handle the producer writes through. */
export interface SseStream<E extends SseEvent> {
  readonly response: Response;
  /**
   * Queues one event. A no-op once the stream has closed.
   *
   * `backlog: true` says "this frame is history the caller already holds in memory": it is queued without
   * counting against `maxQueuedEvents`, so a synchronous replay burst larger than the cap is delivered
   * whole instead of dropping the client. The cost is one formatted frame per replayed event held until
   * the client reads it, the same order as the replay the caller already built. Live frames keep the cap.
   */
  send(required: { event: E }, optional?: { readonly backlog?: boolean }): void;
  /** Ends the stream after the frames already queued. Idempotent. */
  end(): void;
  /** `true` once the stream has closed for any reason. */
  readonly closed: boolean;
}

/** Options for {@link createSseStream}. */
export interface SseStreamOptions<E extends SseEvent> {
  /** Aborts the stream (the client left). */
  signal?: AbortSignal;
  /** Queued-frame ceiling before the connection is dropped. Defaults to {@link DEFAULT_MAX_QUEUED_SSE_EVENTS}. */
  maxQueuedEvents?: number;
  /** Milliseconds between keepalive comment frames. Defaults to 15000; `false` schedules no timer and writes nothing while idle. */
  keepAliveMs?: number | false;
  /** Overrides the wire format. Defaults to `id/event/data`. */
  formatEvent?: (required: { event: E }) => string;
  /** When true for an event, the stream ends right after writing it. */
  isEndEvent?: (required: { event: E }) => boolean;
  /** Invoked once, the first time the stream closes for any reason. */
  onClose?: () => void;
  /** Extra response headers. */
  headers?: Readonly<Record<string, string>>;
}

const defaultFormat = <E extends SseEvent>({ event }: { event: E }): string =>
  `id: ${event.opaqueCursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;

/** A queued wire frame, and whether it counts against the live-frame cap (backlog frames do not). */
interface QueuedFrame { readonly text: string; readonly counted: boolean }
interface StreamState { frames: QueuedFrame[]; counted: number; closed: boolean; ending: boolean; wake: (() => void) | undefined }

/**
 * Opens an SSE stream over a pull-based `ReadableStream`: the consumer pulls one frame at a time,
 * so a slow client never makes the queue grow beyond the cap.
 */
export function createSseStream<E extends SseEvent>(
  { scheduler }: { scheduler: SseSchedulerPort },
  options: SseStreamOptions<E> = {},
): SseStream<E> {
  const state: StreamState = { frames: [], counted: 0, closed: false, ending: false, wake: undefined };
  const max = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_SSE_EVENTS;
  const format = options.formatEvent ?? defaultFormat;
  const encoder = new TextEncoder();
  let timer: unknown;
  const close = (): void => {
    if (state.closed) return;
    state.closed = true;
    state.frames.length = 0;
    state.counted = 0;
    if (timer !== undefined) scheduler.cancel({ handle: timer });
    options.onClose?.();
    state.wake?.();
  };
  const push = ({ text, counted }: { text: string; counted: boolean }): void => {
    if (state.closed || state.ending) return;
    // A client that stopped reading is disconnected rather than buffered without limit: a closed
    // stream is an observable signal it can reconnect from, silently dropped frames are not.
    if (counted && state.counted >= max) { close(); return; }
    state.frames.push({ text, counted });
    if (counted) state.counted += 1;
    state.wake?.();
  };
  if (options.keepAliveMs !== false) timer = scheduler.every({ callback: () => push({ text: ': ping\n\n', counted: true }), intervalMs: options.keepAliveMs ?? 15_000 });
  options.signal?.addEventListener('abort', close, { once: true });
  // A client that disconnected while the handler was still setting up never fires 'abort' again.
  if (options.signal?.aborted) close();
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => pullFrame({ state, controller, encoder, close }),
    cancel: close,
  });
  return {
    response: new Response(body, { status: 200, headers: sseHeaders(options.headers) }),
    send({ event }, { backlog = false } = {}) {
      push({ text: format({ event }), counted: !backlog });
      if (options.isEndEvent?.({ event })) state.ending = true;
      if (state.ending) state.wake?.();
    },
    end() { state.ending = true; state.wake?.(); },
    get closed() { return state.closed; },
  };
}

function sseHeaders(extra: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', ...extra };
}

async function pullFrame({ state, controller, encoder, close }: {
  state: StreamState; controller: ReadableStreamDefaultController<Uint8Array>; encoder: { encode(input: string): Uint8Array }; close: () => void;
}): Promise<void> {
  while (!state.closed || state.frames.length > 0) {
    const frame = state.frames.shift();
    if (frame !== undefined) {
      if (frame.counted) state.counted -= 1;
      controller.enqueue(encoder.encode(frame.text));
      return;
    }
    if (state.ending) break;
    await new Promise<void>((resolve) => { state.wake = resolve; });
    state.wake = undefined;
  }
  close();
  controller.close();
}

/** Reads a reconnect cursor from the standard `Last-Event-ID` header, falling back to an `afterCursor` query parameter (the header wins: browsers set it on `EventSource` reconnect). */
export function lastEventCursor({ request }: { readonly request: Request }, _optional: Record<string, never> = {}): string | null {
  const header = request.headers.get('last-event-id');
  if (header && header.length > 0) return header;
  const query = new URL(request.url).searchParams.get('afterCursor');
  return query !== null && query.length > 0 ? query : null;
}
