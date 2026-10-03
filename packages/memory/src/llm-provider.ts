/**
 * @module llm-provider
 *
 * A generic, multi-vendor "call an LLM HTTP API with a system+user prompt
 * and get strict JSON back" primitive: given a provider id, an API key, a
 * model name, a system prompt string, and a user prompt string, call that
 * vendor's HTTP API and return either the raw text the model produced
 * ({@link callLlmProvider}) or that text parsed as JSON
 * ({@link callLlmProviderForJson}).
 *
 * Ported from Open Design's `apps/daemon/src/memory-llm.ts` —
 * `callAnthropic`/`callOpenAI`/`callAzure`/`callGoogle`, plus the
 * `appendVersionedApiPath`/`withTimeout`/`describeFetchError` plumbing they
 * shared and the fence-tolerant JSON-extraction half of `parseEntries`. See
 * `archived provenance ledger`'s 2026-07-21 addition for exactly what was carried over
 * and what was deliberately left behind (provider auto-selection, the
 * memory-specific system prompts, the `entries`/`MEMORY_TYPES` schema
 * validation, and the local coding-agent-CLI transport) — none of that is a
 * "call one HTTP API" concern.
 *
 * Every option this module exposes is caller-supplied; it has no opinion on
 * which model to default to, when to prefer one vendor over another, or
 * what shape the returned JSON should be. That decision-making lived in the
 * origin's `pickProvider`/memory-config override chain, which is product
 * policy, not a reusable mechanism.
 */

/** The vendor HTTP wire shape to speak. Azure is OpenAI-compatible but hosted per-tenant, so it gets its own id rather than being folded into `'openai'`. */
export type LlmProviderId = 'anthropic' | 'openai' | 'azure' | 'google';

/**
 * Required vendor, credential and model configuration. Transport and endpoint
 * overrides are supplied separately through {@link LlmProviderOptions}.
 */
export interface LlmProviderConfig {
  /** Which vendor HTTP wire shape to speak. */
  provider: LlmProviderId;
  /** The vendor API credential. Sent as the vendor's own auth header/query param — never logged or echoed back by this module. */
  apiKey: string;
  /** The model name (for `azure`, the deployment name) to request. This module has no default-model opinion; the caller always supplies one. */
  model: string;
}

/** Optional transport, endpoint and timeout settings for one LLM call. */
export interface LlmProviderOptions {
  /** Injectable HTTP transport; uses the native fetch implementation when omitted. */
  fetchFn?: typeof fetch;
  /** Injectable deadline signal for deterministic transport tests. */
  timeoutSignal?: (required: { timeoutMs: number }) => AbortSignal;
  /**
   * The vendor API host. Defaults to that vendor's public API host for
   * `anthropic`/`openai`/`google`. `azure` has no public host — a tenant's
   * own `https://<resource>.openai.azure.com` must always be supplied, or
   * {@link callLlmProvider} throws before making a request.
   */
  baseUrl?: string;
  /** Azure API version query param. Only meaningful for `provider: 'azure'`; defaults to {@link AZURE_DEFAULT_API_VERSION} when omitted. Ignored by every other provider. */
  apiVersion?: string;
  /**
   * Extra headers merged into the request (after this module's own
   * required headers, so a caller cannot accidentally clobber
   * authentication). The generalized replacement for the origin's
   * hardcoded per-vendor attribution-header special case: a caller wanting
   * a proxy/gateway attribution header, extra auth, etc. supplies it here
   * instead of this module special-casing any one downstream vendor.
   */
  extraHeaders?: Record<string, string>;
  /** Per-call `fetch` init overrides (e.g. a custom `dispatcher`). Applied *before* this module's own method/headers/body/signal, so those always win. */
  requestInit?: RequestInit;
  /** Abort timeout in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS} (30s, matching the origin) when omitted or not a positive number. */
  timeoutMs?: number;
}

/** Fallback Azure OpenAI `api-version` used when {@link LlmProviderOptions.apiVersion} is omitted. */
export const AZURE_DEFAULT_API_VERSION = '2024-10-21';

/** Fallback request timeout (ms) used when {@link LlmProviderOptions.timeoutMs} is omitted or invalid. Matches the origin's 30s ceiling. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Anthropic's Messages API requires `max_tokens` in every request body.
 * The origin hardcoded this rather than exposing it as a caller option, so
 * it stays an internal constant here too rather than growing new surface
 * area beyond what was actually ported.
 */
const ANTHROPIC_MAX_TOKENS = 1024;

const DEFAULT_BASE_URLS: Record<Exclude<LlmProviderId, 'azure'>, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  google: 'https://generativelanguage.googleapis.com',
};

interface ResolvedLlmCall {
  fetchFn: typeof fetch;
  timeoutSignal: (required: { timeoutMs: number }) => AbortSignal;
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  apiVersion: string;
  extraHeaders: Record<string, string>;
  requestInit: RequestInit;
  timeoutMs: number;
}

function resolveConfig(config: LlmProviderConfig & LlmProviderOptions): ResolvedLlmCall {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error('llm-provider: apiKey is required');
  const model = config.model.trim();
  if (!model) throw new Error('llm-provider: model is required');

  let baseUrl = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    if (config.provider === 'azure') {
      throw new Error(
        'llm-provider: baseUrl is required for the "azure" provider (no public default host exists — supply your resource\'s own https://<resource>.openai.azure.com)',
      );
    }
    baseUrl = DEFAULT_BASE_URLS[config.provider];
  }

  return {
    fetchFn: config.fetchFn ?? globalThis.fetch,
    timeoutSignal: config.timeoutSignal ?? (({ timeoutMs }) => AbortSignal.timeout(timeoutMs)),
    provider: config.provider,
    apiKey,
    model,
    baseUrl,
    apiVersion: (config.apiVersion ?? '').trim(),
    extraHeaders: config.extraHeaders ?? {},
    requestInit: config.requestInit ?? {},
    timeoutMs: typeof config.timeoutMs === 'number' && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Append `/v1<suffix>` to a base URL, unless the URL's path already carries
 * an explicit `/vN` segment (in which case `suffix` is appended directly).
 * Lets a custom endpoint whose saved base URL already contains `/v1` (local
 * servers, proxies that re-host a vendor API under a fixed prefix) avoid
 * becoming `/v1/v1/...`. Used by the `anthropic` and `openai` calls, which
 * both follow this `/v1/<resource>` convention; `azure`/`google` build
 * their URLs differently and don't need it.
 */
export function appendVersionedApiPath({ baseUrl, suffix }: { baseUrl: string; suffix: string }): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v\d+(\/|$)/.test(pathname) ? `${pathname}${suffix}` : `${pathname}/v1${suffix}`;
  return url.toString();
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function stringField(v: unknown, key: string): string {
  const value = asRecord(v)[key];
  return typeof value === 'string' ? value : '';
}

/** Extracts `choices[0].message.content` from an OpenAI/Azure chat-completions response body, defaulting to `''` for any missing/malformed shape. */
function firstChoiceMessageContent(json: unknown): string {
  const choices = asRecord(json).choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  return stringField(asRecord(first).message, 'content');
}

/** Extracts `candidates[0].content.parts` from a Google Gemini `generateContent` response body, returning `undefined` for any missing/malformed shape. */
function googleCandidateParts(json: unknown): unknown[] | undefined {
  const candidates = asRecord(json).candidates;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const content = asRecord(first).content;
  const parts = asRecord(content).parts;
  return Array.isArray(parts) ? parts : undefined;
}

/**
 * Unwraps `fetch`'s generic `TypeError: fetch failed` (undici tucks the
 * real cause under `err.cause`, a Node error or `AggregateError`) into a
 * message that surfaces the useful part — the OS error code when present,
 * otherwise the cause's own message — so a caller-facing error doesn't just
 * read "fetch failed" with no indication of whether DNS broke, the
 * connection was reset, or the request timed out.
 */
export function describeFetchError({ err }: { err: unknown }): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  if (!cause || typeof cause !== 'object') return message;
  const causeRecord = cause as { code?: unknown; message?: unknown; errors?: unknown };

  const codeRaw = causeRecord.code ? String(causeRecord.code) : '';
  const msgRaw = causeRecord.message && causeRecord.message !== message ? String(causeRecord.message) : '';

  let detail = '';
  if (codeRaw && msgRaw) {
    detail = msgRaw.toLowerCase().includes(codeRaw.toLowerCase()) ? codeRaw : `${codeRaw}: ${msgRaw}`;
  } else {
    detail = codeRaw || msgRaw;
  }

  if (!detail && Array.isArray(causeRecord.errors)) {
    for (const inner of causeRecord.errors as unknown[]) {
      const innerObj = inner as { code?: unknown; message?: unknown } | null | undefined;
      const innerCode = innerObj?.code ? String(innerObj.code) : '';
      const innerMsg = innerObj?.message ? String(innerObj.message) : '';
      const candidate = innerCode || innerMsg;
      if (candidate) {
        detail = candidate;
        break;
      }
    }
  }

  return detail ? `${message} (${detail})` : message;
}

/** Merges caller-supplied `extraHeaders` under this module's own required headers, so a caller cannot accidentally clobber authentication/content-type by supplying a same-named header. */
function mergedHeaders(required: Record<string, string>, extra: Record<string, string>): Record<string, string> {
  return { ...extra, ...required };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, resolved: ResolvedLlmCall, providerTag: string): Promise<unknown> {
  let resp: Response;
  try {
    resp = await resolved.fetchFn(url, {
      ...resolved.requestInit,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: resolved.timeoutSignal({ timeoutMs: resolved.timeoutMs }),
    });
  } catch (err) {
    throw new Error(describeFetchError({ err }));
  }
  const text = await resp.text().catch(() => '');
  if (!resp.ok) {
    throw new Error(`${providerTag} ${resp.status}: ${text}`);
  }
  try {
    return text === '' ? {} : JSON.parse(text);
  } catch {
    throw new Error(`${providerTag} non-JSON response: ${text.slice(0, 200)}`);
  }
}

async function callAnthropic(resolved: ResolvedLlmCall, system: string, user: string): Promise<string> {
  const url = appendVersionedApiPath({ baseUrl: resolved.baseUrl, suffix: '/messages' });
  const headers = mergedHeaders(
    {
      'content-type': 'application/json',
      'x-api-key': resolved.apiKey,
      'anthropic-version': '2023-06-01',
    },
    resolved.extraHeaders,
  );
  const json = await postJson(
    url,
    headers,
    {
      model: resolved.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    },
    resolved,
    'anthropic',
  );
  const content = asRecord(json).content;
  const contentArr = Array.isArray(content) ? content : [];
  const block = contentArr.find((b) => stringField(b, 'type') === 'text');
  return stringField(block, 'text');
}

async function callOpenAI(resolved: ResolvedLlmCall, system: string, user: string): Promise<string> {
  const url = appendVersionedApiPath({ baseUrl: resolved.baseUrl, suffix: '/chat/completions' });
  const headers = mergedHeaders(
    {
      'content-type': 'application/json',
      authorization: `Bearer ${resolved.apiKey}`,
    },
    resolved.extraHeaders,
  );
  const json = await postJson(
    url,
    headers,
    {
      model: resolved.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    resolved,
    'openai',
  );
  return firstChoiceMessageContent(json);
}

/**
 * Azure OpenAI speaks the same chat-completions JSON as OpenAI, but on a
 * per-deployment URL and with `api-key:` instead of `Authorization:`.
 * `resolved.model` here is the Azure deployment name (not the underlying
 * model family) — the deployment already pins the model, so it isn't sent
 * in the request body.
 */
async function callAzure(resolved: ResolvedLlmCall, system: string, user: string): Promise<string> {
  const deployment = encodeURIComponent(resolved.model);
  const apiVersion = encodeURIComponent(resolved.apiVersion || AZURE_DEFAULT_API_VERSION);
  const url = `${resolved.baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const headers = mergedHeaders(
    {
      'content-type': 'application/json',
      'api-key': resolved.apiKey,
    },
    resolved.extraHeaders,
  );
  const json = await postJson(
    url,
    headers,
    {
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    resolved,
    'azure',
  );
  return firstChoiceMessageContent(json);
}

/**
 * Google Gemini's REST surface uses a different request shape: system
 * instructions go in `systemInstruction`, the conversation is `contents[]`
 * with `role` + `parts`, and the API key is a query parameter rather than a
 * header. `responseMimeType: 'application/json'` gets strict JSON output
 * directly from the API rather than relying on prompt instructions alone.
 */
async function callGoogle(resolved: ResolvedLlmCall, system: string, user: string): Promise<string> {
  const model = encodeURIComponent(resolved.model);
  const url = `${resolved.baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(resolved.apiKey)}`;
  const headers = mergedHeaders({ 'content-type': 'application/json' }, resolved.extraHeaders);
  const json = await postJson(
    url,
    headers,
    {
      systemInstruction: { role: 'system', parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' },
    },
    resolved,
    'google',
  );
  const parts = googleCandidateParts(json);
  if (!parts) return '';
  return parts.map((p) => stringField(p, 'text')).join('');
}

/**
 * Call the given LLM vendor's HTTP API with a system+user prompt and
 * return the raw text the model produced. Throws on a network failure, a
 * non-2xx HTTP status, or a non-JSON response body — every vendor here
 * responds with a JSON envelope even for a text-generation call.
 *
 * @param config - Which vendor to call and its credentials/model/host.
 * @param systemPrompt - The system/instructions prompt.
 * @param userPrompt - The user-turn prompt.
 * @returns The model's raw text output (untouched — see
 *   {@link callLlmProviderForJson} to also parse it as JSON).
 */
export async function callLlmProvider(
  { config, systemPrompt, userPrompt }: { config: LlmProviderConfig; systemPrompt: string; userPrompt: string },
  optional: LlmProviderOptions = {},
): Promise<string> {
  const resolved = resolveConfig({ ...optional, ...config });
  switch (resolved.provider) {
    case 'anthropic':
      return callAnthropic(resolved, systemPrompt, userPrompt);
    case 'openai':
      return callOpenAI(resolved, systemPrompt, userPrompt);
    case 'azure':
      return callAzure(resolved, systemPrompt, userPrompt);
    case 'google':
      return callGoogle(resolved, systemPrompt, userPrompt);
    default: {
      // Exhaustive at the type level (`LlmProviderId` has exactly 4
      // members), but a JS caller (this package ships plain JS too) can
      // still pass an unrecognized string at runtime — fail closed with a
      // clear error rather than silently falling through to one vendor.
      const unknownProvider: string = resolved.provider;
      throw new Error(`llm-provider: unsupported provider "${unknownProvider}"`);
    }
  }
}

const CODE_FENCE_START_RE = /^```(?:json)?\s*/i;
const CODE_FENCE_END_RE = /```\s*$/i;
const JSON_OBJECT_RE = /\{[\s\S]*\}/;

/**
 * Tolerantly parses a strict-JSON model response: strips a wrapping
 * markdown code fence (models occasionally wrap output in ` ```json `
 * fences even when told not to), then `JSON.parse`s the result; if that
 * fails, falls back to extracting the first `{...}` block and parsing
 * that. Throws a clear error, including a truncated preview of the raw
 * text, if neither attempt produces valid JSON.
 *
 * This is the generic half of the origin's `parseEntries` — the
 * fence-stripping/parse/fallback mechanics, with none of that function's
 * memory-entry-specific schema validation (`entries` array shape,
 * `MEMORY_TYPES` filtering), which is product schema, not a parsing
 * mechanism.
 *
 * @param rawText - The model's raw text output, e.g. from
 *   {@link callLlmProvider}.
 * @returns The parsed JSON value, typed as `T` (unchecked — the caller is
 *   responsible for validating the shape).
 * @throws if `rawText` cannot be parsed as JSON even after fence-stripping
 *   and `{...}`-block extraction.
 */
export function parseStrictJson<T = unknown>({ rawText }: { rawText: string }): T {
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(CODE_FENCE_START_RE, '').replace(CODE_FENCE_END_RE, '').trim();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = JSON_OBJECT_RE.exec(text);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        // Fall through to the shared throw below.
      }
    }
    const preview = rawText.trim();
    const truncated = preview.length <= 200 ? preview : `${preview.slice(0, 199)}…`;
    throw new Error(`llm-provider: response was not valid JSON: ${truncated}`);
  }
}

/**
 * Convenience wrapper: {@link callLlmProvider} then {@link parseStrictJson}
 * the result in one call — the common case for a caller that just wants
 * structured JSON back and will validate its own shape.
 *
 * @param config - Which vendor to call and its credentials/model/host.
 * @param systemPrompt - The system/instructions prompt.
 * @param userPrompt - The user-turn prompt.
 * @returns The model's output parsed as JSON, typed as `T` (unchecked).
 */
export async function callLlmProviderForJson<T = unknown>(
  required: { config: LlmProviderConfig; systemPrompt: string; userPrompt: string },
  optional: LlmProviderOptions = {},
): Promise<T> {
  const raw = await callLlmProvider(required, optional);
  return parseStrictJson<T>({ rawText: raw });
}
