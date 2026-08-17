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
};

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
export async function waitForHttpOk(url: string, { timeoutMs = 20000 }: HttpWaitOptions = {}): Promise<true> {
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
      const response = await fetchWithTimeout(url, { cache: "no-store" }, { timeoutMs: Math.max(1, remaining) });
      if (response.ok) return true;
      lastError = new Error(`HTTP ${response.status} from ${url}`);
    } catch (error) {
      lastError = new Error(errorMessage(error));
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${url}${lastError ? ` (${lastError.message})` : ""}`);
}
