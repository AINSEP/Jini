/**
 * @module providers/elevenlabs
 *
 * ElevenLabs voice-catalog listing (`GET /v2/voices`), with a short in-memory
 * bounded, client-owned TTL cache keyed by workspace + base URL + page size + a credential
 * fingerprint (never the raw key). Ported from OD's
 * `integrations/elevenlabs-voices.ts`.
 *
 * De-branded: the origin resolved the API key/base URL via OD's own
 * `resolveProviderConfig` (`../media/config.js`, a product-owned
 * settings-store reader entirely out of this package's scope) and threw a
 * hardcoded product-prefixed env-var hint (see `archived provenance ledger` for the
 * exact original string). Both are replaced by an
 * injected {@link ElevenLabsCredentialResolver} port — a host supplies its
 * own settings-store/env lookup; this package only knows how to call the
 * ElevenLabs wire API once it has a key.
 */
import { createHash } from 'node:crypto';
import { createSystemClock, type Clock, type HttpClientPort } from '@jini-ai/core/primitives';
import { FETCH_TIMEOUT_MS, fetchWithTimeout } from '@jini-ai/platform/fetch-with-timeout';

const ELEVENLABS_DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const ELEVENLABS_DEFAULT_VOICE_LIMIT = 100;
const ELEVENLABS_MAX_VOICE_LIMIT = 100;
const ELEVENLABS_VOICE_CACHE_TTL_MS = 10 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export interface ElevenLabsVoiceOption {
  voiceId: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  previewUrl?: string;
}

export interface ElevenLabsCredentials {
  apiKey: string;
  baseUrl?: string;
}

/** Host-supplied credential lookup — replaces OD's product-owned settings-store reader. */
export type ElevenLabsCredentialResolver = (requiredArgs: { workspaceKey: string }) => Promise<ElevenLabsCredentials>;

/** Thrown when {@link ElevenLabsCredentialResolver} resolves no API key. */
export class ElevenLabsCredentialMissingError extends Error {
  constructor() {
    super('no ElevenLabs API key configured for this workspace');
    this.name = 'ElevenLabsCredentialMissingError';
  }
}

type VoiceCacheEntry = {
  expiresAt: number;
  voices: ElevenLabsVoiceOption[];
};

export interface ElevenLabsVoiceClientOptions {
  /** Maximum cached workspace/credential/page variants; oldest inserted entries are evicted. */
  maxCacheEntries?: number;
}
export interface ElevenLabsVoiceListRequired {
  workspaceKey: string;
  resolveCredentials: ElevenLabsCredentialResolver;
}
export interface ElevenLabsVoiceListOptions { limit?: number }

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object';
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readLabels(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const labels: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = readString(raw);
    if (normalized) labels[key] = normalized;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

function clampLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return ELEVENLABS_DEFAULT_VOICE_LIMIT;
  }
  return Math.min(
    ELEVENLABS_MAX_VOICE_LIMIT,
    Math.max(1, Math.floor(limit)),
  );
}

function normalizeVoice(value: unknown): ElevenLabsVoiceOption | null {
  if (!isRecord(value)) return null;
  const voiceId = readString(value.voice_id);
  if (!voiceId) return null;
  const name = readString(value.name) || voiceId;
  const category = readString(value.category);
  const previewUrl = readString(value.preview_url);
  const labels = readLabels(value.labels);
  return {
    voiceId,
    name,
    ...(category ? { category } : {}),
    ...(labels ? { labels } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  };
}

function cacheCredentialFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

function voiceCacheKey(input: {
  workspaceKey: string;
  baseUrl: string;
  apiKey: string;
  pageSize: number;
}): string {
  return [
    input.workspaceKey,
    input.baseUrl,
    input.pageSize,
    cacheCredentialFingerprint(input.apiKey),
  ].join('\0');
}

function cloneVoiceOptions(voices: ElevenLabsVoiceOption[]): ElevenLabsVoiceOption[] {
  return voices.map((voice) => ({
    ...voice,
    ...(voice.labels ? { labels: { ...voice.labels } } : {}),
  }));
}

/** Unwraps a `/v2/voices` response; a non-2xx, truncated or non-JSON body throws, unusable rows are dropped. */
function parseVoicesResponse(resp: Awaited<ReturnType<HttpClientPort['send']>>): ElevenLabsVoiceOption[] {
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`elevenlabs voices ${resp.status}: ${resp.bodyText.slice(0, 240)}`);
  }
  if (resp.bodyTruncated) throw new Error('elevenlabs voices response was truncated');
  const payload: unknown = JSON.parse(resp.bodyText);
  const rawVoices = isRecord(payload) && Array.isArray(payload.voices) ? payload.voices : [];
  return rawVoices.map((voice) => normalizeVoice(voice))
    .filter((voice): voice is ElevenLabsVoiceOption => voice !== null);
}

/** Owns transport, time and a bounded voice cache for one host lifecycle.
 * Supply the existing policy-enforcing HTTP client; this factory never constructs a raw transport.
 * @throws RangeError for an invalid cache bound; credential/transport/JSON errors propagate from listing.
 * @complexity O(c + v) per lookup, c <= maxCacheEntries and v <= the requested page size.
 */
export function createElevenLabsVoiceClient(
  { http, clock }: { readonly http: HttpClientPort; readonly clock: Clock },
  { maxCacheEntries = 64 }: ElevenLabsVoiceClientOptions = {},
) {
  if (!Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new RangeError('maxCacheEntries must be a positive safe integer');
  }
  const cache = new Map<string, VoiceCacheEntry>();

  function sweepExpired(now: number): void {
    for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  }

  /** Drops retained voices so a host can release them when its lifecycle ends. */
  function clearCache(): void { cache.clear(); }

  /** Lists and clones credential-scoped catalog values; unsuccessful responses are never cached. */
  async function listVoiceOptions(
    { workspaceKey, resolveCredentials }: ElevenLabsVoiceListRequired,
    options: ElevenLabsVoiceListOptions = {},
  ): Promise<ElevenLabsVoiceOption[]> {
    const credentials = await resolveCredentials({ workspaceKey });
    if (!credentials.apiKey) throw new ElevenLabsCredentialMissingError();
    const baseUrl = (credentials.baseUrl || ELEVENLABS_DEFAULT_BASE_URL).replace(/\/$/, '');
    const pageSize = clampLimit(options.limit);
    const cacheKey = voiceCacheKey({ workspaceKey, baseUrl, apiKey: credentials.apiKey, pageSize });
    sweepExpired(clock.nowMs());
    const cached = cache.get(cacheKey);
    if (cached) return cloneVoiceOptions(cached.voices);

    const resp = await http.send({ request: {
      url: `${baseUrl}/v2/voices?page_size=${pageSize}`,
      method: 'GET',
      headers: { 'xi-api-key': credentials.apiKey, accept: 'application/json' },
      idleTimeoutMs: FETCH_TIMEOUT_MS.QUICK,
      totalDeadlineMs: FETCH_TIMEOUT_MS.QUICK,
      maxResponseBytes: 1024 * 1024,
    } });
    const voices = parseVoicesResponse(resp);
    const now = clock.nowMs();
    sweepExpired(now);
    // Replacing a key refreshes insertion order; concurrent misses cannot grow past the bound.
    cache.delete(cacheKey);
    if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { expiresAt: now + ELEVENLABS_VOICE_CACHE_TTL_MS, voices: cloneVoiceOptions(voices) });
    return voices;
  }

  return { listVoiceOptions, clearCache };
}

export type ElevenLabsVoiceClient = ReturnType<typeof createElevenLabsVoiceClient>;

/** Native defaults stay in this compatibility assembly; injected clients use HttpClientPort directly. */
function createCompatibilityClient(requestInit: Pick<RequestInit, 'dispatcher'> = {}): ElevenLabsVoiceClient {
  return createElevenLabsVoiceClient({ clock: createSystemClock(), http: {
    async send({ request }) {
      const response = await fetchWithTimeout(request.url, {
        ...requestInit, method: request.method, headers: request.headers,
      }, { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      // Same reads as before the port: json() on success, text() for the error message.
      return { status: response.status, headers: {},
        bodyText: response.ok ? JSON.stringify(await response.json()) : await response.text() };
    },
  } });
}

const compatibilityClient = createCompatibilityClient();
const dispatcherClients = new WeakMap<object, ElevenLabsVoiceClient>();

/** Compatibility wrapper for existing callers. New hosts retain an injected client and clear it on shutdown. */
export async function listElevenLabsVoiceOptions(required: ElevenLabsVoiceListRequired, options: {
  limit?: number;
  requestInit?: Pick<RequestInit, 'dispatcher'>;
} = {}): Promise<ElevenLabsVoiceOption[]> {
  let client = compatibilityClient;
  const dispatcher = options.requestInit?.dispatcher;
  // A Dispatcher is always an object instance, so it can key the WeakMap as-is.
  if (dispatcher) {
    let owned = dispatcherClients.get(dispatcher);
    if (!owned) {
      owned = createCompatibilityClient(options.requestInit);
      dispatcherClients.set(dispatcher, owned);
    }
    client = owned;
  }
  return client.listVoiceOptions(required, options);
}
