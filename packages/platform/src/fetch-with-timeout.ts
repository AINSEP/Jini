/**
 * @module fetch-with-timeout
 *
 * The shared timeout wrapper for every outbound `fetch()` call this monorepo makes to a remote
 * service — see the 2026-08-16 Jini failure-mode audit, Finding 2: 101 raw `fetch()` call sites
 * repo-wide (corrected from the audit's own initial "67" — re-count before trusting any figure in
 * a handoff), across devops deploy providers, agent-runtime providers, media-provider dispatch,
 * github-client, and llm-provider, most already protected in some ad hoc way. A remote that accepts
 * the TCP connection but
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
 *
 * **Also exported as its own subpath, `@jini-ai/platform/fetch-with-timeout`, deliberately.** This
 * module has zero imports of its own — no `node:*` builtin, no `undici` — unlike the package's root
 * barrel (`index.ts`), which re-exports sibling modules (`process.ts`, `fs.ts`, `terminal.ts`,
 * `asset-cache.ts`, …) that import `node:child_process`, `node:fs`, etc.; the asset-cache
 * dispatcher loads the optional `undici` peer only when its synchronous factory is called.
 * Importing from the root barrel in browser-bundled code is silently fine in a *production* build
 * through Vite/Rollup — tree-shaking (this package sets `sideEffects: false`) proves the Node-only
 * re-exports are unused and drops them before the `node:*` imports are ever resolved — but it is
 * NOT fine in `vite dev` or any other unbundled-native-ESM serving mode: there is no tree-shaking on
 * that path, so the browser eagerly loads and evaluates every sibling the barrel re-exports, and
 * `process.ts`'s very first statement destructures `execFile`/`spawn` off `node:child_process` —
 * which Vite's dev server serves as a `Proxy` that throws on first property access. The whole module
 * graph fails to evaluate the instant anything imports the barrel, regardless of which export is
 * actually used. Verified empirically (`esbuild --bundle --platform=browser` on the barrel: 154
 * resolution errors; `vite build`: clean, 5.92kB, zero Node-only code in the output; `vite dev`
 * serving `index.js`: throws at import time) — see the 2026-08-17 Jini hardening report. Browser
 * call sites should import from this subpath, never the root barrel.
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
  /** A media-generation API call whose response only arrives once the vendor has actually finished
   * generating the image/video/audio server-side — routinely minutes, not seconds. Matches the
   * value OpenAI's and OpenRouter's own image providers already hardcode locally
   * (`OPENAI_IMAGE_*_TIMEOUT_MS`/`OPENROUTER_IMAGE_TIMEOUT_MS`); used as the shared dispatch-level
   * backstop in `@jini-ai/integrations`' `dispatchVendorRequest` for every OTHER vendor that (as of
   * 2026-08-16) sets no timeout of its own at all. Deliberately NOT the same as `UPLOAD`: a backstop
   * shorter than a vendor's own already-correct 10-minute generation timeout would abort a
   * legitimately still-generating request early. */
  GENERATE: 10 * 60_000,
} as const satisfies Record<string, number>;

export interface FetchWithTimeoutOptions {
  /** Milliseconds before the call is aborted. Pick one of {@link FETCH_TIMEOUT_MS}, or a specific
   * justified number for a call site that doesn't fit those classes. */
  timeoutMs: number;
  /** Host-supplied transport; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** Opt-in byte and decoding guards; defaults remain unlimited and replacement-decoded. */
export type TextReadOptions = {
  /** Nonnegative safe integer. Actual streamed bytes, independent of Content-Length. */
  maxResponseBytes?: number;
  /** Reject malformed UTF-8, including an incomplete trailing character. */
  strictUtf8?: boolean;
};

type TextReadDetails = { text: string; byteLength: number; truncated: boolean };
type DetailedTextReadInput = {
  response: Response;
  maxResponseBytes: number;
  result: "details";
  onLimit?: "reject" | "truncate";
  strictUtf8?: boolean;
  signal?: AbortSignal;
};
type StreamTextReadOptions = TextReadOptions & {
  onLimit?: "reject" | "truncate";
  signal?: AbortSignal;
};

/**
 * Consumes a response as UTF-8, checking bytes before decoding/retaining each chunk.
 * Details mode reports retained source bytes and truncates only on observed overflow;
 * reaching the cap still requires EOF to establish completeness. Defaults reject overflow
 * and replace malformed UTF-8. A supplied signal interrupts even a stalled read.
 * @throws {RangeError} An invalid cap or a response exceeding it.
 * @throws {TypeError} Invalid UTF-8 when strict decoding is enabled.
 * Read failures and abort reasons propagate; acquired readers are cancelled on failure
 * and always released. Details mode observes cancellation failures without awaiting cleanup.
 * @complexity O(n) time and retained text for n bytes, bounded by the optional cap.
 * The upstream stream controls the allocation of individual incoming chunks.
 * @example readFetchResponseText({ response, maxResponseBytes: 1024, result: "details", onLimit: "truncate" })
 */
export function readFetchResponseText(input: {
  response: Response;
  maxResponseBytes: number;
  result: "details";
  onLimit?: "reject" | "truncate";
  strictUtf8?: boolean;
  signal?: AbortSignal;
}): Promise<{ text: string; byteLength: number; truncated: boolean }>;
export function readFetchResponseText(
  { response }: { response: Response },
  options?: TextReadOptions,
): Promise<string>;
export async function readFetchResponseText(
  input: { response: Response } | DetailedTextReadInput,
  { maxResponseBytes, strictUtf8 = false }: TextReadOptions = {},
): Promise<string | TextReadDetails> {
  const details = "result" in input && input.result === "details";
  const options = details ? input : { ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }), strictUtf8 };
  validateTextReadOptions({ maxResponseBytes: options.maxResponseBytes, requireCap: details });
  if (!details && options.maxResponseBytes === undefined && !options.strictUtf8) return input.response.text();
  const result = await consumeResponseText({ response: input.response, awaitCancel: !details }, options);
  return details ? result : result.text;
}

/** Owns reader cleanup for every caller; legacy failure cleanup keeps its awaited behavior.
 * Signal-driven callers skip that wait: a body that ignores its signal may never settle cancel. */
async function consumeResponseText(
  { response, awaitCancel }: { response: Response; awaitCancel: boolean },
  options: StreamTextReadOptions = {},
): Promise<TextReadDetails> {
  options.signal?.throwIfAborted();
  if (response.body === null) return { text: "", byteLength: 0, truncated: false };
  const reader = response.body.getReader();
  let failed = true;
  try {
    const result = await decodeResponseStream({ reader }, options);
    if (result.truncated) void cancelResponseReader({ reader });
    failed = false;
    return result;
  } catch (error) {
    const cancellation = cancelResponseReader({ reader, reason: error });
    if (awaitCancel) await cancellation;
    throw error;
  } finally {
    try { reader.releaseLock(); } catch (error) { if (!failed) throw error; }
  }
}

/** Observe synchronous/asynchronous cancellation failure without masking the consumption outcome. */
function cancelResponseReader(
  { reader, reason }: { reader: ReadableStreamDefaultReader<Uint8Array>; reason?: unknown },
): Promise<void> {
  try { return reader.cancel(reason).catch(() => { /* Preserve the consumption error. */ }); }
  catch { return Promise.resolve(); }
}

/** Reject invalid caps before consumption, including for empty responses. */
function validateTextReadOptions(
  { maxResponseBytes, requireCap = false }: { maxResponseBytes: number | undefined; requireCap?: boolean },
): void {
  if (maxResponseBytes === undefined && !requireCap) return;
  if (typeof maxResponseBytes !== "number" || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
    throw new RangeError("maxResponseBytes must be a nonnegative safe integer");
  }
}

/** Byte counting precedes decoding; final flush detects truncated UTF-8 in strict mode.
 * Retains only the allowed prefix, independently of upstream chunk size or headers. */
async function decodeResponseStream(
  { reader }: { reader: ReadableStreamDefaultReader<Uint8Array> },
  { maxResponseBytes = Infinity, strictUtf8 = false, onLimit = "reject", signal }: StreamTextReadOptions = {},
): Promise<TextReadDetails> {
  const decoder = new TextDecoder("utf-8", { fatal: strictUtf8 });
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await readResponseChunk({ reader, signal });
    if (done) break;
    const remaining = maxResponseBytes - total;
    if (value.byteLength > remaining) {
      if (onLimit === "reject") throw new RangeError(`response exceeds the ${maxResponseBytes}-byte limit`);
      text += decoder.decode(value.subarray(0, remaining), { stream: true });
      return { text: text + decoder.decode(), byteLength: maxResponseBytes, truncated: true };
    }
    total += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), byteLength: total, truncated: false };
}

/** Race one read against cancellation, removing the listener on every outcome.
 * Per-read listeners avoid accumulating pending race handlers over a long response. */
async function readResponseChunk(
  { reader, signal }: { reader: ReadableStreamDefaultReader<Uint8Array>; signal: AbortSignal | undefined },
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
      Promise.resolve().then(() => { signal.throwIfAborted(); return reader.read(); }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
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
  return executeFetchWithTimeout({ url, init, timeoutMs: options.timeoutMs, consume: async ({ response }) => response }, options);
}

/**
 * Fetches and consumes text inside one timeout scope. The returned response keeps its metadata
 * and has a consumed body. No retries; other fetch/read errors propagate unchanged.
 * @throws {FetchTimeoutError} The timeout ends fetch or body consumption before caller abort.
 * @throws {RangeError | TypeError} See {@link readFetchResponseText} for opt-in guards.
 * @complexity O(n) time and text storage for n response bytes, optionally capped.
 */
export async function fetchTextWithTimeout(
  required: { url: string | URL; timeoutMs: number; init?: RequestInit },
  optional: TextReadOptions & { fetch?: typeof fetch } = {},
): Promise<{ response: Response; text: string }> {
  return executeFetchWithTimeout({
    url: required.url,
    timeoutMs: required.timeoutMs,
    init: required.init ?? {},
    consume: async ({ response, signal }) => {
      const { maxResponseBytes, strictUtf8 = false } = optional;
      validateTextReadOptions({ maxResponseBytes });
      // Always stream under the scope's signal: an injected fetch's body may ignore that signal,
      // and only racing each read lets the timeout end consumption.
      const read = await consumeResponseText({ response, awaitCancel: false }, { ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }), strictUtf8, signal });
      return { response, text: read.text };
    },
  }, optional);
}

/** Shared signal composition/error mapping; consumption decides the timeout scope's endpoint. */
async function executeFetchWithTimeout<T>(
  { url, init, timeoutMs, consume }: {
    url: string | URL;
    init: RequestInit;
    timeoutMs: number;
    consume: (required: { response: Response; signal: AbortSignal }) => Promise<T>;
  },
  options: Pick<FetchWithTimeoutOptions, "fetch"> = {},
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

  try {
    const response = await (options.fetch ?? fetch)(url, { ...init, signal });
    return await consume({ response, signal });
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
