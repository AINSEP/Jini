import { redactSecrets } from '@jini-ai/core';
/**
 * @module research
 *
 * `POST /api/research/search` — a thin route wrapper over Tavily's real Search API
 * (`POST {baseUrl}/search`), ported from OD's `apps/daemon/src/research/tavily.ts` (the low-level
 * Tavily client) **and** `apps/daemon/src/research/index.ts#searchResearch` (the findings-assembly
 * wrapper the real `/api/research/search` route in `apps/daemon/src/routes/media.ts` actually
 * calls). Verified against a **live** boot of OD's real daemon (`apps/daemon/bin/od.mjs`, from the
 * sibling `/Users/la/Desktop/Programming/OSS-Repos/open-design` checkout on this machine) hitting
 * the real route with a mock Tavily backend, not just static reading — see the field-by-field notes
 * below for what that live diff actually found. The request/response shape and defaults are ported
 * (`search_depth: 'basic'`, `include_answer: true`, `include_raw_content: false`, a 20-result hard
 * cap, the `results[]` -> `ResearchSource[]` mapping, the 1000-char query cap, the
 * `Math.floor`+clamp-to-`[1,20]` `maxSources` normalization, and the `NO_RESEARCH_SOURCES`-style
 * "zero sources is a failure, not an empty success" behavior) — OD's own `TavilyError`/
 * `ResearchError` classes and `requestInit.dispatcher` passthrough are not carried over; this route
 * pack's own SEC-005 error-handling convention (a generic `INTERNAL_ERROR` + correlation id,
 * matching every other route pack in this package) replaces the origin's thrown-error shape for
 * genuinely unexpected failures. OD's `AbortController`-based 30s timeout **is** carried over
 * (added after an external audit flagged its absence — a stalled/malicious upstream could otherwise
 * hold a request indefinitely, since bare `fetch` has no default timeout): `tavilySearch` aborts
 * the request after `DEFAULT_TAVILY_TIMEOUT_MS` and clears the timer in a `finally` regardless of
 * outcome. No other request-level knobs (connection pooling, `dispatcher`) are exposed yet — a
 * future pass can add them the same way `media.ts#MediaGenerationRequestInit` optionally threads a
 * `dispatcher` through, if a real need for one shows up.
 *
 * **`ResearchSource` field names match OD's real `@open-design/contracts/api/research.ts`
 * `ResearchSource` shape** (`title`/`url`/`snippet`/`publishedAt?`/`provider`). **`ResearchSearchResponse`
 * matches that same contract file's `ResearchFindings` shape** (`query`/`summary`/`sources`/
 * `provider`/`depth`/`fetchedAt`) — an earlier version of this port conflated the *raw Tavily
 * client's* return shape (`tavily.ts`'s `{ answer, sources }`) with the *route's actual HTTP
 * response* shape (`research/index.ts#searchResearch`'s `ResearchFindings`), which the live daemon
 * diff caught: hitting the real `/api/research/search` with a mock Tavily backend returned
 * `{"query":"...","summary":"...","sources":[...],"provider":"tavily","depth":"shallow",
 * "fetchedAt":<ms>}`, never `{answer, sources}`. `depth` is hardcoded to the `'shallow'` literal
 * (rather than OD's full `'shallow' | 'medium' | 'deep'` `ResearchDepth` union) since this port, like
 * OD's real Phase-1 `searchResearch`, only ever produces `'shallow'` — there is no depth-selection
 * request field on either side yet.
 *
 * **`providers` request field**: OD's real route accepts an optional `providers: string[]` and only
 * inspects `providers[0]` (defaulting to `'tavily'` when absent/empty); a non-array value is treated
 * as absent (not rejected), and a first element other than `'tavily'` is rejected with a 400 before
 * credentials are even resolved (`UNSUPPORTED_RESEARCH_PROVIDER` in OD; this port's own generic
 * `BAD_REQUEST` validation-error convention here, same as every other `parse`-time rejection in this
 * file). Confirmed live: `providers: ["bing"]` 400s on the real daemon, `providers: ["tavily"]`
 * succeeds identically to omitting the field.
 *
 * **Credential resolution**: `resolveCredentials` defaults to this transport's narrow
 * `TAVILY_API_KEY` environment seam. A host with its own secrets layer supplies its own resolver
 * instead; this daemon route pack deliberately does not depend on the incubating media implementation
 * package. Note OD's real env-var precedence is
 * `['OD_TAVILY_API_KEY', 'TAVILY_API_KEY']` (checked live via `apps/daemon/tests/research.test.ts`'s
 * `TAVILY_ENV_KEYS`) — this package's own `@jini-ai/media#PROVIDER_CREDENTIAL_ENV_VARS.tavily` only
 * lists `['TAVILY_API_KEY']`, deliberately dropping the `OD_`-prefixed variant: this repo's own
 * `AGENTS.md` boundary rule bans product-identity strings (including the `OD_` prefix) inside
 * `packages/@jini-ai/**`, so that omission is a hard constraint, not a port gap.
 *
 * **Missing credentials is a clean `NOT_CONFIGURED` (503), not an `INTERNAL_ERROR`.** No API key
 * configured is an expected, non-exceptional state (matching `connectors.ts`'s "capability exists,
 * reachable, inert until configured" shape) — it never reaches the SEC-005 sink, since there is no
 * real exception or secret to hide, just an honest "not set up yet" answer. OD's real behavior here
 * (confirmed live) is a 400 `TAVILY_API_KEY_MISSING`, not a 503 — this is a deliberate, documented
 * divergence from OD (this package's own generic-error-code convention, applied consistently across
 * every route pack) rather than an oversight, so it is intentionally **not** changed to match OD's
 * 400.
 *
 * **Zero sources is a `NOT_FOUND` (404), not a `200` with an empty array.** OD's real
 * `searchResearch` throws `ResearchError('no sources found', 404, 'NO_RESEARCH_SOURCES')` when
 * Tavily's `results[]` maps to zero usable sources (confirmed live against a mock Tavily backend
 * that returns `results: []`) — this port matches that with the package's own generic `NOT_FOUND`
 * code (mapped to 404 by `response.ts#ERROR_STATUS_BY_CODE`) rather than inventing a
 * research-specific code, same rationale as the `NOT_CONFIGURED` choice above.
 *
 * **Query normalization**: OD's real `searchResearch` trims the query and caps it at 1000 characters
 * before ever calling Tavily (`(input.query?.trim() || '').slice(0, 1000)`) — confirmed live by
 * sending a padded, 1112-char query and observing the daemon forward exactly 1000 trimmed
 * characters to the mock Tavily backend. This port replicates both the trim and the cap in
 * `parseResearchSearch`.
 *
 * **`maxSources` normalization**: OD's real `clampMaxSources` is `Math.max(1, Math.min(Math.floor(value),
 * 20))` — confirmed live by sending `maxSources: 2.7` and observing `max_results: 2` (not `2.7`) on
 * the wire to the mock Tavily backend. An earlier version of this port only clamped the range
 * (`Math.max(0, Math.min(value, 20))`) without flooring, which could forward a fractional
 * `max_results` straight to Tavily's real API for any non-integer input (e.g. `maxSources: 0.5`
 * would have clamped to `0.5`, not `1`); this port now floors first, matching OD.
 *
 * **SEC-005 for everything else**: a genuine Tavily request/response failure is caught, reported
 * through `onInternalError` (defaults to `console.error`, matching every other route pack), and
 * surfaced to the caller as a generic `INTERNAL_ERROR` — the raw error message (which can echo
 * request details) is never sent to the HTTP caller directly. `redactSecrets` (reused from
 * `@jini-ai/core`'s `connection-guard.ts`, already reachable via this package's existing
 * `@jini-ai/agent-runtime` dependency — the same "shared primitive, one implementation" reuse this
 * task's agent-runtime work applied to `sse-decode.ts`/`turn-end-guard.ts`) strips the bearer
 * token out of any upstream error text before it is even logged, belt-and-braces alongside the
 * generic-message substitution.
 */
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createTavilyResearchProvider } from './research-tavily.adapter.js';
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, err, mountJsonRoute, ok, validationError, type AdapterContext, type Result, type RouteInputContext } from '@jini-ai/http-kit';

/** Matches OD's real `research/index.ts#searchResearch` query cap — see module doc. */
const MAX_QUERY_LENGTH = 1000;

export interface ResearchSource {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly publishedAt?: string;
  readonly provider: string;
}

/** Matches OD's real `@open-design/contracts/api/research.ts` `ResearchFindings` shape — see module doc. */
export interface ResearchSearchResponse {
  readonly query: string;
  readonly summary: string;
  readonly sources: readonly ResearchSource[];
  readonly provider: string;
  readonly depth: 'shallow';
  readonly fetchedAt: number;
}

export interface ResearchInternalErrorContext {
  readonly correlationId: string;
  readonly error: unknown;
}

export interface ResearchProviderCredentials {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
}

/** Research transport contract: the route owns validation/HTTP errors; adapters own vendor I/O. */
export interface ResearchProvider {
  readonly id: string;
  search(required: { apiKey: string; credentials: ResearchProviderCredentials; request: ResearchSearchRequest }, optional: Record<string, never>): Promise<{ readonly answer: string; readonly sources: readonly ResearchSource[] }>;
}

export interface ResearchHttpDeps {
  readonly provider?: ResearchProvider;
  readonly fetch?: typeof globalThis.fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Resolves per-provider credentials. Defaults to `TAVILY_API_KEY` for the built-in Tavily transport. */
  readonly resolveCredentials?: ({ providerId }: { providerId: string }) => Promise<ResearchProviderCredentials>;
  /** Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005). Defaults to `console.error`. */
  readonly onInternalError?: (context: ResearchInternalErrorContext) => void;
}

function defaultInternalErrorSink(context: ResearchInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http-kit] internal error (research/search, correlationId=${context.correlationId})`, context.error);
}

/**
 * Default `ResearchHttpDeps.resolveCredentials`: reads `TAVILY_API_KEY` from the environment.
 *
 * Takes no `providerId` even though the `resolveCredentials` dep type supplies one (a function of
 * fewer parameters is assignable, so this still satisfies the interface). It used to accept one and
 * return `{}` for anything other than `'tavily'`, but that arm was unreachable twice over: the only
 * call site below passes the literal `'tavily'`, and `validateRequestedProvider` already rejects any
 * other provider name at parse time. A host that supports a second provider injects its own
 * `resolveCredentials` rather than reaching this function with a different id.
 */
async function defaultResolveCredentials({ env }: { env: Readonly<Record<string, string | undefined>> }): Promise<ResearchProviderCredentials> {
  const apiKey = env.TAVILY_API_KEY?.trim();
  return apiKey ? { apiKey } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export interface ResearchSearchRequest {
  readonly query: string;
  readonly maxSources?: number;
}

/**
 * Only `'tavily'` is a supported provider (matches OD's real Phase-1 `searchResearch` — see module
 * doc). OD only inspects `providers[0]` and treats a non-array `providers` value as absent rather
 * than rejecting it; this mirrors both.
 */
function validateRequestedProvider(rawProviders: unknown, providerId: string): Result<null> {
  if (!Array.isArray(rawProviders)) return ok({ value: null });
  const filtered = rawProviders.filter((p): p is string => typeof p === 'string' && p.length > 0);
  const requested = filtered[0];
  if (requested !== undefined && requested !== providerId) {
    return err({ error: validationError({ message: `provider "${requested}" is not supported — only "${providerId}" is available` }) });
  }
  return ok({ value: null });
}

function parseResearchSearch(input: RouteInputContext, providerId: string): Result<ResearchSearchRequest> {
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const rawQuery = nonEmptyString(input.body.query);
  if (!rawQuery) return err({ error: validationError({ message: 'query must be a non-empty string' }, { issues: [{ path: 'query', message: 'required non-empty string' }] }) });
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  const maxSources = input.body.maxSources;
  if (maxSources !== undefined && (typeof maxSources !== 'number' || !Number.isFinite(maxSources) || maxSources <= 0)) {
    return err({ error: validationError({ message: 'maxSources must be a positive number when provided' }) });
  }
  const providerCheck = validateRequestedProvider(input.body.providers, providerId);
  if (!providerCheck.ok) return providerCheck;
  return ok({ value: { query, ...(maxSources !== undefined ? { maxSources: maxSources as number } : {}) } });
}

/** Ported verbatim from OD's real `research/index.ts#synthesizeFallbackSummary` — see module doc. Used when Tavily returns no `answer` text so the caller still gets a usable `summary`. */
function synthesizeFallbackSummary(sources: readonly ResearchSource[]): string {
  const lead = sources
    .slice(0, 5)
    .map((s, i) => `- [${i + 1}] ${s.title}: ${s.snippet.slice(0, 200)}`)
    .join('\n');
  return `(No provider summary; top snippets follow.)\n${lead}`;
}

/** The route-bound provider, else the host's `deps.provider`, else the built-in Tavily transport over `deps.fetch`. */
function selectProvider(bound: ResearchProvider | undefined, deps: ResearchHttpDeps): ResearchProvider {
  return bound ?? deps.provider ?? createTavilyResearchProvider({}, deps.fetch ? { fetch: deps.fetch } : {});
}

/** The host's resolver, else `TAVILY_API_KEY` for a `'tavily'` provider and no credentials for any other. */
function credentialResolver(provider: ResearchProvider, deps: ResearchHttpDeps): NonNullable<ResearchHttpDeps['resolveCredentials']> {
  return deps.resolveCredentials ?? (() => provider.id === 'tavily' ? defaultResolveCredentials({ env: deps.env ?? process.env }) : Promise.resolve({}));
}

/** Reports `error` to the host sink under a fresh correlation id and returns the generic SEC-005 public error. */
function reportInternalError(deps: ResearchHttpDeps, error: unknown): ReturnType<typeof createApiError> {
  const correlationId = randomUUID();
  (deps.onInternalError ?? defaultInternalErrorSink)({ correlationId, error });
  return createApiError({ code: 'INTERNAL_ERROR', message: 'an internal error occurred' }, { requestId: correlationId });
}

/** A copy of a provider failure with `apiKey` redacted from its message, name and stack, safe for the error sink. */
function redactProviderError(error: unknown, apiKey: string): Error {
  const redact = (input: string): string => redactSecrets({ input }, { exactSecrets: [apiKey] });
  const safeError = new Error(redact(error instanceof Error ? error.message : String(error)));
  if (error instanceof Error) {
    safeError.name = redact(error.name);
    if (error.stack === undefined) delete safeError.stack;
    else safeError.stack = redact(error.stack);
  }
  return safeError;
}

/** Builds one route over a host-selected provider, preserving the default Tavily validation contract. */
export function createResearchSearchRoute({ provider }: { provider?: ResearchProvider }, _optional: Record<string, never> = {}) {
  const providerId = provider?.id ?? 'tavily';
  return defineJsonRoute<ResearchSearchRequest, ResearchSearchResponse, ResearchHttpDeps>({
    method: 'post', path: '/api/research/search', parse: (input) => parseResearchSearch(input, providerId), handle: async ({ input: request, deps }) => {
      const selectedProvider = selectProvider(provider, deps);

      let credentials: ResearchProviderCredentials;
      try {
        credentials = await credentialResolver(selectedProvider, deps)({ providerId: selectedProvider.id });
      } catch (error) {
        return err({ error: reportInternalError(deps, error) });
      }

      const apiKey = credentials.apiKey;
      if (!apiKey) {
        return err({ error: createApiError({ code: 'NOT_CONFIGURED', message: `${selectedProvider.id} provider not configured` }) });
      }

      try {
        const raw = await selectedProvider.search({ apiKey, credentials, request }, {});
        // Matches OD's real `NO_RESEARCH_SOURCES` (404) — see module doc. Zero usable sources is a
        // failure, not an empty success, even when the upstream Tavily call itself succeeded.
        if (raw.sources.length === 0) {
          return err({ error: createApiError({ code: 'NOT_FOUND', message: 'no sources found' }) });
        }
        const result: ResearchSearchResponse = {
          query: request.query,
          summary: raw.answer || synthesizeFallbackSummary(raw.sources),
          sources: raw.sources,
          provider: selectedProvider.id,
          depth: 'shallow',
          fetchedAt: Date.now(),
        };
        return ok({ value: result });
      } catch (error) {
        // A host provider can throw transport text too; keep its configured key out of the sink.
        return err({ error: reportInternalError(deps, redactProviderError(error, apiKey)) });
      }
    }
  }, { requireSameOrigin: true });
}

export const researchSearchRoute = createResearchSearchRoute({});

/** Mounts `POST /api/research/search` on `app`. A pack's `http(app, services)` calls this directly. */
export function registerResearchRoutes({ app, deps, adapter }: { readonly app: Express; readonly deps: ResearchHttpDeps; readonly adapter: AdapterContext }, _optional: Record<string, never> = {}): void {
  mountJsonRoute({ app, spec: deps.provider ? createResearchSearchRoute({ provider: deps.provider }) : researchSearchRoute, deps, adapter });
}
