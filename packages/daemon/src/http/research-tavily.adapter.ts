/** Tavily default adapter. Request limits, timeout and secret-redaction policy remain here. */
import { validateBaseUrl } from '@jini-ai/agent-runtime';
import { redactSecrets } from '@jini-ai/core';
import type { ResearchProvider, ResearchProviderCredentials, ResearchSearchRequest, ResearchSource } from './research.js';
const DEFAULT_TAVILY_BASE_URL = 'https://api.tavily.com';
/** Tavily's own documented cap on `max_results` (see OD's `tavily.ts#TAVILY_MAX_RESULTS_LIMIT`). */
const TAVILY_MAX_RESULTS_LIMIT = 20;
const DEFAULT_MAX_SOURCES = 5;
/** Matches OD's own `tavily.ts` timeout — see research.ts's module doc. */
const DEFAULT_TAVILY_TIMEOUT_MS = 30_000;

interface TavilyRawResult {
  readonly title?: unknown;
  readonly url?: unknown;
  readonly content?: unknown;
  readonly score?: unknown;
  readonly published_date?: unknown;
}

interface TavilyRawResponse {
  readonly answer?: unknown;
  readonly results?: unknown;
}

/** The raw Tavily client's own output shape — deliberately distinct from the route-level `ResearchSearchResponse` (see research.ts's module doc's "an earlier version of this port conflated..." note). The route handler in research.ts assembles the real response from this. */
interface TavilySearchOutput {
  readonly answer: string;
  readonly sources: ResearchSource[];
}

/**
 * Marks an error already redacted and formatted by `fetchTavilySearch`'s `!response.ok` branch, so
 * `toTavilyFailure` can rethrow it verbatim instead of wrapping it a second time (which would
 * otherwise produce a "Tavily request failed: Tavily 429: ..." double-prefixed message).
 */
class TavilyHttpError extends Error { }

function resolveTavilyBase(credentials: ResearchProviderCredentials): string {
  const baseUrl = credentials.baseUrl ?? DEFAULT_TAVILY_BASE_URL;
  const baseUrlCheck = validateBaseUrl({ baseUrl });
  if (baseUrlCheck.error) {
    throw new Error(baseUrlCheck.error);
  }
  return baseUrl.replace(/\/+$/, '');
}

function trimmedOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** One raw Tavily result as a source, or `null` when it carries no usable URL. */
function toResearchSource(raw: TavilyRawResult): ResearchSource | null {
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!url) return null;
  const publishedAt = trimmedOrUndefined(raw.published_date);
  return {
    title: trimmedOrUndefined(raw.title) ?? url,
    url,
    snippet: typeof raw.content === 'string' ? raw.content.trim().slice(0, 800) : '',
    provider: 'tavily',
    ...(publishedAt ? { publishedAt } : {}),
  };
}

function parseTavilyResponse(json: TavilyRawResponse): TavilySearchOutput {
  const answer = typeof json.answer === 'string' ? json.answer : '';
  const rawResults = Array.isArray(json.results) ? json.results : [];
  const sources: ResearchSource[] = [];
  for (const raw of rawResults as TavilyRawResult[]) {
    const source = toResearchSource(raw);
    if (source) sources.push(source);
  }
  return { answer, sources };
}

async function fetchTavilySearch({ fetchImpl, url, apiKey, body, signal }: {
  fetchImpl: typeof globalThis.fetch;
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
}): Promise<TavilySearchOutput> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new TavilyHttpError(redactSecrets({ input: `Tavily ${response.status}: ${text.slice(0, 200) || 'no body'}` }, { exactSecrets: [apiKey] }));
  }

  return parseTavilyResponse((await response.json()) as TavilyRawResponse);
}

/** The redacted error `tavilySearch` throws for any failure: a timeout, an already-formatted HTTP error, or anything else. */
function toTavilyFailure(error: unknown, { apiKey, timedOut }: { apiKey: string; timedOut: boolean }): Error {
  if (!timedOut && error instanceof TavilyHttpError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    redactSecrets({
      input: timedOut
        ? `Tavily request timed out after ${DEFAULT_TAVILY_TIMEOUT_MS}ms`
        : `Tavily request failed: ${message}`,
    }, { exactSecrets: [apiKey] }),
  );
}

/**
 * Calls Tavily's real `POST /search` endpoint directly — see research.ts's module doc for the port's exact
 * scope/provenance. Throws (never a `Result`) on any failure; the route handler in research.ts is the one
 * place that converts a thrown error into the package's SEC-005 response shape.
 *
 * `apiKey` is a separate, non-optional parameter rather than being read off `credentials`, so the
 * "credential is present" invariant is carried by the type system instead of by a runtime guard.
 * This function used to take only `credentials` and re-check `credentials.apiKey` itself, but the
 * route caller in research.ts already returns `NOT_CONFIGURED` before it ever gets here — the check was
 * unreachable by construction, so it is now expressed as a required argument instead of dead code.
 * `credentials` is still passed for its optional transport config (`baseUrl`).
 */
async function tavilySearch(
  { apiKey, credentials, request }: { apiKey: string; credentials: ResearchProviderCredentials; request: ResearchSearchRequest },
  { fetch: fetchImpl = globalThis.fetch }: { fetch?: typeof globalThis.fetch } = {},
): Promise<TavilySearchOutput> {
  const base = resolveTavilyBase(credentials);
  // Floor before clamping, matching OD's real `clampMaxSources` — see research.ts's module doc. Without the
  // floor, a fractional `maxSources` (e.g. `2.7`, or `0.5` before the `Math.max(1, ...)` floor
  // below) would forward a non-integer `max_results` straight to Tavily's real API.
  const maxResults = Math.max(1, Math.min(Math.floor(request.maxSources ?? DEFAULT_MAX_SOURCES), TAVILY_MAX_RESULTS_LIMIT));
  const body = {
    query: request.query,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: true,
    include_raw_content: false,
  };

  // The timeout must stay armed for the full operation, not just until `fetch` resolves —
  // `fetch` resolves as soon as response headers arrive, before the body is read. A round-2
  // external audit caught (and locally reproduced) an earlier version of this fix that cleared
  // the timer right after `fetch` resolved, leaving `response.text()`/`response.json()` below
  // completely unbounded against a server that sends headers promptly and then stalls the body.
  // `fetchTavilySearch` therefore reads the body inside the same armed window.
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), DEFAULT_TAVILY_TIMEOUT_MS);
  // Assigned in the `try` and returned *after* the `finally`, rather than returned from inside the
  // `try`. Both forms behave identically, but a return-through-`finally` compiles to three copies of
  // the `finally` body (normal completion, return, throw) and one of those is unreachable here — the
  // `try` cannot fall off its end and the `catch` always throws. Falling through to a single return
  // keeps the cleanup path honestly measurable instead of permanently one-third uncovered.
  let output: TavilySearchOutput;
  try {
    output = await fetchTavilySearch({ fetchImpl, url: `${base}/search`, apiKey, body, signal: timeoutController.signal });
  } catch (error) {
    throw toTavilyFailure(error, { apiKey, timedOut: timeoutController.signal.aborted });
  } finally {
    clearTimeout(timeoutHandle);
  }
  return output;
}

/** Creates today's transport with a host-owned fetch port. */
export function createTavilyResearchProvider(_required: Record<string, never>, options: { fetch?: typeof globalThis.fetch } = {}): ResearchProvider {
  return { id: 'tavily', search: (input) => tavilySearch(input, options) };
}
