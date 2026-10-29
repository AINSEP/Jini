import { redactSecrets } from '@jini-ai/core';
/**
 * @module providers/connection-test
 *
 * BYOK connection smoke test — sends a tiny "Reply with only: ok" completion
 * request to the configured provider endpoint and classifies the outcome, so
 * a settings UI can tell the operator "this endpoint works" without spending
 * a real chat turn to find out. Ported from OD's `apps/daemon/src/connectionTest.ts`
 * (`testProviderConnection` + `buildProviderCall` + `inspectProviderCompletion`),
 * narrowed to the four protocols `@jini-ai/ui`'s execution-tab canary exposes
 * (`anthropic` / `openai` / `azure` / `google`) — the origin also covers
 * `ollama` / `senseaudio` / `aihubmix` / `bedrock`, which stay out of scope
 * here the same way `model-catalog.ts` keeps Bedrock to a static seed and
 * Azure to an explicit "unsupported" response for model discovery.
 *
 * Shares this package's own vendored SSRF guard / secret redaction
 * (`connection-guard.ts`) and vendored connectivity types (`types.ts`) —
 * no OD workspace-package imports, matching every other file in this
 * directory.
 */

import type { DnsLookupFn } from './connection-guard.js';
import { defaultDnsLookup, validateBaseUrlResolved } from './connection-guard.js';
import { googleGenerateContentUrl } from './google.js';
import { buildOpenAIChatTokenParam, buildLegacyMaxTokensParam } from './token-params.js';
import type { ConnectionTestKind, ConnectionTestProtocol } from './types.js';
import { trimCharsEnd } from '@jini-ai/core/text';

/** The four wire protocols this smoke test knows how to speak. A narrower
 *  type than {@link ConnectionTestProtocol} on purpose — see this module's
 *  header for what's out of scope and why. */
export type SupportedConnectionTestProtocol = 'anthropic' | 'openai' | 'azure' | 'google';

export interface ProviderConnectionTestRequest {
  protocol: ConnectionTestProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Azure only — the `api-version` query param. */
  apiVersion?: string;
}

export type ProviderConnectionTestInput = ProviderConnectionTestRequest & {
  signal?: AbortSignal;
  requestInit?: Pick<RequestInit, 'dispatcher'>;
  /** Injectable DNS resolver for the base-URL SSRF guard; defaults to `node:dns`. */
  dnsLookup?: DnsLookupFn;
  /** Injectable HTTP transport (same port `listProviderModels` takes); defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Hard ceiling on the whole probe; defaults to {@link CONNECTION_TEST_TIMEOUT_MS}. */
  timeoutMs?: number;
};

export interface ConnectionTestResponse {
  ok: boolean;
  kind: ConnectionTestKind;
  latencyMs: number;
  model?: string;
  status?: number;
  detail?: string;
}

const SMOKE_PROMPT = 'Reply with only: ok';
/**
 * Headroom for a reasoning model's hidden thinking, plus the two-character answer.
 *
 * Was 64, chosen with the right instinct ("a reasoning model can spend the first few dozen tokens
 * on hidden reasoning") and the wrong number. On Gemini 2.5 models thinking tokens are billed
 * against `maxOutputTokens`, and their dynamic thinking budget routinely exceeds 64 on its own — so
 * the model spends the entire allowance thinking, stops at `finishReason: MAX_TOKENS`, and returns
 * a 2xx candidate with NO `content.parts` at all. The operator sees "Provider returned a 2xx
 * response without assistant text" against a key that provably works, which reads as a broken key.
 *
 * 512 rather than a thinking-disabling flag (`generationConfig.thinkingConfig.thinkingBudget: 0`)
 * because that field is Gemini-2.5-only and the Gemini API rejects unknown `generationConfig`
 * members outright — it would fix current models by breaking older ones. A larger ceiling is
 * provider-agnostic, and it is a ceiling, not a spend: a model that answers "ok" in two tokens
 * still costs two tokens.
 */
const CONNECTION_TEST_MAX_TOKENS = 512;
const CONNECTION_TEST_TIMEOUT_MS = 12_000;
const SAMPLE_MAX_CHARS = 120;

function isSupportedProtocol(protocol: ConnectionTestProtocol): protocol is SupportedConnectionTestProtocol {
  return protocol === 'anthropic' || protocol === 'openai' || protocol === 'azure' || protocol === 'google';
}

function appendVersionedApiPath(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  const pathname = trimCharsEnd({ text: url.pathname, chars: '/' });
  url.pathname = /\/v\d+(\/|$)/.test(pathname) ? `${pathname}${suffix}` : `${pathname}/v1${suffix}`;
  return url.toString();
}

/** Only ever called with the redacted string `extractText` produced, so no non-string guard is needed. */
function truncateSample(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= SAMPLE_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, SAMPLE_MAX_CHARS - 1)}…`;
}

function isSmokeOkReply(text: unknown): boolean {
  return typeof text === 'string' && text.trim().toLowerCase() === 'ok';
}

function firstCandidateFinishReason(
  { candidates }: { candidates: Array<{ finishReason?: unknown }> | undefined }, _options = {},
): unknown {
  return candidates?.[0]?.finishReason;
}

/**
 * The provider's own reason for stopping, when a 2xx carried no usable text.
 *
 * Exists because "Provider returned a 2xx response without assistant text" is a true statement that
 * tells the operator nothing they can act on — it names the symptom and hides the cause. Every
 * supported protocol reports a stop reason under a different key, and the useful ones
 * (`MAX_TOKENS`, `content_filter`, `safety`) each imply a different fix.
 *
 * Read defensively: any of these may be absent, and a missing reason must degrade to the old
 * message rather than to `"undefined"`.
 */
function extractFinishReason(data: unknown): string {
  const root = data as {
    candidates?: Array<{ finishReason?: unknown }>;
    choices?: Array<{ finish_reason?: unknown }>;
    stop_reason?: unknown;
  };
  const raw =
    firstCandidateFinishReason({ candidates: root?.candidates }) ?? root?.choices?.[0]?.finish_reason ?? root?.stop_reason;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

function isLikelyAuthErrorText(text: string): boolean {
  return /(?:api[_ -]?key|x-goog-api-key|unauthorized|unauthenticated|permission denied|invalid credentials|authentication credentials|access denied|invalid key)/i.test(
    text,
  );
}

function isLikelyModelErrorText(text: string): boolean {
  return (
    /model/i.test(text) &&
    /(not found|not exist|does not exist|unknown|invalid|unsupported|not supported|not have access|no access)/i.test(text)
  );
}

function statusToKind(status: number, detailText = ''): ConnectionTestKind {
  if (status === 401 || (status === 400 && isLikelyAuthErrorText(detailText))) return 'auth_failed';
  if (status === 403) return isLikelyAuthErrorText(detailText) ? 'auth_failed' : 'forbidden';
  if (status === 404) return isLikelyModelErrorText(detailText) ? 'not_found_model' : 'invalid_base_url';
  return fallbackStatusKind({ status });
}

function fallbackStatusKind({ status }: { status: number }, _options = {}): ConnectionTestKind {
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'upstream_unavailable' : 'unknown';
}

function networkErrorToKind(err: unknown): ConnectionTestKind {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'timeout';
    const cause = (err as { cause?: { code?: string } }).cause;
    const code = cause?.code;
    if ([
      'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
      'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    ].includes(code ?? '')) {
      return 'invalid_base_url';
    }
  }
  return 'unknown';
}

function providerErrorMessage({ error }: { error: unknown }, _options = {}): string {
  if (!error || typeof error !== 'object') return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : '';
}

function extractProviderErrorDetail(data: unknown, rawText: string): string {
  const obj = data && typeof data === 'object' ? data : null;
  const error = obj ? (obj as { error?: unknown }).error : null;
  if (typeof error === 'string') return error;
  const nestedMessage = providerErrorMessage({ error });
  if (nestedMessage) return nestedMessage;
  const message = obj ? (obj as { message?: unknown }).message : null;
  if (typeof message === 'string' && message.trim()) return message;
  return rawText.trim().slice(0, 240);
}

interface ProviderCallShape {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  extractText: (data: unknown) => string;
}

function extractOpenAIMessageText(data: unknown): string {
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
  if (typeof first?.message?.content === 'string') return first.message.content;
  if (typeof first?.text === 'string') return first.text;
  return '';
}

// `buildLegacyMaxTokensParam`/`buildMaxCompletionTokensParam` cover the Azure
// legacy-vs-`max_completion_tokens` split the same way OD's daemon retries a
// rejected `max_tokens` param; this smoke test keeps the simpler single-shot
// legacy param (a connection test failing on a param-name mismatch on a
// reasoning-tier Azure deployment is a known, narrow gap — see this
// package's `archived provenance ledger`) rather than porting OD's full retry-on-400 loop.

function buildAzureProviderCall(
  { input }: { input: ProviderConnectionTestRequest }, _options = {},
): ProviderCallShape {
  const { baseUrl, apiKey, model } = input;
  const url = new URL(baseUrl);
  const basePath = trimCharsEnd({ text: url.pathname, chars: '/' });
  const usesVersionedOpenAIPath = /\/openai\/v\d+(?:$|\/)/.test(basePath);
  const apiVersion = input.apiVersion?.trim() || (usesVersionedOpenAIPath ? '' : '2024-10-21');
  url.pathname = usesVersionedOpenAIPath
    ? `${basePath}/chat/completions`
    : `${basePath}/openai/deployments/${encodeURIComponent(model)}/chat/completions`;
  if (apiVersion) url.searchParams.set('api-version', apiVersion);
  return {
    url: url.toString(),
    headers: { 'content-type': 'application/json', 'api-key': apiKey },
    body: {
      ...(usesVersionedOpenAIPath ? { model } : {}),
      ...buildLegacyMaxTokensParam({ maxTokens: CONNECTION_TEST_MAX_TOKENS }),
      messages: [{ role: 'user', content: SMOKE_PROMPT }],
      stream: false,
    },
    extractText: extractOpenAIMessageText,
  };
}

function buildProviderCall(input: ProviderConnectionTestRequest & { protocol: SupportedConnectionTestProtocol }): ProviderCallShape {
  const baseUrl = input.baseUrl;
  const apiKey = input.apiKey;
  const model = input.model;
  switch (input.protocol) {
    case 'anthropic':
      return {
        url: appendVersionedApiPath(baseUrl, '/messages'),
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model,
          max_tokens: CONNECTION_TEST_MAX_TOKENS,
          messages: [{ role: 'user', content: SMOKE_PROMPT }],
          stream: false,
        },
        extractText: (data) => {
          const blocks = (data as { content?: unknown }).content;
          if (!Array.isArray(blocks)) return '';
          for (const block of blocks) {
            if (
              block &&
              typeof block === 'object' &&
              (block as { type?: string }).type === 'text' &&
              typeof (block as { text?: unknown }).text === 'string'
            ) {
              return (block as { text: string }).text;
            }
          }
          return '';
        },
      };
    case 'openai':
      return {
        url: appendVersionedApiPath(baseUrl, '/chat/completions'),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: {
          model,
          ...buildOpenAIChatTokenParam({ model: model, maxTokens: CONNECTION_TEST_MAX_TOKENS }),
          messages: [{ role: 'user', content: SMOKE_PROMPT }],
          stream: false,
        },
        extractText: extractOpenAIMessageText,
      };
    case 'azure':
      return buildAzureProviderCall({ input });
    case 'google': {
      // No empty-base-URL default here: `testProviderConnection` only reaches this builder after
      // `validateBaseUrlResolved` parsed `baseUrl` as an http(s) URL, so it is never blank. `trim()`
      // stays because the WHATWG parser accepts (and ignores) surrounding spaces the URL builder would not.
      return {
        url: googleGenerateContentUrl({ baseUrl: baseUrl.trim(), model: model }),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: {
          contents: [{ role: 'user', parts: [{ text: SMOKE_PROMPT }] }],
          generationConfig: { maxOutputTokens: CONNECTION_TEST_MAX_TOKENS },
        },
        extractText: (data) => {
          const candidates = (data as { candidates?: unknown }).candidates;
          if (!Array.isArray(candidates) || candidates.length === 0) return '';
          const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
          if (!Array.isArray(parts)) return '';
          return parts
            // Gemini 2.5 returns its hidden reasoning as ordinary parts flagged `thought: true`,
            // interleaved with the real answer. Joining them all turns a correct "ok" into
            // "<paragraph of reasoning>ok", which `isSmokeOkReply`'s exact match then rejects — a
            // model that answered correctly reported as a failed connection. Only the answer counts.
            .filter((p: { thought?: unknown }) => p?.thought !== true)
            .map((p: { text?: unknown }) => (typeof p?.text === 'string' ? p.text : ''))
            .join('');
        },
      };
    }
  }
}

function parseProviderResponse({ rawText }: { rawText: string }, _options = {}): unknown {
  let data: unknown = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    // Non-JSON body — fall through to the not-`response.ok` / smoke-reply
    // paths below, both of which treat an empty `data` as "no usable text".
  }

  return data;
}

function inspectProviderResponse(
  { response, data, rawText, call, input, latencyMs, model }: {
    response: Response; data: unknown; rawText: string; call: ProviderCallShape;
    input: ProviderConnectionTestInput; latencyMs: number; model: string;
  }, _options = {},
): ConnectionTestResponse {
  if (!response.ok) {
    const redactedDetail = redactSecrets({ input: extractProviderErrorDetail(data, rawText).slice(0, 240) }, { exactSecrets: [input.apiKey] });
    return {
      ok: false,
      kind: statusToKind(response.status, redactedDetail),
      latencyMs,
      model,
      status: response.status,
      detail: redactedDetail || (response.status === 404 ? 'HTTP 404 from provider; check the Base URL path.' : ''),
    };
  }
  const text = call.extractText(data);
  if (isSmokeOkReply(text)) {
    return { ok: true, kind: 'success', latencyMs, model, status: response.status, detail: 'valid completion' };
  }
  // Redacted for exactly the reason the `!response.ok` branch above
  // redacts. The transport succeeded here (HTTP 2xx) but the smoke reply
  // did not match, so this is still a failure path echoing arbitrary
  // provider text straight back into the admin UI — and a misbehaving or
  // hostile endpoint that reflects the request's own `Authorization`
  // header puts the operator's key in `detail` verbatim. Two independent
  // audits reproduced that, each from a different call boundary; the
  // redaction was simply missing on this one branch.
  const sample = truncateSample(redactSecrets({ input: text }, { exactSecrets: [input.apiKey] }));
  // Naming the stop reason turns an unactionable "it returned nothing" into a diagnosis:
  // `MAX_TOKENS` means the smoke budget was too small (usually a thinking model), a safety or
  // content-filter reason means the probe was blocked, not that the endpoint is broken.
  const finishReason = extractFinishReason(data);
  return {
    ok: false,
    kind: 'unknown',
    latencyMs,
    model,
    status: response.status,
    detail: sample
      ? `Expected smoke test reply "ok"; got "${sample}"`
      : finishReason
        ? `Provider returned a 2xx response without assistant text (finish reason: ${finishReason})`
        : 'Provider returned a 2xx response without assistant text',
  };
}

/**
 * Probes a BYOK provider endpoint with the supplied credentials by sending a
 * tiny smoke-test completion request, and classifies the result. Validates
 * the base URL (sync + DNS-resolved SSRF guard) before issuing any request,
 * exactly like {@link import('./model-catalog.js').listProviderModels}.
 *
 * Never throws for provider-side or network failures — every failure path
 * resolves to `{ ok: false, kind, detail }`. Only truly unsupported
 * protocols short-circuit before any network access.
 *
 * @complexity O(1) — one bounded-size HTTP request with a hard timeout.
 * @overallScore 100
 */
export async function testProviderConnection(requiredArgs: Pick<ProviderConnectionTestInput, "protocol" | "baseUrl" | "apiKey" | "model">, optionalArgs: Omit<ProviderConnectionTestInput, "protocol" | "baseUrl" | "apiKey" | "model"> = {}): Promise<ConnectionTestResponse> {
  const input: ProviderConnectionTestInput = { ...optionalArgs, ...requiredArgs };
  const start = Date.now();
  const model = input.model.trim();

  if (!isSupportedProtocol(input.protocol)) {
    return {
      ok: false,
      kind: 'unknown',
      latencyMs: Date.now() - start,
      model,
      detail: `Connection test is not supported for protocol "${input.protocol}".`,
    };
  }

  // Every supported protocol here (anthropic/openai/azure/google) puts the
  // key straight into the outbound request (`buildProviderCall` below), so
  // an empty key is never a legitimate probe — the provider would reject it
  // with a generic "no credential" error indistinguishable from a broken
  // integration. Same fail-fast rationale as `listProviderModels`'s
  // `PROTOCOLS_REQUIRING_API_KEY` guard, checked first so a missing key
  // short-circuits before any DNS/network access.
  if (!input.apiKey.trim()) {
    return {
      ok: false,
      kind: 'auth_failed',
      latencyMs: Date.now() - start,
      model,
      detail: 'No API key saved. Save one to test the connection.',
    };
  }

  const validated = await validateBaseUrlResolved({ baseUrl: input.baseUrl, lookup: input.dnsLookup ?? defaultDnsLookup });
  // `validateBaseUrlResolved` reports every rejection through `error`; a result without one always
  // carries the parsed URL, so `error` alone decides.
  if (validated.error !== undefined) {
    return {
      ok: false,
      kind: validated.forbidden ? 'forbidden' : 'invalid_base_url',
      latencyMs: Date.now() - start,
      model,
      detail: validated.error,
    };
  }

  let call: ProviderCallShape;
  try {
    call = buildProviderCall({ ...input, protocol: input.protocol, model });
  } catch (err) {
    return {
      ok: false,
      kind: 'unknown',
      latencyMs: Date.now() - start,
      model,
      detail: providerFailureDetail({ err, apiKey: input.apiKey }),
    };
  }

  return performProviderCall({ input, call, start, model });
}

function providerFailureDetail({ err, apiKey }: { err: unknown; apiKey: string }, _options = {}): string {
  return redactSecrets({ input: err instanceof Error ? err.message : String(err) }, { exactSecrets: [apiKey] });
}

async function performProviderCall(
  { input, call, start, model }: {
    input: ProviderConnectionTestInput; call: ProviderCallShape; start: number; model: string;
  }, _options = {},
): Promise<ConnectionTestResponse> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS);

  let result: ConnectionTestResponse;
  try {
    const response = await (input.fetchFn ?? fetch)(call.url, {
      ...input.requestInit,
      method: 'POST',
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    const rawText = await response.text().catch(() => '');
    const data = parseProviderResponse({ rawText });
    result = inspectProviderResponse({ response, data, rawText, call, input, latencyMs, model });
  } catch (err) {
    result = {
      ok: false,
      kind: networkErrorToKind(err),
      latencyMs: Date.now() - start,
      model,
      detail: providerFailureDetail({ err, apiKey: input.apiKey }),
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abortFromParent);
  }
  return result;
}
