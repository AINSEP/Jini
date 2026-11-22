import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
export async function withAcceptanceCancellation<T>(
  { signal, start, cancel }: { signal?: AbortSignal; start: () => Promise<T>; cancel: () => Promise<void> }, _optional = {},
): Promise<T> {
  const stopped = () => { void cancel().catch((error: unknown) => console.error("[assistant] Could not cancel the run", describeErrorForLog({ err: error }))); };
  signal?.addEventListener("abort", stopped, { once: true });
  try { return await start(); }
  finally {
    signal?.removeEventListener("abort", stopped);
    // The stop request can beat acceptance. Retry after the start response (or its loss), keyed
    // by message identity rather than a daemon id the browser may never have received.
    if (signal?.aborted) await cancel().catch((error: unknown) => console.error("[assistant] Could not cancel the accepted run", describeErrorForLog({ err: error })));
  }
}
