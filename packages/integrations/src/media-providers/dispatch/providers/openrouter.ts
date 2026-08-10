/**
 * Provider: OpenRouter — unified multi-vendor image generation via the
 * Chat Completions API (`POST /chat/completions` with
 * `modalities: ["image"]`), not the dedicated `/images/generations` shape
 * OpenRouter's own *video* generation uses. Ported near-verbatim from Open
 * Design's `apps/daemon/src/media/index.ts` `renderOpenRouterImage` — see
 * `source-map.md`.
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
import { sniffImageExt, truncate, withRequestInit } from '../openai-compatible.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';

// Chat-completions image generation can take a while for some routed
// models; matches the same 10-minute ceiling `openai.ts`'s image dispatcher
// uses for the same reason (see `OPENAI_IMAGE_HEADERS_TIMEOUT_MS`/
// `OPENAI_IMAGE_BODY_TIMEOUT_MS` there — this vendor has no separate
// headers/body distinction, so a single `AbortSignal.timeout` suffices).
const OPENROUTER_IMAGE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * OpenRouter normalizes aspect ratios across the providers it fronts;
 * `providers.ts`'s `MEDIA_ASPECTS` are all natively supported, default to
 * 16:9 for anything else. Written as independent `if` returns (rather than
 * the origin's one `||`-chained condition) to match this package's
 * established aspect-mapping style (see `imagerouter.ts`'s
 * `imageRouterSizeFor`) — same input -> output mapping for every case, not
 * a behavior change.
 */
export function openRouterAspectFor(aspect: string | undefined): string {
  if (aspect === '1:1') return '1:1';
  if (aspect === '16:9') return '16:9';
  if (aspect === '9:16') return '9:16';
  if (aspect === '4:3') return '4:3';
  if (aspect === '3:4') return '3:4';
  return '16:9';
}

const NO_CREDENTIAL_MESSAGE = 'no OpenRouter API key — configure it or set OPENROUTER_API_KEY';

interface OpenRouterImageMeta {
  readonly wireModel: string;
  readonly aspectRatio: string;
}

const openRouterImageAdapter: VendorAdapter<OpenRouterImageMeta> = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<OpenRouterImageMeta> {
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
    const aspectRatio = openRouterAspectFor(ctx.aspect);

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

  async parseResponse(resp: Response, ctx: RenderContext, request: VendorRequest<OpenRouterImageMeta>): Promise<RenderResult> {
    const { wireModel, aspectRatio } = request.meta;
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`openrouter image ${resp.status}: ${truncate(text, 240)}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`openrouter image non-JSON response: ${truncate(text, 200)}`);
    }

    const images = (data as { choices?: Array<{ message?: { images?: unknown } }> } | null)?.choices?.[0]?.message?.images;
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error(`openrouter image response contained no images for model ${wireModel}: ${truncate(text, 200)}`);
    }
    const dataUrl = (images[0] as { image_url?: { url?: unknown } } | null)?.image_url?.url;
    if (typeof dataUrl !== 'string' || !dataUrl) {
      throw new Error(`openrouter image response missing image_url.url: ${truncate(text, 200)}`);
    }

    // Strip a "data:image/...;base64," prefix and decode; fall back to
    // downloading a plain URL, or treating the string as raw base64.
    const b64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/s);
    let bytes: Buffer;
    if (b64Match) {
      bytes = Buffer.from(b64Match[1]!, 'base64');
    } else if (dataUrl.startsWith('http')) {
      const imgResp = await fetch(dataUrl, withRequestInit(ctx));
      if (!imgResp.ok) throw new Error(`openrouter image download ${imgResp.status}`);
      bytes = Buffer.from(await imgResp.arrayBuffer());
    } else {
      bytes = Buffer.from(dataUrl, 'base64');
    }

    return {
      bytes,
      providerNote: `openrouter/${wireModel} · ${aspectRatio} · ${bytes.length} bytes`,
      suggestedExt: sniffImageExt(bytes),
    };
  },
};

mediaVendorRegistry.register('openrouter', 'image', openRouterImageAdapter);

export async function renderOpenRouterImage(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(openRouterImageAdapter, ctx, credentials);
}
