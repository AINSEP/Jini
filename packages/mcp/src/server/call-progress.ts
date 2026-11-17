/**
 * @module @jini-ai/mcp/server/call-progress
 * Keepalive for one `tools/call`: while the handler waits, send `notifications/progress` to a client
 * that asked for it, so a CLI that resets its tool-call timeout on progress keeps waiting. It goes
 * to that CLI only and never reaches the daemon executor, so it cannot extend the approval window.
 */
import { createConsoleLogger, type Logger } from '@jini-ai/core/primitives';

/** Time port so the pump never touches ambient timers; tests pass a fake. */
export interface CallProgressScheduler {
  repeat(required: { callback: () => void; intervalMs: number }): unknown;
  cancel(required: { handle: unknown }): void;
}

/** The two SDK fields and the abort signal this module reads from a request's `extra`. */
export interface CallProgressExtra {
  readonly signal?: AbortSignal | undefined;
  readonly _meta?: { readonly progressToken?: string | number | undefined } | undefined;
  readonly sendNotification?: ((notification: { method: 'notifications/progress'; params: { progressToken: string | number; progress: number; message: string } }) => Promise<void>) | undefined;
}

export const DEFAULT_CALL_PROGRESS_INTERVAL_MS = 25_000;

const realScheduler: CallProgressScheduler = {
  repeat: ({ callback, intervalMs }) => setInterval(callback, intervalMs).unref(),
  cancel: ({ handle }) => clearInterval(handle as ReturnType<typeof setInterval>),
};
// stdout carries the protocol; the console logger writes to stderr.
const hostLogger = createConsoleLogger({ prefix: '[jini-mcp]' });

interface ProgressRequest { token: string | number; send: NonNullable<CallProgressExtra['sendNotification']>; signal: AbortSignal | undefined }

/** The client's token and sender, or null when it asked for no progress or the call is already aborted. */
function readProgressRequest({ extra }: { extra: CallProgressExtra | undefined }): ProgressRequest | null {
  const token = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  const signal = extra?.signal;
  return token === undefined || send === undefined || signal?.aborted ? null : { token, send, signal };
}

/** One tick: send the next frame. The first failed send stops the pump and is logged; later ones in flight are not. */
function createTick({ request, stop, logger }: { request: ProgressRequest; stop: () => void; logger: Logger }): () => void {
  let progress = 0;
  let failureLogged = false;
  return () => {
    progress += 1;
    const sending = async () => request.send({ method: 'notifications/progress', params: { progressToken: request.token, progress, message: 'waiting' } });
    sending().catch((error: unknown) => {
      stop();
      if (failureLogged) return;
      failureLogged = true;
      logger.warn({ message: 'progress notification failed; this call sends no more progress' }, { error });
    });
  };
}

/**
 * Starts the pump when the client sent a progress token and a way to answer it; otherwise `stop` is all there is.
 * Frames carry the token, a count and the word "waiting": never tool output, arguments or ids.
 * @returns `stop()`, idempotent: call it when the handler settles. An abort of `extra.signal` also stops the pump.
 */
export function startCallProgress(
  { extra }: { extra: CallProgressExtra | undefined },
  { scheduler = realScheduler, intervalMs = DEFAULT_CALL_PROGRESS_INTERVAL_MS, logger = hostLogger }: { scheduler?: CallProgressScheduler | undefined; intervalMs?: number | undefined; logger?: Logger | undefined } = {},
): { stop(): void } {
  const request = readProgressRequest({ extra });
  let stopped = request === null;
  let handle: unknown;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    scheduler.cancel({ handle });
    request?.signal?.removeEventListener('abort', stop);
  };
  if (request === null) return { stop };
  handle = scheduler.repeat({ intervalMs, callback: createTick({ request, stop, logger }) });
  request.signal?.addEventListener('abort', stop, { once: true });
  return { stop };
}
