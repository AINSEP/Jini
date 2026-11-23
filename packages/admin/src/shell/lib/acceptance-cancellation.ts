import type { ShellFailureLogger } from "./shell-failure-log.js";

/** Cancels a run whose start may still be in flight. `logger` is required: a failed cancel is
 *  reported there (it owns redaction), never to the console. */
export async function withAcceptanceCancellation<T>(
  { signal, start, cancel, logger }: { signal?: AbortSignal; start: () => Promise<T>; cancel: () => Promise<void>; logger: ShellFailureLogger },
  _optional = {},
): Promise<T> {
  const stopped = () => { void cancel().catch((error: unknown) => logger.error({ message: "[assistant] Could not cancel the run" }, { error })); };
  signal?.addEventListener("abort", stopped, { once: true });
  try { return await start(); }
  finally {
    signal?.removeEventListener("abort", stopped);
    // The stop request can beat acceptance. Retry after the start response (or its loss), keyed
    // by message identity rather than a daemon id the browser may never have received.
    if (signal?.aborted) await cancel().catch((error: unknown) => logger.error({ message: "[assistant] Could not cancel the accepted run" }, { error }));
  }
}
