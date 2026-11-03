/**
 * @module http
 *
 * HTTP readiness polling. Waits for a URL to return an OK response, used to
 * gate on a spawned service becoming reachable. Keeps a private `errorMessage`
 * copy so it owns no cross-module runtime surface.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { fetchWithTimeout } from "./fetch-with-timeout.js";

export type HttpWaitOptions = {
  timeoutMs?: number;
  /** Optional transport policy (for example, a pinned loopback TLS probe). False retries; throwing
   * records the diagnostic and retries. Each call receives the remaining overall time budget.
   */
  probe?: ((required: { url: string; timeoutMs: number }) => Promise<boolean>) | undefined;
};

/** Use the injected transport policy or the existing bounded fetch, retaining HTTP diagnostics.
 * @returns Whether this attempt is ready. @complexity One network request, bounded by timeoutMs.
 */
async function requestHttpOk({ url, timeoutMs }: { url: string; timeoutMs: number }, { probe }: Pick<HttpWaitOptions, "probe"> = {}): Promise<boolean> {
  if (probe) return probe({ url, timeoutMs });
  const response = await fetchWithTimeout(url, { cache: "no-store" }, { timeoutMs });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return true;
}

/** @internal Extract a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Poll a URL until it returns an OK (2xx) response or the timeout elapses,
 * retrying on both non-OK statuses and fetch errors.
 *
 * @param url - The URL to poll.
 * @param options - `timeoutMs` maximum wait in milliseconds (default 20000).
 * @returns `true` once an OK response is received.
 * @throws When the timeout elapses without an OK response (message includes the last error).
 */
export async function waitForHttpOk(url: string, { timeoutMs = 20000, probe }: HttpWaitOptions = {}): Promise<true> {
  const startedAt = Date.now();
  let lastError: Error | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      // Each attempt gets its own bounded timeout — capped at what's left of the OVERALL
      // `timeoutMs`, floored at 1ms so a caller who deliberately passes `timeoutMs: 0` still gets a
      // schedulable (if immediately-expiring) signal rather than `AbortSignal.timeout(0)`'s
      // undefined-ish edge behavior. Without this, a single stalled attempt could hang past the
      // `timeoutMs` this function promises to the caller: the outer `while` can only re-check the
      // clock once `await fetch(...)` itself returns, so an unbounded fetch call defeats the loop's
      // own deadline exactly like Finding 2 of the 2026-08-16 audit describes.
      const remaining = timeoutMs - (Date.now() - startedAt);
      if (await requestHttpOk({ url, timeoutMs: Math.max(1, remaining) }, { probe })) return true;
      lastError = new Error(`Readiness probe refused ${url}`);
    } catch (error) {
      lastError = new Error(errorMessage(error));
    }
    await sleep(150);
  }
  const detail = lastError ? ` (${lastError.message})` : "";
  throw new Error(`timed out waiting for ${url}${detail}`);
}
