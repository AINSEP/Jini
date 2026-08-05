/**
 * @module providers/model-catalog
 *
 * Live model-catalog discovery for BYOK providers (OpenAI-compatible,
 * Anthropic, Google, AIHubMix, SenseAudio, plus static seeds for Bedrock and
 * an explicit "unsupported" response for Azure). Ported from OD's
 * `integrations/provider-models.ts` (`listProviderModels`) with its
 * upstream contracts-package type imports repointed at this package's own
 * vendored `types.ts`, and its `../connectionTest.js` SSRF-guard /
 * secret-redaction imports repointed at this package's own vendored
 * `connection-guard.ts` (see that module's doc comment for what was and
 * wasn't pulled from the 2,600-line origin file). Logic is otherwise
 * unchanged — product-neutral as found (a bare BYOK-protocol model lister,
 * no OD-branded strings).
 */

import type { DnsLookupFn } from './connection-guard.js';
import { defaultDnsLookup, redactSecrets, validateBaseUrlResolved } from './connection-guard.js';
import { aihubmixCatalogUrl, aihubmixHeaders, parseAIHubMixCatalog } from './aihubmix.js';
import { googleProviderModelsUrl, normalizeGoogleModelId } from './google.js';
import type {
  ConnectionTestKind,
  ConnectionTestProtocol,
  ProviderModelOption,
  ProviderModelsRequest,
  ProviderModelsResponse,
} from './types.js';

export type ProviderModelsInput = ProviderModelsRequest & {
  signal?: AbortSignal;
  requestInit?: Pick<RequestInit, 'dispatcher'>;
  /** Injectable DNS resolver for the base-URL SSRF guard; defaults to `node:dns`. */
  dnsLookup?: DnsLookupFn;
};

const PROVIDER_MODELS_TIMEOUT_MS = 12_000;

// Every protocol `providerModelsUrl` resolves an endpoint for EXCEPT
// `aihubmix` — its catalogue is public and `providerModelsHeaders` already
// sends no `Authorization` for a blank key (see that function's own
// comment). For the rest, an empty key is never a legitimate request: the
// provider will reject it, but with a generic "no credential" error that
// reads as a broken integration rather than a missing key. Failing fast
// here, before any network access, turns that into a clear local message
// instead — the same class of gap for every one of these protocols (not
// just Google, where an operator first reported it).
const PROTOCOLS_REQUIRING_API_KEY = new Set<ConnectionTestProtocol>(['openai', 'senseaudio', 'anthropic', 'google']);

function missingApiKeyResponse(startedAt: number): ProviderModelsResponse {
  return {
    ok: false,
    kind: 'auth_failed',
    latencyMs: Date.now() - startedAt,
    detail: 'No API key — model discovery needs the key from this browser.',
  };
}
const BEDROCK_MODEL_OPTIONS: ProviderModelOption[] = [
  { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2' },
  { id: 'anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku' },
  { id: 'anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude 3 Haiku' },
  { id: 'amazon.nova-pro-v1:0', label: 'Amazon Nova Pro' },
  { id: 'amazon.nova-lite-v1:0', label: 'Amazon Nova Lite' },
  { id: 'amazon.nova-micro-v1:0', label: 'Amazon Nova Micro' },
];

function appendVersionedApiPath(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = /\/v\d+(\/|$)/.test(pathname)
    ? `${pathname}${suffix}`
    : `${pathname}/v1${suffix}`;
  return url.toString();
}

function statusToKind(status: number): ConnectionTestKind {
  if (status === 401) return 'auth_failed';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'invalid_base_url';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_unavailable';
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

function uniqueModels(models: ProviderModelOption[]): ProviderModelOption[] {
  const seen = new Set<string>();
  const out: ProviderModelOption[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: model.label.trim() || id });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function isOpenAiChatModelId(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  if (!normalized) return false;
  if (
    normalized.includes('embedding') ||
    normalized.includes('moderation') ||
    normalized.includes('rerank') ||
    normalized.includes('whisper') ||
    normalized.includes('tts') ||
    normalized.includes('transcribe') ||
    normalized.includes('speech') ||
    normalized.includes('image') ||
    normalized.includes('video') ||
    normalized.includes('dall-e') ||
    normalized.includes('stable-diffusion') ||
    normalized.includes('flux') ||
    (
      normalized.includes('wan') &&
      /(?:^|[-_.:])(?:t2v|i2v|v2v)(?:[-_.:]|$)/u.test(normalized)
    )
  ) {
    return false;
  }
  return !/(?:^|[-_.:])(?:t2i|i2i|t2v|i2v|v2v|tts|asr|ocr)(?:[-_.:]|$)/u.test(normalized);
}

function extractOpenAiModels(data: unknown): ProviderModelOption[] {
  const items = (data as { data?: unknown }).data;
  if (!Array.isArray(items)) return [];
  return uniqueModels(
    items
      .map((item) => (item as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .filter(isOpenAiChatModelId)
      .map((id) => ({ id, label: id })),
  );
}

function extractAnthropicModels(data: unknown): ProviderModelOption[] {
  const items = (data as { data?: unknown }).data;
  if (!Array.isArray(items)) return [];
  return uniqueModels(
    items
      .map((item) => {
        const obj = item && typeof item === 'object'
          ? item as { id?: unknown; display_name?: unknown; displayName?: unknown }
          : null;
        const id = typeof obj?.id === 'string' ? obj.id : '';
        const label =
          typeof obj?.display_name === 'string'
            ? obj.display_name
            : typeof obj?.displayName === 'string'
              ? obj.displayName
              : id;
        return id ? { id, label } : null;
      })
      .filter((item): item is ProviderModelOption => item != null),
  );
}

function googleModelId(rawName: unknown, rawBaseModelId: unknown): string {
  if (typeof rawBaseModelId === 'string' && rawBaseModelId.trim()) {
    return normalizeGoogleModelId(rawBaseModelId);
  }
  if (typeof rawName !== 'string') return '';
  return normalizeGoogleModelId(rawName);
}

function supportsGoogleGenerateContent(item: unknown): boolean {
  const methods = (item as { supportedGenerationMethods?: unknown; supported_actions?: unknown })
    ?.supportedGenerationMethods
    ?? (item as { supported_actions?: unknown })?.supported_actions;
  return Array.isArray(methods) && methods.includes('generateContent');
}

function extractGoogleModels(data: unknown): ProviderModelOption[] {
  const items = (data as { models?: unknown }).models;
  if (!Array.isArray(items)) return [];
  return uniqueModels(
    items
      // supportsGoogleGenerateContent only returns true for an item whose
      // (optionally-chained) supportedGenerationMethods/supported_actions
      // resolves to an array — a non-object item can never satisfy that, so
      // every item reaching .map() below is already known to be an object.
      // No redundant `typeof item === 'object'` re-check here.
      .filter(supportsGoogleGenerateContent)
      .map((item) => {
        const obj = item as { name?: unknown; baseModelId?: unknown; displayName?: unknown };
        const id = googleModelId(obj.name, obj.baseModelId);
        const label = typeof obj.displayName === 'string' && obj.displayName.trim()
          ? obj.displayName
          : id;
        return id ? { id, label } : null;
      })
      .filter((item): item is ProviderModelOption => item != null),
  );
}

function providerModelsUrl(protocol: ConnectionTestProtocol, baseUrl: string, apiKey: string): string {
  if (protocol === 'aihubmix') {
    // AIHubMix exposes its chat catalogue on a dedicated endpoint
    // (GET /api/v1/models?type=llm), not the OpenAI /v1/models route.
    return aihubmixCatalogUrl(baseUrl, 'llm');
  }
  if (protocol === 'openai' || protocol === 'senseaudio') {
    return appendVersionedApiPath(baseUrl, '/models');
  }
  if (protocol === 'anthropic') {
    const url = new URL(appendVersionedApiPath(baseUrl, '/models'));
    url.searchParams.set('limit', '1000');
    return url.toString();
  }
  if (protocol === 'google') {
    return googleProviderModelsUrl(baseUrl, apiKey);
  }
  throw new Error(`Unsupported protocol: ${protocol}`);
}

function providerModelsHeaders(
  protocol: ConnectionTestProtocol,
  apiKey: string,
): Record<string, string> {
  if (protocol === 'openai' || protocol === 'senseaudio') {
    return { authorization: `Bearer ${apiKey}` };
  }
  if (protocol === 'aihubmix') {
    // The catalogue is public — only attach Bearer auth (+ APP-Code) when the
    // caller actually supplied a key. An empty `Bearer ` would be rejected by
    // some gateways, so send no headers when the key is blank.
    return apiKey.trim() ? aihubmixHeaders(apiKey) : {};
  }
  if (protocol === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return {};
}

// Only the protocols `providerModelsUrl` actually resolves a listing
// endpoint for — `listProviderModels` short-circuits `azure`/`bedrock`
// before this point, and `providerModelsUrl` itself throws for every other
// `ConnectionTestProtocol` value, so this function is only ever called with
// one of these five. Narrowing the parameter type (rather than accepting
// the full `ConnectionTestProtocol` union with a defensive `return []`
// fallback) keeps the if-chain exhaustive without an unreachable branch.
type ModelListProtocol = 'aihubmix' | 'openai' | 'senseaudio' | 'anthropic' | 'google';

function extractModels(protocol: ModelListProtocol, data: unknown): ProviderModelOption[] {
  // SenseAudio's /v1/models response follows the OpenAI envelope
  // (`{ data: [{ id, ... }] }`), so the same extractor handles both.
  // Chat picker: drop media-generation rows. AIHubMix's `?type=llm` matches any
  // model whose `types` merely contains `llm`, so dual-tagged image models
  // (e.g. gpt-image-2 -> "image_generation,llm") would otherwise leak in. Those
  // belong to the dedicated image/video/audio pickers.
  if (protocol === 'aihubmix') return parseAIHubMixCatalog(data, { chatOnly: true });
  if (protocol === 'openai' || protocol === 'senseaudio') return extractOpenAiModels(data);
  if (protocol === 'anthropic') return extractAnthropicModels(data);
  return extractGoogleModels(data);
}

/**
 * Fetches the live model catalog for a BYOK provider connection. Validates
 * the base URL (sync + DNS-resolved SSRF guard) before issuing any request,
 * dispatches per-protocol (a static seed for Bedrock, an explicit
 * "unsupported" response for Azure), and normalizes every provider's
 * response envelope into a de-duplicated, alphabetized `{ id, label }[]`.
 */
export async function listProviderModels(
  input: ProviderModelsInput,
): Promise<ProviderModelsResponse> {
  const start = Date.now();
  if (input.protocol === 'azure') {
    return {
      ok: false,
      kind: 'unsupported_protocol',
      latencyMs: Date.now() - start,
      detail: 'Azure OpenAI deployment discovery is not supported from the inference endpoint.',
    };
  }

  const validated = await validateBaseUrlResolved(input.baseUrl, input.dnsLookup ?? defaultDnsLookup);
  if (validated.error || !validated.parsed) {
    return {
      ok: false,
      kind: validated.forbidden ? 'forbidden' : 'invalid_base_url',
      latencyMs: Date.now() - start,
      // Non-null assertion, not a runtime guard: every BaseUrlValidationResult
      // this branch's guard condition can produce sets `error` alongside a
      // missing `parsed` (connection-guard.ts never returns neither/both) —
      // `?? ''` would satisfy the `detail: string` type too, but per this
      // package's coverage-loop policy an assertion is more honest about
      // "TS requires an `undefined` guard here that can't actually occur".
      detail: validated.error!,
    };
  }
  if (input.protocol === 'bedrock') {
    return {
      ok: true,
      kind: 'success',
      latencyMs: Date.now() - start,
      models: BEDROCK_MODEL_OPTIONS,
      detail: 'AWS Bedrock uses a static seed until AWS credential-backed discovery is available.',
    };
  }
  if (PROTOCOLS_REQUIRING_API_KEY.has(input.protocol) && !input.apiKey.trim()) {
    return missingApiKeyResponse(start);
  }

  let url: string;
  try {
    url = providerModelsUrl(input.protocol, input.baseUrl, input.apiKey);
  } catch (err) {
    return {
      ok: false,
      kind: 'unsupported_protocol',
      latencyMs: Date.now() - start,
      // `providerModelsUrl`'s only throw site is `throw new Error(...)`; the
      // cast (rather than an `instanceof` guard) documents that the
      // non-Error case can't occur here without adding an untestable branch.
      detail: (err as Error).message,
    };
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (input.signal?.aborted) {
    controller.abort();
  } else {
    input.signal?.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), PROVIDER_MODELS_TIMEOUT_MS);

  // `result` + a trailing `return result;` after the try/catch/finally,
  // rather than returning directly from inside `catch` (every return inside
  // `try` stays a direct early return): a v8/istanbul coverage-instrumentation
  // artifact, re-derived empirically for this exact shape (a minimal
  // `try { return A } catch { return B } finally {}` repro reproduces an
  // uncoverable phantom branch at the `finally` clause's own opening brace,
  // regardless of which/how many try/catch paths a test exercises — verified
  // with `success`, `try-throws-then-caught`, and `throw-from-inside-catch`
  // scenarios, all leaving the same phantom branch at 0). Only `catch`
  // needed to change: with `try`'s own returns direct and only `catch`
  // falling through, the phantom branch doesn't appear (also re-derived).
  // TypeScript accepts `result` as definitely assigned at the trailing
  // `return` because every real path through `try` above already returns or
  // throws — the only way to fall through to it is via `catch`, which
  // assigns unconditionally.
  let result: ProviderModelsResponse;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: providerModelsHeaders(input.protocol, input.apiKey),
      ...input.requestInit,
      signal: controller.signal,
      redirect: 'error',
    });
    const latencyMs = Date.now() - start;
    const rawText = await response.text();
    let data: unknown = {};
    let parseError: string | undefined;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (err) {
      // JSON.parse only ever throws a SyntaxError (an Error); the cast
      // documents that rather than adding an untestable non-Error branch.
      parseError = (err as Error).message;
    }

    if (!response.ok) {
      const detail = parseError
        ? rawText.trim().slice(0, 240) || parseError
        : extractProviderErrorDetail(data, rawText);
      return {
        ok: false,
        kind: statusToKind(response.status),
        latencyMs,
        status: response.status,
        detail: redactSecrets(detail, [input.apiKey]),
      };
    }

    if (parseError) {
      return {
        ok: false,
        kind: 'unknown',
        latencyMs,
        status: response.status,
        detail: redactSecrets(parseError, [input.apiKey]),
      };
    }

    // Safe: `url` above only resolves for the five protocols
    // `ModelListProtocol` covers (providerModelsUrl throws for every other
    // ConnectionTestProtocol, and azure/bedrock already returned above).
    const models = extractModels(input.protocol as ModelListProtocol, data);
    if (models.length === 0) {
      return {
        ok: false,
        kind: 'no_models',
        latencyMs,
        status: response.status,
        detail: 'Provider returned no usable text-generation models.',
      };
    }
    return {
      ok: true,
      kind: 'success',
      latencyMs,
      status: response.status,
      models,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const kind = networkErrorToKind(err);
    const message = err instanceof Error ? err.message : String(err);
    result = {
      ok: false,
      kind,
      latencyMs,
      detail: redactSecrets(message, [input.apiKey]),
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abortFromParent);
  }
  return result;
}
