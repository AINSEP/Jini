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
import { defaultDnsLookup, validateBaseUrlResolved } from './connection-guard.js';
import {
  appendVersionedApiPath,
  baseUrlRefusal,
  errorMessage,
  extractProviderErrorDetail,
  networkErrorToKind,
  parseJsonBody,
  redactApiKey,
  statusToKind,
  withRequestDeadline,
} from './provider-http.js';
import { aihubmixCatalogUrl, aihubmixHeaders, parseAIHubMixCatalog } from './aihubmix.js';
import { googleProviderModelsUrl, normalizeGoogleModelId } from './google.js';
import type {
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
  /** Injectable HTTP transport for adapter conformance; defaults to fetch. */
  fetchFn?: typeof fetch;
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
    detail: 'No API key saved. Save one to load models.',
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

// Media-generation / non-chat families that share the OpenAI `/v1/models`
// listing with chat models. A `wan` video model's `t2v`/`i2v`/`v2v` task tag is
// already caught by NON_CHAT_TASK_TAG below, so it needs no separate rule.
const NON_CHAT_MODEL_FRAGMENTS = [
  'embedding', 'moderation', 'rerank', 'whisper', 'tts', 'transcribe', 'speech',
  'image', 'video', 'dall-e', 'stable-diffusion', 'flux',
];
const NON_CHAT_TASK_TAG = /(?:^|[-_.:])(?:t2i|i2i|t2v|i2v|v2v|tts|asr|ocr)(?:[-_.:]|$)/u;

function isOpenAiChatModelId(id: string): boolean {
  const normalized = id.trim().toLowerCase();
  if (!normalized) return false;
  if (NON_CHAT_MODEL_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return false;
  return !NON_CHAT_TASK_TAG.test(normalized);
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
    return normalizeGoogleModelId({ model: rawBaseModelId });
  }
  if (typeof rawName !== 'string') return '';
  return normalizeGoogleModelId({ model: rawName });
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
    return aihubmixCatalogUrl({ baseUrl: baseUrl, type: 'llm' });
  }
  if (protocol === 'openai' || protocol === 'senseaudio') {
    return appendVersionedApiPath({ baseUrl, suffix: '/models' });
  }
  if (protocol === 'anthropic') {
    const url = new URL(appendVersionedApiPath({ baseUrl, suffix: '/models' }));
    url.searchParams.set('limit', '1000');
    return url.toString();
  }
  if (protocol === 'google') {
    return googleProviderModelsUrl({ baseUrl: baseUrl, apiKey: apiKey });
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
    return apiKey.trim() ? aihubmixHeaders({ apiKey: apiKey }) : {};
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
  if (protocol === 'aihubmix') return parseAIHubMixCatalog({ data: data }, { chatOnly: true });
  if (protocol === 'openai' || protocol === 'senseaudio') return extractOpenAiModels(data);
  if (protocol === 'anthropic') return extractAnthropicModels(data);
  return extractGoogleModels(data);
}

const MAX_CATALOG_PAGES = 100;
const CURSOR_PARAMS: Partial<Record<ConnectionTestProtocol, string>> = { google: 'pageToken', anthropic: 'after_id' };

type PageEnvelope = { nextPageToken?: unknown; has_more?: unknown; last_id?: unknown; next_cursor?: unknown };

function pageCursor(protocol: ConnectionTestProtocol, envelope: PageEnvelope): string | undefined {
  if (protocol === 'google' && typeof envelope.nextPageToken === 'string') return envelope.nextPageToken;
  if (envelope.has_more === true && typeof envelope.last_id === 'string') return envelope.last_id;
  return typeof envelope.next_cursor === 'string' ? envelope.next_cursor : undefined;
}

/** The next page's cursor, `{}` on the last page, or why pagination cannot continue. */
function nextPage({ protocol, data, cursors }: { protocol: ConnectionTestProtocol; data: unknown; cursors: Set<string> }): { cursor?: string | undefined; error?: string } {
  const envelope: PageEnvelope = data && typeof data === 'object' ? data : {};
  const cursor = pageCursor(protocol, envelope);
  if (envelope.has_more === true && !cursor) return { error: 'Provider omitted its pagination cursor.' };
  if (cursor && cursors.has(cursor)) return { error: 'Provider repeated a pagination cursor.' };
  return { cursor };
}

type CatalogPage =
  | { ok: true; data: unknown; latencyMs: number; status: number }
  | { ok: false; failure: ProviderModelsResponse };

async function fetchCatalogPage({ input, url, start, signal }: { input: ProviderModelsInput; url: string; start: number; signal: AbortSignal }): Promise<CatalogPage> {
  const response = await (input.fetchFn ?? fetch)(url, {
    method: 'GET',
    headers: providerModelsHeaders(input.protocol, input.apiKey),
    ...input.requestInit,
    signal,
    redirect: 'error',
  });
  const latencyMs = Date.now() - start;
  const rawText = await response.text();
  const { data, parseError } = parseJsonBody(rawText);
  if (!response.ok) {
    // A malformed body leaves `data` as `{}`, so the extractor falls back to
    // the raw text; only a blank one falls further back to the parse error.
    const detail = extractProviderErrorDetail({ data, rawText }) || parseError || '';
    return {
      ok: false,
      failure: {
        ok: false,
        kind: statusToKind({ status: response.status }),
        latencyMs,
        status: response.status,
        detail: redactApiKey({ text: detail, apiKey: input.apiKey }),
      },
    };
  }
  if (parseError) {
    return {
      ok: false,
      failure: { ok: false, kind: 'unknown', latencyMs, status: response.status, detail: redactApiKey({ text: parseError, apiKey: input.apiKey }) },
    };
  }
  return { ok: true, data, latencyMs, status: response.status };
}

function catalogResult({ collected, latencyMs, status }: { collected: ProviderModelOption[]; latencyMs: number; status: number }): ProviderModelsResponse {
  const models = uniqueModels(collected);
  if (models.length === 0) {
    return { ok: false, kind: 'no_models', latencyMs, status, detail: 'Provider returned no usable text-generation models.' };
  }
  return { ok: true, kind: 'success', latencyMs, status, models };
}

async function fetchCatalogPages({ input, url, start, signal }: { input: ProviderModelsInput; url: string; start: number; signal: AbortSignal }): Promise<ProviderModelsResponse> {
  const collected: ProviderModelOption[] = [];
  const cursors = new Set<string>();
  let pageUrl = url;
  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const fetched = await fetchCatalogPage({ input, url: pageUrl, start, signal });
    if (!fetched.ok) return fetched.failure;
    // Safe: `url` above only resolves for the five protocols
    // `ModelListProtocol` covers (providerModelsUrl throws for every other
    // ConnectionTestProtocol, and azure/bedrock already returned above).
    collected.push(...extractModels(input.protocol as ModelListProtocol, fetched.data));
    const next = nextPage({ protocol: input.protocol, data: fetched.data, cursors });
    if (next.error) return { ok: false, kind: 'unknown', latencyMs: fetched.latencyMs, detail: next.error };
    if (!next.cursor) return catalogResult({ collected, latencyMs: fetched.latencyMs, status: fetched.status });
    cursors.add(next.cursor);
    const nextUrl = new URL(pageUrl);
    nextUrl.searchParams.set(CURSOR_PARAMS[input.protocol] ?? 'cursor', next.cursor);
    pageUrl = nextUrl.toString();
  }
  return { ok: false, kind: 'unknown', latencyMs: Date.now() - start, detail: 'Provider pagination exceeded its safety limit.' };
}

/** Every answer `listProviderModels` can give before any network request, or `undefined` to proceed. */
async function catalogPreflight({ input, start }: { input: ProviderModelsInput; start: number }): Promise<ProviderModelsResponse | undefined> {
  if (input.protocol === 'azure') {
    return {
      ok: false,
      kind: 'unsupported_protocol',
      latencyMs: Date.now() - start,
      detail: 'Azure OpenAI deployment discovery is not supported from the inference endpoint.',
    };
  }
  const refusal = baseUrlRefusal(await validateBaseUrlResolved({ baseUrl: input.baseUrl, lookup: input.dnsLookup ?? defaultDnsLookup }));
  if (refusal) return { ok: false, ...refusal, latencyMs: Date.now() - start };
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
  return undefined;
}

/**
 * Fetches the live model catalog for a BYOK provider connection. Validates
 * the base URL (sync + DNS-resolved SSRF guard) before issuing any request,
 * dispatches per-protocol (a static seed for Bedrock, an explicit
 * "unsupported" response for Azure), and normalizes every provider's
 * response envelope into a de-duplicated, alphabetized `{ id, label }[]`.
 */
export async function listProviderModels(requiredArgs: Pick<ProviderModelsInput, "protocol" | "baseUrl" | "apiKey">, optionalArgs: Omit<ProviderModelsInput, "protocol" | "baseUrl" | "apiKey"> = {}
): Promise<ProviderModelsResponse> {
  const input: ProviderModelsInput = { ...optionalArgs, ...requiredArgs };
  const start = Date.now();
  const early = await catalogPreflight({ input, start });
  if (early) return early;

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

  try {
    return await withRequestDeadline(
      { timeoutMs: PROVIDER_MODELS_TIMEOUT_MS, run: (signal) => fetchCatalogPages({ input, url, start, signal }) },
      { signal: input.signal },
    );
  } catch (err) {
    return {
      ok: false,
      kind: networkErrorToKind(err),
      latencyMs: Date.now() - start,
      detail: redactApiKey({ text: errorMessage(err), apiKey: input.apiKey }),
    };
  }
}
