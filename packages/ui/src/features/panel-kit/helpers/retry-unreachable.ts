/** About 60 seconds of waits spans a short restart/redeploy while still bounding downtime reporting. */
export const UNREACHABLE_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** Duck-type the name: DOMException's instanceof Error result depends on its browser realm. */
export function isAbortError({ error }: { error: unknown }): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/** Clear the timer on abort and detach the listener on completion so unmounts leave no scheduled wait. */
function waitUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("retry cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

/** Retry only errors classified by the injected predicate, within a bounded delay schedule.
 * Abort cancels a pending wait, but the host remains responsible for cancelling its own request. */
export async function retryWhileUnreachable<T>(
  { load, signal, isUnreachable }: { load: () => Promise<T>; signal: AbortSignal; isUnreachable: (error: unknown) => boolean },
  { delaysMs = UNREACHABLE_RETRY_DELAYS_MS, wait = ({ ms, signal }) => waitUnlessAborted(ms, signal) }: { delaysMs?: readonly number[]; wait?: (required: { ms: number; signal: AbortSignal }) => Promise<void> } = {},
): Promise<T> {
  for (const delayMs of delaysMs) {
    try {
      return await load();
    } catch (error) {
      if (!isUnreachable(error)) throw error;
    }
    await wait({ ms: delayMs, signal });
  }
  return load();
}
