/**
 * Provider: Nano Banana (Google Gemini image generation) —
 * `POST /v1beta/models/{model}:generateContent`. Ported near-verbatim from
 * Open Design's `apps/daemon/src/media/index.ts` `renderNanoBananaImage`
 * (plus its `nanoBananaHeaders`/`usesOfficialGoogleApiKeyHeader`/
 * `nanoBananaAspectFor`/`inlineImageBytesFromGenerateContent` helpers) —
 * see `source-map.md`.
 *
 * Not OpenAI-images-wire-compatible — Gemini's `generateContent` request
 * shape (`contents[].parts[].text` + `generationConfig`) and response shape
 * (`candidates[].content.parts[].inlineData.data`) are unrelated to
 * `/images/generations`'s `{ data: [{ b64_json | url }] }` — so this does
 * not route through `openai-compatible.ts`'s OpenAI-images helpers; only
 * its genuinely vendor-agnostic utilities (`truncate`, `sniffImageExt`,
 * `withRequestInit`) are reused.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`). External behavior is
 * unchanged (verified against `nanobanana.test.ts`, which asserts URL/
 * body/header/error-message/providerNote shape and passes unmodified) —
 * only the internal implementation moved into a registered
 * `VendorAdapter`. Not routed through `response-parsers.ts`'s factories:
 * this Gemini `candidates[].content.parts[].inlineData.data` shape has no
 * other current consumer with byte-for-byte identical error messages (see
 * `aihubmix.ts`'s own Gemini-native branch, which throws differently-
 * tagged errors), so it correctly stays a bespoke `parseResponse`.
 */
import { sniffImageExt, truncate, withRequestInit } from '../openai-compatible.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';

const NANOBANANA_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const NANOBANANA_DEFAULT_MODEL = 'gemini-3.1-flash-image-preview';
const NANOBANANA_DEFAULT_IMAGE_SIZE = '1K';

/** Google's official Gemini API wants an `x-goog-api-key` header; any other host (a custom gateway/proxy) gets a standard `Authorization: Bearer` header instead. */
function usesOfficialGoogleApiKeyHeader(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

function nanoBananaHeaders(baseUrl: string, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (usesOfficialGoogleApiKeyHeader(baseUrl)) {
    headers['x-goog-api-key'] = apiKey;
    return headers;
  }
  headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

/**
 * `providers.ts`'s `MEDIA_ASPECTS` are all natively supported by Nano
 * Banana's `imageConfig.aspectRatio`; anything else defaults to `'1:1'`.
 * Written as independent `if` returns (rather than the origin's one
 * `||`-chained condition) to match this package's established
 * aspect-mapping style (see `imagerouter.ts`'s `imageRouterSizeFor`) — same
 * input -> output mapping for every case, not a behavior change.
 */
function nanoBananaAspectFor(aspect: string | undefined): string {
  if (aspect === '1:1') return '1:1';
  if (aspect === '16:9') return '16:9';
  if (aspect === '9:16') return '9:16';
  if (aspect === '4:3') return '4:3';
  if (aspect === '3:4') return '3:4';
  return '1:1';
}

function inlineImageBytesFromGenerateContent(data: unknown): Buffer {
  const candidates = (data as { candidates?: unknown } | null)?.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts = (candidate as { content?: { parts?: unknown } } | null)?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const inline = (part as { inlineData?: { data?: unknown } } | null)?.inlineData;
          if (typeof inline?.data === 'string' && inline.data) {
            return Buffer.from(inline.data, 'base64');
          }
        }
      }
    }
  }
  throw new Error('nano-banana image response missing candidates[].content.parts[].inlineData.data');
}

const NO_CREDENTIAL_MESSAGE = 'no Nano Banana credential — configure an API key or set GOOGLE_API_KEY / GEMINI_API_KEY.';

interface NanoBananaImageMeta {
  readonly wireModel: string;
  readonly aspectRatio: string;
}

const nanoBananaImageAdapter: VendorAdapter<NanoBananaImageMeta> = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<NanoBananaImageMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = (credentials.baseUrl || NANOBANANA_DEFAULT_BASE_URL).replace(/\/$/, '');
    const wireModel = (credentials.model || ctx.wireModel || NANOBANANA_DEFAULT_MODEL).trim();
    const aspectRatio = nanoBananaAspectFor(ctx.aspect);
    const body = {
      contents: [{ parts: [{ text: ctx.prompt || 'A high-quality reference image.' }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio,
          imageSize: NANOBANANA_DEFAULT_IMAGE_SIZE,
        },
      },
    };

    return {
      url: `${baseUrl}/v1beta/models/${encodeURIComponent(wireModel)}:generateContent`,
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: nanoBananaHeaders(baseUrl, apiKey),
        body: JSON.stringify(body),
      }),
      meta: { wireModel, aspectRatio },
    };
  },

  async parseResponse(resp: Response, _ctx: RenderContext, request: VendorRequest<NanoBananaImageMeta>): Promise<RenderResult> {
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`nano-banana image ${resp.status}: ${truncate(text, 240)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`nano-banana image non-JSON response: ${truncate(text, 200)}`);
    }
    const bytes = inlineImageBytesFromGenerateContent(data);
    return {
      bytes,
      providerNote: `nano-banana/${request.meta.wireModel} · ${request.meta.aspectRatio} · ${NANOBANANA_DEFAULT_IMAGE_SIZE} · ${bytes.length} bytes`,
      suggestedExt: sniffImageExt(bytes),
    };
  },
};

mediaVendorRegistry.register('nanobanana', 'image', nanoBananaImageAdapter);

export async function renderNanoBananaImage(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(nanoBananaImageAdapter, ctx, credentials);
}
