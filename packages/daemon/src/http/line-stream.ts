/**
 * @file An answer written one JSON value per line while work is still running (a tool's surfaces,
 * then its result). The headers leave as soon as the route returns the response, which is before
 * the work finishes; the caller reads lines as they are written.
 */
import type { SseSchedulerPort } from '@jini-ai/core/contracts/server';

export interface LineStream {
  /** The 200 answer whose body is the lines. Return it from the route before the work completes. */
  readonly response: Response;
  /** Writes `line` as one JSON line. A no-op once the stream has ended or the caller has gone. */
  write(required: { readonly line: unknown }, optional?: Record<string, never>): void;
  /** Ends the answer after the lines already written. Idempotent. */
  end(): void;
  /** Aborts when the caller goes away (its signal aborts or it stops reading). Not aborted by {@link LineStream.end}. */
  readonly signal: AbortSignal;
}

const LINE_STREAM_HEADERS = { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } as const;
const KEEPALIVE_LINE = { type: 'keepalive' } as const;

/**
 * @param required.signal - Aborts when the caller goes away (a request's `signal`, or one the host derives from its connection).
 * @param optional.keepAliveMs - Write `{"type":"keepalive"}` this often while open. Left out: nothing is written between lines and no timer is scheduled.
 * @complexity O(1) per line. Lines are queued without a cap until the caller reads them, as they were before; callers write a handful of lines per request.
 */
export function createLineStream(
  { scheduler, signal }: { readonly scheduler: SseSchedulerPort; readonly signal: AbortSignal },
  { keepAliveMs }: { readonly keepAliveMs?: number } = {},
): LineStream {
  const encoder = new TextEncoder();
  const gone = new AbortController();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let open = true;
  let keepAlive: unknown;

  const close = ({ callerLeft }: { callerLeft: boolean }): void => {
    if (!open) return;
    open = false;
    if (keepAlive !== undefined) scheduler.cancel({ handle: keepAlive });
    // Remove the request abort listener on close so finished calls do not retain it.
    signal.removeEventListener('abort', onCallerGone);
    if (callerLeft) gone.abort();
    controller?.close();
  };
  const onCallerGone = (): void => { close({ callerLeft: true }); };
  const write = ({ line }: { readonly line: unknown }): void => {
    if (open) controller?.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
  };

  const body = new ReadableStream<Uint8Array>({
    start: (streamController) => { controller = streamController; },
    // A cancelled body is already closed; closing it again would throw.
    cancel: () => { controller = undefined; close({ callerLeft: true }); },
  });
  if (signal.aborted) onCallerGone();
  else signal.addEventListener('abort', onCallerGone, { once: true });
  if (open && keepAliveMs !== undefined) keepAlive = scheduler.every({ callback: () => write({ line: KEEPALIVE_LINE }), intervalMs: keepAliveMs });

  return { response: new Response(body, { status: 200, headers: LINE_STREAM_HEADERS }), write, end: () => close({ callerLeft: false }), signal: gone.signal };
}
