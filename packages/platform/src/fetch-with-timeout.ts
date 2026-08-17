/**
 * @module fetch-with-timeout
 *
 * The shared timeout wrapper for every outbound `fetch()` call this monorepo makes to a remote
 * service — see the 2026-08-16 Jini failure-mode audit, Finding 2: 67 raw `fetch()` call sites
 * across devops deploy providers, agent-runtime providers, media-provider dispatch, github-client,
 * and llm-provider, none with an `AbortSignal`/timeout. A remote that accepts the TCP connection but
 * never responds — a stalled load balancer, a provider having a bad day, a firewall black-holing the
 * request — leaves `await fetch(...)` unresolved forever; whatever awaits it hangs indefinitely, with
 * nothing to alert on. A hang like that is worse than a crash: a crash is loud.
 *
 * Deliberately ONE helper, not 67 call sites each hand-rolling a slightly different
 * `AbortController`/`setTimeout` idiom — a caller who already has their own `AbortSignal` (a
 * user-initiated cancel, a parent request's own deadline) can still supply it via `init.signal`;
 * `AbortSignal.any` composes it with the timeout so either one aborts the call, and the thrown
 * `FetchTimeoutError` vs. the caller's own abort reason stay distinguishable (see `fetchWithTimeout`'s
 * own doc).
 *
 * `FETCH_TIMEOUT_MS` gives call sites a small, documented, shared vocabulary instead of inventing a
 * number each time — a deploy-provider API call, an image byte-fetch, and a large asset upload
 * genuinely have different reasonable ceilings. `timeoutMs` is never hidden inside the helper as an
 * undocumented default with no parameter, though: every call site names one explicitly (usually one
 * of these constants), because a caller reading its own code should see the number, not have to go
 * find it.
 *
 * Deliberately excludes anything meant to stay open for a long time independent of transfer size —
 * Server-Sent Events, WebSockets, long-poll. None of the 67 flagged call sites are that shape (the
 * audit traced this: the repo's real streaming transports are `EventSource` on the browser side and
 * a hand-rolled SSE channel server-side, both entirely separate from `fetch()`), but a future caller
 * reaching for this helper for one of those would be reaching for the wrong tool — `AbortSignal.timeout`
 * bounds the WHOLE call, body included, so it would sever a deliberately long-lived stream partway
 * through exactly like the bug this fixes, just self-inflicted instead of accidental.
 */

/** Thrown in place of the platform's generic abort error specifically when the timeout — not a
 * caller-supplied `init.signal` — is what ended the call, so a caller can tell "this took too long"
 * apart from "I cancelled it myself" without string-matching an error message. */
export class FetchTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`fetch timed out after ${timeoutMs}ms: ${url}`);
    this.name = "FetchTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Shared, documented timeout classes for outbound `fetch()` calls. Every call site names one
 * explicitly (or its own justified number) rather than relying on an unstated default.
 */
export const FETCH_TIMEOUT_MS = {
  /** A single metadata/status/API-read call expected to return quickly: a model catalog listing, a
   * connection test, a GitHub API read, an LLM provider's non-streaming completion call. */
  QUICK: 15_000,
  /** A deploy-provider API call that may involve real backend work on the provider's side — site
   * creation, DNS record lookups, deployment status polling. */
  DEPLOY: 30_000,
  /** A large-payload transfer: an asset/blob upload, a generated-media byte fetch. */
  UPLOAD: 120_000,
} as const satisfies Record<string, number>;

export interface FetchWithTimeoutOptions {
  /** Milliseconds before the call is aborted. Pick one of {@link FETCH_TIMEOUT_MS}, or a specific
   * justified number for a call site that doesn't fit those classes. */
  timeoutMs: number;
}

/**
 * `fetch`, but aborted after `options.timeoutMs` if it hasn't settled by then. If `init.signal` is
 * already set, the call aborts on EITHER that signal or the timeout, via `AbortSignal.any` — a
 * caller's own cancellation (e.g. a user-initiated cancel button) keeps working exactly as it did
 * without this wrapper.
 *
 * @param url - Same as `fetch`'s first argument.
 * @param init - Same as `fetch`'s second argument. `init.signal`, if present, is combined with the
 * timeout rather than replaced.
 * @param options - See {@link FetchWithTimeoutOptions}.
 * @returns The same `Promise<Response>` `fetch` itself would return.
 * @throws {@link FetchTimeoutError} if the timeout fires before the call settles and the caller's own
 * `init.signal` (if any) did not itself already abort. Any other rejection (a caller's own abort, a
 * genuine network error) propagates unchanged.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  options: FetchWithTimeoutOptions,
): Promise<Response> {
  const { timeoutMs } = options;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    // `timeoutSignal` is the original object this function created, not the (possibly composed)
    // signal handed to `fetch` — checking its own `.aborted` tells us specifically whether OUR
    // timeout fired, independent of whether a caller-supplied signal also exists or also aborted.
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new FetchTimeoutError(String(url), timeoutMs);
    }
    throw error;
  }
}
