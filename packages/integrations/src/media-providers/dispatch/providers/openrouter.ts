/**
 * Provider: OpenRouter — unified multi-vendor image generation via the
 * Chat Completions API (`POST /chat/completions` with
 * `modalities: ["image"]`), not the dedicated `/images/generations` shape
 * OpenRouter's own *video* generation uses. Ported near-verbatim from Open
 * Design's `apps/daemon/src/media/index.ts` `renderOpenRouterImage` — see
 * `archived provenance ledger`.
 *
 * Not OpenAI-images-wire-compatible (chat-completions request shape;
 * `choices[0].message.images[].image_url.url` response shape), so this
 * does not route through `openai-compatible.ts`'s OpenAI-images helpers —
 * only its vendor-agnostic utilities (`truncate`, `sniffImageExt`,
 * `withRequestInit`) are reused.
 *
 * Dropped from the origin: the `HTTP-Referer: https://opendesign.dev` /
 * `X-Title: Open Design` request headers — these are OpenRouter's optional
 * app-attribution headers (used for their model leaderboard, not required
 * for the request to succeed) and both values are OD product identity, out
 * of scope per AGENTS.md's no-product-identity-strings boundary. This
 * package has no host-identity concept to substitute one with; a host that
 * wants attribution would need its own request-building layer.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`). External behavior is
 * unchanged (verified against `openrouter.test.ts`, which asserts URL/
 * body/header/error-message/providerNote shape and passes unmodified) —
 * only the internal implementation moved into a registered
 * `VendorAdapter`. Not routed through `response-parsers.ts`'s factories —
 * the three-way image-decode (`data:` URI / http(s) download / bare
 * base64) has no other current consumer, so it correctly stays a bespoke
 * `parseResponse`.
 */
import { assertAndFetchExternalAsset } from '../ssrf-guard.js';
import { sniffImageExt, standardImageAspectFor as openRouterAspectFor, truncate, withRequestInit } from '../openai-compatible.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import type { VendorAdapterRegistry } from '../vendor-registry-core.js';

// Chat-completions image generation can take a while for some routed
// models; matches the same 10-minute ceiling `openai.ts`'s image dispatcher
// uses for the same reason (see `OPENAI_IMAGE_TIMEOUT_MS` there — a single
// `AbortSignal.timeout` covers the whole request for both vendors).
const OPENROUTER_IMAGE_TIMEOUT_MS = 10 * 60 * 1000;

export { openRouterAspectFor };

const NO_CREDENTIAL_MESSAGE = 'no OpenRouter API key — configure it or set OPENROUTER_API_KEY';

interface OpenRouterImageMeta {
  readonly wireModel: string;
  readonly aspectRatio: string;
}

const openRouterImageAdapter: VendorAdapter<OpenRouterImageMeta> = {
  requireCredential: requireApiKey({ message: NO_CREDENTIAL_MESSAGE }),

  buildRequest({ ctx, credentials }: { ctx: RenderContext; credentials: ProviderCredentials }): VendorRequest<OpenRouterImageMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = (credentials.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');

    // credentials.model (a host's own model-aliasing layer) wins over
    // ctx.wireModel; strip the catalogue's `openrouter/` prefix so the wire
    // model name matches OpenRouter's canonical slug.
    const resolved = (credentials.model || ctx.wireModel).trim();
    const wireModel = resolved.startsWith('openrouter/') ? resolved.slice('openrouter/'.length) : resolved;

    // Multi-modal models (Gemini variants) accept both image and text
    // output; image-only models (Flux, Recraft, Sourceful) only accept
    // ["image"]. A simple heuristic on the slug, matching the origin.
    const modalities: readonly string[] = wireModel.includes('gemini') ? ['image', 'text'] : ['image'];
    const aspectRatio = openRouterAspectFor({ aspect: ctx.aspect });

    const body: Record<string, unknown> = {
      model: wireModel,
      messages: [{ role: 'user', content: ctx.prompt || 'A high-quality reference image.' }],
      modalities,
      stream: false,
      image_config: { aspect_ratio: aspectRatio, image_size: '1K' },
    };

    return {
      url: `${baseUrl}/chat/completions`,
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OPENROUTER_IMAGE_TIMEOUT_MS),
      }),
      meta: { wireModel, aspectRatio },
    };
  },

  async parseResponse({ resp, ctx, request }: { resp: Response; ctx: RenderContext; request: VendorRequest<OpenRouterImageMeta> }): Promise<RenderResult> {
    const { wireModel, aspectRatio } = request.meta;
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`openrouter image ${resp.status}: ${truncate(text, 240)}`);
    }
    const imageUrl = extractOpenRouterImageUrl({ text, wireModel });
    const bytes = await decodeOpenRouterImage({ imageUrl, ctx });

    return {
      bytes,
      providerNote: `openrouter/${wireModel} · ${aspectRatio} · ${bytes.length} bytes`,
      suggestedExt: sniffImageExt(bytes),
    };
  },
};

/**
 * Parses an OK chat-completions body and returns
 * `choices[0].message.images[0].image_url.url`.
 * @throws Error — non-JSON body, no images, or a missing/empty/non-string url;
 *   each message quotes the truncated body (never request headers/credentials).
 */
function extractOpenRouterImageUrl({ text, wireModel }: { text: string; wireModel: string }): string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`openrouter image non-JSON response: ${truncate(text, 200)}`);
  }

  const images = firstChoiceImages({ data });
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error(`openrouter image response contained no images for model ${wireModel}: ${truncate(text, 200)}`);
  }
  const imageUrl = (images[0] as { image_url?: { url?: unknown } } | null)?.image_url?.url;
  if (typeof imageUrl !== 'string' || !imageUrl) {
    throw new Error(`openrouter image response missing image_url.url: ${truncate(text, 200)}`);
  }
  return imageUrl;
}

/** `choices[0].message.images` of a parsed body, or `undefined` when any level is absent (a JSON `null` body included). */
function firstChoiceImages({ data }: { data: unknown }): unknown {
  return (data as { choices?: Array<{ message?: { images?: unknown } }> } | null)?.choices?.[0]?.message?.images;
}

/**
 * Turns the returned image reference into bytes.
 * @throws Error — the SSRF guard refuses the download URL, or the download is not OK.
 */
async function decodeOpenRouterImage({ imageUrl, ctx }: { imageUrl: string; ctx: RenderContext }): Promise<Buffer> {
  // Strip a "data:image/...;base64," prefix and decode; fall back to
  // downloading a plain URL, or treating the string as raw base64.
  const b64Match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/s);
  if (b64Match) return Buffer.from(b64Match[1]!, 'base64');
  if (!imageUrl.startsWith('http')) return Buffer.from(imageUrl, 'base64');
  // Downloading already-generated bytes, not waiting on generation — UPLOAD-class (2min), not
  // the 10-minute GENERATE-class timeout the chat-completions call itself uses above.
  const imgResp = await assertAndFetchExternalAsset({ url: imageUrl }, { ...ctx, init: withRequestInit(ctx) });
  if (!imgResp.ok) throw new Error(`openrouter image download ${imgResp.status}`);
  return Buffer.from(await imgResp.arrayBuffer());
}

export async function renderOpenRouterImage({ ctx, credentials }: { ctx: RenderContext; credentials: ProviderCredentials }): Promise<RenderResult> {
  return dispatchVendorRequest({ adapter: openRouterImageAdapter, ctx, credentials });
}

/** Explicit composition: importing a renderer never changes another module's registry. */
export function registerVendorAdapters(
  { registry }: { registry: Pick<VendorAdapterRegistry, 'register'> },
  _optional: Record<string, never> = {},
): void {
  registry.register({ providerId: 'openrouter', routeKey: 'image', adapter: openRouterImageAdapter });
}
