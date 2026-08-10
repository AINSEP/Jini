/**
 * Shared plumbing for every OpenAI-wire-compatible vendor (OpenAI itself,
 * ImageRouter, custom-image, and — in a later pass — AIHubMix): URL
 * building (including Azure OpenAI deployment detection), response
 * parsing, and byte extraction. Ported near-verbatim from the shared
 * helpers inside Open Design's `apps/daemon/src/media/index.ts` — see
 * `source-map.md`.
 */
import type { MediaGenerationRequestInit, MediaSpeechFormat, RenderContext } from './types.js';

const VALID_SPEECH_FORMATS: ReadonlySet<MediaSpeechFormat> = new Set(['mp3', 'wav', 'flac', 'aac', 'opus']);

/** OpenAI's recognized `/audio/speech` voice ids — shared by every vendor whose TTS wire shape matches OpenAI's (OpenAI itself, AIHubMix). A requested voice outside this set is treated by callers as free-form speaking-style instructions rather than a voice id (see `openai.ts`'s `renderOpenAISpeech`). */
export const OPENAI_TTS_VOICES: ReadonlySet<string> = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']);

/** Validates a caller-requested speech format, defaulting to `'mp3'` for anything unrecognized. */
export function resolveSpeechFormat(requested: MediaSpeechFormat | undefined): MediaSpeechFormat {
  return requested && VALID_SPEECH_FORMATS.has(requested) ? requested : 'mp3';
}

/** Truncates a string for inclusion in an error message, appending an ellipsis when truncated. */
export function truncate(s: unknown, n: number): string {
  const v = String(s || '');
  if (v.length <= n) return v;
  return v.slice(0, n - 1) + '…';
}

/** Merges a per-request `requestInit` (e.g. a caller-supplied `dispatcher`) under an explicit `init`, so per-call overrides win. */
export function withRequestInit(
  ctx: Pick<RenderContext, 'requestInit'>,
  init: RequestInit = {},
): RequestInit {
  return {
    ...ctx.requestInit,
    ...init,
  };
}

/** Sniffs an image byte buffer's format from its magic bytes (jpg/png/webp), defaulting to `.png`. */
export function sniffImageExt(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return '.jpg';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return '.png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return '.webp';
  }
  return '.png';
}

export const AZURE_DEFAULT_API_VERSION = '2024-02-01';

/**
 * Heuristic: does this base URL point at an Azure OpenAI deployment rather
 * than the public OpenAI API?
 *
 *   true examples
 *     https://x.cognitiveservices.azure.com/openai/deployments/gpt-image-2
 *     https://x.openai.azure.com/openai/deployments/foo
 *     /openai/deployments/foo?api-version=2024-02-01
 *   false examples
 *     https://api.openai.com/v1
 *     http://localhost:8080/v1
 */
export function detectAzureEndpoint(baseUrl: string): boolean {
  if (typeof baseUrl !== 'string' || !baseUrl) return false;
  if (/\.azure\.com\b/i.test(baseUrl)) return true;
  if (/\/openai\/deployments\//i.test(baseUrl)) return true;
  return false;
}

/** Rewrites a pathname to end in `/{endpoint}/generations` or (images only) `/images/edits`, preserving any other path prefix. */
export function normalizeOpenAICompatiblePath(
  pathname: string,
  endpoint: 'images' | 'videos',
  mode: 'generations' | 'edits',
): string {
  const strippedPath = pathname.replace(/\/+$/, '');
  const generationsSuffix = `/${endpoint}/generations`;
  const editsSuffix = endpoint === 'images' ? '/images/edits' : null;
  if (strippedPath.endsWith(generationsSuffix)) {
    if (mode === 'generations') return strippedPath;
    return endpoint === 'images' ? `${strippedPath.slice(0, -generationsSuffix.length)}${editsSuffix}` : strippedPath;
  }
  if (editsSuffix && strippedPath.endsWith(editsSuffix)) {
    if (mode === 'edits') return strippedPath;
    return `${strippedPath.slice(0, -editsSuffix.length)}${generationsSuffix}`;
  }
  return mode === 'edits' && editsSuffix ? `${strippedPath}${editsSuffix}` : `${strippedPath}${generationsSuffix}`;
}

/** Builds the full `/{endpoint}/generations` URL, preserving any user-supplied query string. */
export function buildOpenAICompatibleGenerationUrl(baseUrl: string, endpoint: 'images' | 'videos'): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    const stripped = baseUrl.replace(/\/$/, '');
    return normalizeOpenAICompatiblePath(stripped, endpoint, 'generations');
  }
  parsed.pathname = normalizeOpenAICompatiblePath(parsed.pathname, endpoint, 'generations');
  return parsed.toString();
}

/** Builds the `/images/generations` URL, appending the default Azure `api-version` when the caller didn't supply one. */
export function buildOpenAIImageUrl(baseUrl: string, isAzure: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(buildOpenAICompatibleGenerationUrl(baseUrl, 'images'));
  } catch {
    // Bad URL — fall back to naive concat so the upstream error is
    // surfaced through the normal HTTP path rather than a parse crash.
    return buildOpenAICompatibleGenerationUrl(baseUrl, 'images');
  }
  if (isAzure && !parsed.searchParams.has('api-version')) {
    parsed.searchParams.set('api-version', AZURE_DEFAULT_API_VERSION);
  }
  return parsed.toString();
}

/** Builds the `/images/edits` URL (used when a reference image is present). */
export function buildOpenAIImageEditUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    const stripped = baseUrl.replace(/\/$/, '');
    return normalizeOpenAICompatiblePath(stripped, 'images', 'edits');
  }
  parsed.pathname = normalizeOpenAICompatiblePath(parsed.pathname, 'images', 'edits');
  return parsed.toString();
}

/** Builds the `/videos/generations` URL. */
export function buildOpenAIVideoUrl(baseUrl: string): string {
  return buildOpenAICompatibleGenerationUrl(baseUrl, 'videos');
}

/** Picks an image `size` string tuned to the model family + requested aspect ratio. */
export function openaiSizeFor(model: string, aspect?: string): string {
  // gpt-image-1.5 / gpt-image-2 accept arbitrary sizes up to 4096; concrete
  // sizes tuned to common aspects are picked so the API never negotiates
  // them down silently.
  if (model.startsWith('gpt-image-')) {
    if (aspect === '16:9') return '1792x1024';
    if (aspect === '9:16') return '1024x1792';
    if (aspect === '4:3') return '1408x1056';
    if (aspect === '3:4') return '1056x1408';
    return '1024x1024';
  }
  if (model === 'dall-e-3') {
    if (aspect === '16:9') return '1792x1024';
    if (aspect === '9:16') return '1024x1792';
    return '1024x1024';
  }
  // dall-e-2 only supports 256/512/1024 squares.
  return '1024x1024';
}

/** Builds the `/audio/speech` URL, appending the default Azure `api-version` when the caller didn't supply one. */
export function buildOpenAISpeechUrl(baseUrl: string, isAzure: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    const stripped = baseUrl.replace(/\/$/, '');
    return `${stripped}/audio/speech`;
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/audio/speech';
  if (isAzure && !parsed.searchParams.has('api-version')) {
    parsed.searchParams.set('api-version', AZURE_DEFAULT_API_VERSION);
  }
  return parsed.toString();
}

/** Parses an OpenAI-compatible JSON response, throwing a clear, provider-tagged error on a non-OK status or non-JSON body. */
export async function parseOpenAICompatibleJson(resp: Response, providerTag: string): Promise<unknown> {
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${providerTag} ${resp.status}: ${truncate(text, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${providerTag} non-JSON response: ${truncate(text, 200)}`);
  }
}

/** Extracts generated bytes from an OpenAI-compatible `{ data: [{ b64_json | url }] }` response. */
export async function bytesFromOpenAICompatibleData(
  data: unknown,
  providerTag: string,
  requestInit: MediaGenerationRequestInit = {},
): Promise<Buffer> {
  const record = data as { data?: unknown } | null;
  const entry = record && Array.isArray(record.data) ? (record.data[0] as Record<string, unknown> | undefined) : undefined;
  if (!entry) throw new Error(`${providerTag} response had no data[0]`);
  if (typeof entry.b64_json === 'string' && entry.b64_json) {
    const raw = entry.b64_json.includes(',') ? entry.b64_json.slice(entry.b64_json.indexOf(',') + 1) : entry.b64_json;
    return Buffer.from(raw, 'base64');
  }
  if (typeof entry.url === 'string' && entry.url) {
    const mediaResp = await fetch(entry.url, requestInit);
    if (!mediaResp.ok) {
      throw new Error(`${providerTag} media fetch ${mediaResp.status}`);
    }
    const arr = await mediaResp.arrayBuffer();
    return Buffer.from(arr);
  }
  throw new Error(`${providerTag} response had neither b64_json nor url`);
}
