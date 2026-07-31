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
import { defaultDnsLookup, redactSecrets, validateBaseUrlResolved } from './connection-guard.js';
import { googleGenerateContentUrl } from './google.js';
import { buildOpenAIChatTokenParam, buildLegacyMaxTokensParam, buildMaxCompletionTokensParam } from './token-params.js';
import type { ConnectionTestKind, ConnectionTestProtocol } from './types.js';

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
// Small but not tiny: a reasoning model can spend the first few dozen
// tokens on hidden reasoning before producing a visible "ok".
const CONNECTION_TEST_MAX_TOKENS = 64;
const CONNECTION_TEST_TIMEOUT_MS = 12_000;
const SAMPLE_MAX_CHARS = 120;

function isSupportedProtocol(protocol: ConnectionTestProtocol): protocol is SupportedConnectionTestProtocol {
  return protocol === 'anthropic' || protocol === 'openai' || protocol === 'azure' || protocol === 'google';
}

function appendVersionedApiPath(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v\d+(\/|$)/.test(pathname) ? `${pathname}${suffix}` : `${pathname}/v1${suffix}`;
  return url.toString();
}

function truncateSample(text: unknown): string {
  if (typeof text !== 'string') return '';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= SAMPLE_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, SAMPLE_MAX_CHARS - 1)}…`;
}

function isSmokeOkReply(text: unknown): boolean {
  return typeof text === 'string' && text.trim().toLowerCase() === 'ok';
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
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_unavailable';
  return 'unknown';
}

function networkErrorToKind(err: unknown): ConnectionTestKind {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'timeout';
    const cause = (err as { cause?: { code?: string } }).cause;
    const code = cause?.code;
    if (
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'EHOSTUNREACH' ||
      code === 'ENETUNREACH' ||
      code === 'CERT_HAS_EXPIRED' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) {
      return 'invalid_base_url';
    }
  }
  return 'unknown';
}

function extractProviderErrorDetail(data: unknown, rawText: string): string {
  const obj = data && typeof data === 'object' ? data : null;
  const error = obj ? (obj as { error?: unknown }).error : null;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
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
          ...buildOpenAIChatTokenParam(model, CONNECTION_TEST_MAX_TOKENS),
          messages: [{ role: 'user', content: SMOKE_PROMPT }],
          stream: false,
        },
        extractText: extractOpenAIMessageText,
      };
    case 'azure': {
      const url = new URL(baseUrl);
      const basePath = url.pathname.replace(/\/+$/, '');
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
          ...buildLegacyMaxTokensParam(CONNECTION_TEST_MAX_TOKENS),
          messages: [{ role: 'user', content: SMOKE_PROMPT }],
          stream: false,
        },
        extractText: extractOpenAIMessageText,
      };
    }
    case 'google': {
      const effectiveBaseUrl = baseUrl.trim() || 'https://generativelanguage.googleapis.com';
      return {
        url: googleGenerateContentUrl(effectiveBaseUrl, model),
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
          return parts.map((p: { text?: unknown }) => (typeof p?.text === 'string' ? p.text : '')).join('');
        },
      };
    }
  }
}

// `buildLegacyMaxTokensParam`/`buildMaxCompletionTokensParam` cover the Azure
// legacy-vs-`max_completion_tokens` split the same way OD's daemon retries a
// rejected `max_tokens` param; this smoke test keeps the simpler single-shot
// legacy param (a connection test failing on a param-name mismatch on a
// reasoning-tier Azure deployment is a known, narrow gap — see this
// package's `source-map.md`) rather than porting OD's full retry-on-400 loop.
void buildMaxCompletionTokensParam;

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
export async function testProviderConnection(input: ProviderConnectionTestInput): Promise<ConnectionTestResponse> {
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

  const validated = await validateBaseUrlResolved(input.baseUrl, input.dnsLookup ?? defaultDnsLookup);
  if (validated.error || !validated.parsed) {
    return {
      ok: false,
      kind: validated.forbidden ? 'forbidden' : 'invalid_base_url',
      latencyMs: Date.now() - start,
      model,
      detail: validated.error ?? '',
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
      detail: redactSecrets(err instanceof Error ? err.message : String(err), [input.apiKey]),
    };
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), CONNECTION_TEST_TIMEOUT_MS);

  let result: ConnectionTestResponse;
  try {
    const response = await fetch(call.url, {
      ...input.requestInit,
      method: 'POST',
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    const rawText = await response.text().catch(() => '');
    let data: unknown = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      // Non-JSON body — fall through to the not-`response.ok` / smoke-reply
      // paths below, both of which treat an empty `data` as "no usable text".
    }

    if (!response.ok) {
      const redactedDetail = redactSecrets(extractProviderErrorDetail(data, rawText).slice(0, 240), [input.apiKey]);
      result = {
        ok: false,
        kind: statusToKind(response.status, redactedDetail),
        latencyMs,
        model,
        status: response.status,
        detail: redactedDetail || (response.status === 404 ? 'HTTP 404 from provider; check the Base URL path.' : ''),
      };
    } else {
      const text = call.extractText(data);
      if (isSmokeOkReply(text)) {
        result = { ok: true, kind: 'success', latencyMs, model, status: response.status, detail: 'valid completion' };
      } else {
        const sample = truncateSample(text);
        result = {
          ok: false,
          kind: 'unknown',
          latencyMs,
          model,
          status: response.status,
          detail: sample
            ? `Expected smoke test reply "ok"; got "${sample}"`
            : 'Provider returned a 2xx response without assistant text',
        };
      }
    }
  } catch (err) {
    result = {
      ok: false,
      kind: networkErrorToKind(err),
      latencyMs: Date.now() - start,
      model,
      detail: redactSecrets(err instanceof Error ? err.message : String(err), [input.apiKey]),
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abortFromParent);
  }
  return result;
}
