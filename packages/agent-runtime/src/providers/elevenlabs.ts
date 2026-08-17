/**
 * @module providers/elevenlabs
 *
 * ElevenLabs voice-catalog listing (`GET /v2/voices`), with a short in-memory
 * TTL cache keyed by workspace + base URL + page size + a credential
 * fingerprint (never the raw key). Ported from OD's
 * `integrations/elevenlabs-voices.ts`.
 *
 * De-branded: the origin resolved the API key/base URL via OD's own
 * `resolveProviderConfig` (`../media/config.js`, a product-owned
 * settings-store reader entirely out of this package's scope) and threw a
 * hardcoded product-prefixed env-var hint (see `source-map.md` for the
 * exact original string). Both are replaced by an
 * injected {@link ElevenLabsCredentialResolver} port — a host supplies its
 * own settings-store/env lookup; this package only knows how to call the
 * ElevenLabs wire API once it has a key.
 */
import { createHash } from 'node:crypto';
import { FETCH_TIMEOUT_MS, fetchWithTimeout } from '@jini-ai/platform';

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
export type ElevenLabsCredentialResolver = (workspaceKey: string) => Promise<ElevenLabsCredentials>;

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

const voiceOptionsCache = new Map<string, VoiceCacheEntry>();

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

/**
 * Lists the ElevenLabs voice catalog for a workspace, resolving credentials
 * via the injected {@link ElevenLabsCredentialResolver} and caching the
 * result for {@link ELEVENLABS_VOICE_CACHE_TTL_MS}. Throws
 * {@link ElevenLabsCredentialMissingError} when no API key is configured.
 */
export async function listElevenLabsVoiceOptions(
  workspaceKey: string,
  resolveCredentials: ElevenLabsCredentialResolver,
  options: {
    limit?: number;
    requestInit?: Pick<RequestInit, 'dispatcher'>;
  } = {},
): Promise<ElevenLabsVoiceOption[]> {
  const credentials = await resolveCredentials(workspaceKey);
  if (!credentials.apiKey) {
    throw new ElevenLabsCredentialMissingError();
  }

  const baseUrl = (credentials.baseUrl || ELEVENLABS_DEFAULT_BASE_URL).replace(
    /\/$/,
    '',
  );
  const pageSize = clampLimit(options.limit);
  const cacheKey = voiceCacheKey({
    workspaceKey,
    baseUrl,
    apiKey: credentials.apiKey,
    pageSize,
  });
  const cached = voiceOptionsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cloneVoiceOptions(cached.voices);
  }

  const resp = await fetchWithTimeout(
    `${baseUrl}/v2/voices?page_size=${pageSize}`,
    {
      ...options.requestInit,
      method: 'GET',
      headers: {
        'xi-api-key': credentials.apiKey,
        accept: 'application/json',
      },
    },
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`elevenlabs voices ${resp.status}: ${errText.slice(0, 240)}`);
  }

  const payload = await resp.json() as unknown;
  const rawVoices = isRecord(payload) && Array.isArray(payload.voices)
    ? payload.voices
    : [];
  const voices = rawVoices
    .map((voice) => normalizeVoice(voice))
    .filter((voice): voice is ElevenLabsVoiceOption => voice !== null);
  voiceOptionsCache.set(cacheKey, {
    expiresAt: now + ELEVENLABS_VOICE_CACHE_TTL_MS,
    voices: cloneVoiceOptions(voices),
  });
  return voices;
}
