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
  const baseUrl = credentials.baseUrl ?? DEFAULT_TAVILY_BASE_URL;
  const baseUrlCheck = validateBaseUrl({ baseUrl });
  if (baseUrlCheck.error) {
    throw new Error(baseUrlCheck.error);
  }
  const base = baseUrl.replace(/\/+$/, '');
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
  //
  // `TavilyHttpError` marks an error already redacted and formatted by the `!response.ok` branch
  // below, so the outer catch can rethrow it verbatim instead of wrapping it a second time (which
  // would otherwise produce a "Tavily request failed: Tavily 429: ..." double-prefixed message).
  class TavilyHttpError extends Error { }

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), DEFAULT_TAVILY_TIMEOUT_MS);
  // Assigned in the `try` and returned *after* the `finally`, rather than returned from inside the
  // `try`. Both forms behave identically, but a return-through-`finally` compiles to three copies of
  // the `finally` body (normal completion, return, throw) and one of those is unreachable here — the
  // `try` cannot fall off its end and the `catch` always throws. Falling through to a single return
  // keeps the cleanup path honestly measurable instead of permanently one-third uncovered.
  let output: TavilySearchOutput;
  try {
    const response = await fetchImpl(`${base}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new TavilyHttpError(redactSecrets({ input: `Tavily ${response.status}: ${text.slice(0, 200) || 'no body'}` }, { exactSecrets: [apiKey] }));
    }

    const json = (await response.json()) as TavilyRawResponse;
    const answer = typeof json.answer === 'string' ? json.answer : '';
    const rawResults = Array.isArray(json.results) ? json.results : [];
    const sources: ResearchSource[] = [];
    for (const raw of rawResults as TavilyRawResult[]) {
      const url = typeof raw.url === 'string' ? raw.url : '';
      if (!url) continue;
      const publishedAt = typeof raw.published_date === 'string' && raw.published_date.trim() ? raw.published_date.trim() : undefined;
      sources.push({
        title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : url,
        url,
        snippet: typeof raw.content === 'string' ? raw.content.trim().slice(0, 800) : '',
        provider: 'tavily',
        ...(publishedAt ? { publishedAt } : {}),
      });
    }
    output = { answer, sources };
  } catch (error) {
    if (!timeoutController.signal.aborted && error instanceof TavilyHttpError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      redactSecrets({
        input: timeoutController.signal.aborted
          ? `Tavily request timed out after ${DEFAULT_TAVILY_TIMEOUT_MS}ms`
          : `Tavily request failed: ${message}`,
      }, { exactSecrets: [apiKey] }),
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
  return output;
}

/** Creates today's transport with a host-owned fetch port. */
export function createTavilyResearchProvider(_required: Record<string, never>, options: { fetch?: typeof globalThis.fetch } = {}): ResearchProvider {
  return { id: 'tavily', search: (input) => tavilySearch(input, options) };
}
