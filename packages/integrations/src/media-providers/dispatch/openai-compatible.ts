/**
 * Shared plumbing for every OpenAI-wire-compatible vendor (OpenAI itself,
 * ImageRouter, custom-image, and — in a later pass — AIHubMix): URL
 * building (including Azure OpenAI deployment detection), response
 * parsing, and byte extraction. Ported near-verbatim from the shared
 * helpers inside Open Design's `apps/daemon/src/media/index.ts` — see
 * `archived provenance ledger`.
 */
import { assertAndFetchExternalAsset } from './ssrf-guard.js';
import type { MediaOutboundOptions } from './outbound.js';
import type { MediaGenerationRequestInit, MediaSpeechFormat, RenderContext } from './types.js';

const VALID_SPEECH_FORMATS: ReadonlySet<MediaSpeechFormat> = new Set(['mp3', 'wav', 'flac', 'aac', 'opus']);

/** OpenAI's recognized `/audio/speech` voice ids — shared by every vendor whose TTS wire shape matches OpenAI's (OpenAI itself, AIHubMix). A requested voice outside this set is treated by callers as free-form speaking-style instructions rather than a voice id (see `openai.ts`'s `renderOpenAISpeech`). */
export const OPENAI_TTS_VOICES: ReadonlySet<string> = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']);

/** Validates a caller-requested speech format, defaulting to `'mp3'` for anything unrecognized. */
export function resolveSpeechFormat(requested: MediaSpeechFormat | undefined): MediaSpeechFormat {
  return requested && VALID_SPEECH_FORMATS.has(requested) ? requested : 'mp3';
}

/**
 * OpenRouter normalizes aspect ratios across the providers it fronts;
 * `providers.ts`'s `MEDIA_ASPECTS` are all natively supported. xAI's Imagine
 * API accepts a wider list (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2,
 * 19.5:9, 9:19.5, 20:9, 9:20, auto), of which `MEDIA_ASPECTS` is a strict
 * subset. Both mappings pass through the same five values and default to 16:9.
 * Written as independent `if` returns (rather than the origin's one
 * `||`-chained condition) to match the established aspect-mapping style
 * (see `providers/imagerouter.ts`'s `imageRouterSizeFor`) — same input ->
 * output mapping for every case, not a behavior change.
 */
export function standardImageAspectFor(
  { aspect }: { aspect: string | undefined },
  _options: Record<string, never> = {},
): string {
  if (aspect === '1:1') return '1:1';
  if (aspect === '16:9') return '16:9';
  if (aspect === '9:16') return '9:16';
  if (aspect === '4:3') return '4:3';
  if (aspect === '3:4') return '3:4';
  return '16:9';
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

/**
 * A magic-byte signature: every `[offset, bytes]` run must match. No separate
 * minimum-length check is needed: a read past the end of the buffer is
 * `undefined`, which never equals a magic byte, so a too-short buffer fails.
 */
interface ImageSignature {
  readonly ext: string;
  readonly runs: ReadonlyArray<readonly [offset: number, magic: readonly number[]]>;
}

// PNG (`89 50 4E 47`, min 8 bytes) has no entry: it is also the default, so
// matching it explicitly could never change the result.
const IMAGE_SIGNATURES: readonly ImageSignature[] = [
  { ext: '.jpg', runs: [[0, [0xff, 0xd8, 0xff]]] },
  {
    ext: '.webp',
    runs: [
      [0, [0x52, 0x49, 0x46, 0x46]], // RIFF
      [8, [0x57, 0x45, 0x42, 0x50]], // WEBP
    ],
  },
];

function matchesSignature(bytes: Buffer, signature: ImageSignature): boolean {
  return signature.runs.every(([offset, magic]) => magic.every((byte, i) => bytes[offset + i] === byte));
}

/** Sniffs an image byte buffer's format from its magic bytes (jpg/png/webp), defaulting to `.png`. */
export function sniffImageExt(bytes: Buffer): string {
  return IMAGE_SIGNATURES.find((signature) => matchesSignature(bytes, signature))?.ext ?? '.png';
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
  if (endpoint === 'videos') {
    // Videos have no edits endpoint, so `edits` mode still targets generations.
    return strippedPath.endsWith(generationsSuffix) ? strippedPath : `${strippedPath}${generationsSuffix}`;
  }
  const editsSuffix = '/images/edits';
  const knownSuffix = [generationsSuffix, editsSuffix].find((suffix) => strippedPath.endsWith(suffix));
  const prefix = knownSuffix ? strippedPath.slice(0, -knownSuffix.length) : strippedPath;
  return `${prefix}${mode === 'edits' ? editsSuffix : generationsSuffix}`;
}

/** Points `baseUrl`'s path at the given endpoint/mode, keeping any query string; an unparseable base URL is normalized as a bare path. */
function buildOpenAICompatibleUrl(baseUrl: string, endpoint: 'images' | 'videos', mode: 'generations' | 'edits'): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return normalizeOpenAICompatiblePath(baseUrl, endpoint, mode);
  }
  parsed.pathname = normalizeOpenAICompatiblePath(parsed.pathname, endpoint, mode);
  return parsed.toString();
}

/** Appends the default Azure `api-version` when the endpoint is Azure and the caller didn't supply one. */
function applyDefaultAzureApiVersion(parsed: URL, isAzure: boolean): void {
  if (isAzure && !parsed.searchParams.has('api-version')) {
    parsed.searchParams.set('api-version', AZURE_DEFAULT_API_VERSION);
  }
}

/** Builds the full `/{endpoint}/generations` URL, preserving any user-supplied query string. */
export function buildOpenAICompatibleGenerationUrl(baseUrl: string, endpoint: 'images' | 'videos'): string {
  return buildOpenAICompatibleUrl(baseUrl, endpoint, 'generations');
}

/** Builds the `/images/generations` URL, appending the default Azure `api-version` when the caller didn't supply one. */
export function buildOpenAIImageUrl(baseUrl: string, isAzure: boolean): string {
  const url = buildOpenAICompatibleGenerationUrl(baseUrl, 'images');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Bad URL — fall back to naive concat so the upstream error is
    // surfaced through the normal HTTP path rather than a parse crash.
    return url;
  }
  applyDefaultAzureApiVersion(parsed, isAzure);
  return parsed.toString();
}

/** Builds the `/images/edits` URL (used when a reference image is present). */
export function buildOpenAIImageEditUrl(baseUrl: string): string {
  return buildOpenAICompatibleUrl(baseUrl, 'images', 'edits');
}

/** Builds the `/videos/generations` URL. */
export function buildOpenAIVideoUrl(baseUrl: string): string {
  return buildOpenAICompatibleGenerationUrl(baseUrl, 'videos');
}

// gpt-image-1.5 / gpt-image-2 accept arbitrary sizes up to 4096; concrete
// sizes tuned to common aspects are picked so the API never negotiates
// them down silently.
const GPT_IMAGE_SIZES: ReadonlyMap<string, string> = new Map([
  ['16:9', '1792x1024'],
  ['9:16', '1024x1792'],
  ['4:3', '1408x1056'],
  ['3:4', '1056x1408'],
]);
const DALLE_3_SIZES: ReadonlyMap<string, string> = new Map([
  ['16:9', '1792x1024'],
  ['9:16', '1024x1792'],
]);
// dall-e-2 only supports 256/512/1024 squares.
const SQUARE_ONLY_SIZES: ReadonlyMap<string, string> = new Map();

function sizeTableFor(model: string): ReadonlyMap<string, string> {
  if (model.startsWith('gpt-image-')) return GPT_IMAGE_SIZES;
  if (model === 'dall-e-3') return DALLE_3_SIZES;
  return SQUARE_ONLY_SIZES;
}

/** Picks an image `size` string tuned to the model family + requested aspect ratio, defaulting to the `1024x1024` square. */
export function openaiSizeFor(model: string, aspect?: string): string {
  return sizeTableFor(model).get(aspect ?? '') ?? '1024x1024';
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
  applyDefaultAzureApiVersion(parsed, isAzure);
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

/** Extracts generated bytes from an OpenAI-compatible `{ data: [{ b64_json | url }] }` response.
 * Provider URLs remain untrusted: the outbound client vets DNS, pins peers and refuses redirects.
 * @throws Invalid provider data, policy/transport errors or unsuccessful asset status.
 * @complexity O(b) time and space for b generated bytes, bounded by outbound policy for downloads.
 */
export async function bytesFromOpenAICompatibleData(
  { data, providerTag }: { data: unknown; providerTag: string },
  { requestInit = {}, ...outbound }: MediaOutboundOptions & { requestInit?: MediaGenerationRequestInit } = {},
): Promise<Buffer> {
  const entry = firstDataEntry(data);
  if (!entry) throw new Error(`${providerTag} response had no data[0]`);
  const b64Json = stringOrUndefined(entry.b64_json);
  if (b64Json) {
    // A data-URL (`data:<mime>;base64,<payload>`) keeps only what follows its first comma;
    // with no comma `indexOf` is -1, so the whole string is decoded.
    return Buffer.from(b64Json.slice(b64Json.indexOf(',') + 1), 'base64');
  }
  const url = stringOrUndefined(entry.url);
  if (url) {
    // Downloading already-generated bytes from the vendor's CDN, not waiting on generation itself
    // — UPLOAD-class (2min), not GENERATE-class (10min): see FETCH_TIMEOUT_MS's own doc.
    const mediaResp = await assertAndFetchExternalAsset({ url }, { ...outbound, init: requestInit });
    if (!mediaResp.ok) {
      throw new Error(`${providerTag} media fetch ${mediaResp.status}`);
    }
    return Buffer.from(await mediaResp.arrayBuffer());
  }
  throw new Error(`${providerTag} response had neither b64_json nor url`);
}

/** `data.data[0]` of an OpenAI-compatible response, or `undefined` when the body has no such entry. */
function firstDataEntry(data: unknown): Record<string, unknown> | undefined {
  const record = data as { data?: unknown } | null;
  if (!record || !Array.isArray(record.data)) return undefined;
  return (record.data[0] as Record<string, unknown> | null | undefined) ?? undefined;
}

/** Narrows to a string; callers treat an empty string as absent through their own truthiness check. */
function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
