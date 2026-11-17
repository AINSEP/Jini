/**
 * @module @jini-ai/mcp/server/call-progress
 * A keepalive for one `tools/call`: while the handler waits, send `notifications/progress` to the
 * client that asked for progress, so a CLI that resets its own tool-call timeout on progress keeps
 * waiting. It is a transport signal to that CLI only. It never reaches the daemon's executor, so it
 * cannot extend the human-approval window or make a late answer valid.
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
  repeat: ({ callback, intervalMs }) => {
    const handle = setInterval(callback, intervalMs);
    handle.unref();
    return handle;
  },
  cancel: ({ handle }) => clearInterval(handle as ReturnType<typeof setInterval>),
};

// stdout carries the protocol; the console logger writes to stderr.
const hostLogger = createConsoleLogger({ prefix: '[jini-mcp]' });

/**
 * Starts the pump when the client sent a progress token and a way to answer it; otherwise does nothing.
 * Frames carry the token, a count and the word "waiting": never tool output, arguments or ids.
 * A failed send ends the pump for this call and is logged once; the tool result is unaffected.
 * @returns `stop()`, idempotent; call it when the handler settles. An abort of `extra.signal` also stops it.
 */
export function startCallProgress(
  { extra }: { extra: CallProgressExtra | undefined },
  { scheduler = realScheduler, intervalMs = DEFAULT_CALL_PROGRESS_INTERVAL_MS, logger = hostLogger }: { scheduler?: CallProgressScheduler; intervalMs?: number; logger?: Logger } = {},
): { stop(): void } {
  const progressToken = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  const signal = extra?.signal;
  if (progressToken === undefined || send === undefined || signal?.aborted) return { stop: () => {} };
  let progress = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    scheduler.cancel({ handle });
    signal?.removeEventListener('abort', stop);
  };
  const handle = scheduler.repeat({
    intervalMs,
    callback: () => {
      progress += 1;
      const sending = async () => send({ method: 'notifications/progress', params: { progressToken, progress, message: 'waiting' } });
      sending().catch((error: unknown) => {
        stop();
        logger.warn({ message: 'progress notification failed; this call sends no more progress' }, { error });
      });
    },
  });
  signal?.addEventListener('abort', stop, { once: true });
  return { stop };
}
