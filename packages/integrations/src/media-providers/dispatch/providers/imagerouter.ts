/**
 * Provider: ImageRouter — OpenAI-compatible image + video generation
 * routing (`https://api.imagerouter.io/v1/openai`). Ported near-verbatim
 * from Open Design's `apps/daemon/src/media/index.ts`
 * `renderImageRouterImage`/`renderImageRouterVideo` — see `archived provenance ledger`.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`) — two adapters registered on
 * the same `imagerouter` provider id, one per surface (`image`/`video`).
 * External behavior is unchanged (verified against `imagerouter.test.ts`,
 * which asserts URL/body/error-message/providerNote shape and passes
 * unmodified) — only the internal implementation moved. Neither adapter
 * routes through `response-parsers.ts`'s factories — this vendor's
 * `{ data: [...] }` JSON envelope isn't the "no envelope" raw-bytes shape
 * either factory covers; both keep reusing `openai-compatible.ts`'s
 * `parseOpenAICompatibleJson`/`bytesFromOpenAICompatibleData` helpers
 * directly, same as before this pass.
 */
import {
  buildOpenAIImageUrl,
  buildOpenAIVideoUrl,
  bytesFromOpenAICompatibleData,
  parseOpenAICompatibleJson,
  sniffImageExt,
  withRequestInit,
} from '../openai-compatible.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import type { VendorAdapterRegistry } from '../vendor-registry-core.js';

// Maps (not object literals) so an inherited key such as `constructor` can never resolve as an aspect.
const PORTRAIT_AND_4_3_SIZES: ReadonlyArray<readonly [string, string]> = [['9:16', '576x1024'], ['4:3', '1024x768'], ['3:4', '768x1024']];
const IMAGE_SIZES: ReadonlyMap<string, string> = new Map([['16:9', '1024x576'], ...PORTRAIT_AND_4_3_SIZES]);
const VIDEO_SIZES: ReadonlyMap<string, string> = new Map([['1:1', '1024x1024'], ...PORTRAIT_AND_4_3_SIZES]);

/** ImageRouter's image/video generation `size` string for a given aspect ratio. */
export function imageRouterSizeFor({ aspect, surface }: { aspect: string | undefined; surface: 'image' | 'video' }): string {
  const [sizes, fallback] = surface === 'video' ? [VIDEO_SIZES, '1024x576'] : [IMAGE_SIZES, '1024x1024'];
  return sizes.get(aspect ?? '') ?? fallback;
}

const DEFAULT_BASE_URL = 'https://api.imagerouter.io/v1/openai';
const NO_CREDENTIAL_MESSAGE = 'no ImageRouter API key — configure it or set IMAGEROUTER_API_KEY';

interface ImageRouterMeta {
  readonly wireModel: string;
  readonly size: string;
}

const imageRouterImageAdapter: VendorAdapter<ImageRouterMeta> = {
  requireCredential: requireApiKey({ message: NO_CREDENTIAL_MESSAGE }),

  buildRequest({ ctx, credentials }: { ctx: RenderContext; credentials: ProviderCredentials }): VendorRequest<ImageRouterMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = (credentials.baseUrl || DEFAULT_BASE_URL).trim();
    const wireModel = (credentials.model || ctx.wireModel).trim();
    const size = imageRouterSizeFor({ aspect: ctx.aspect, surface: 'image' });
    const body: Record<string, unknown> = {
      prompt: ctx.prompt || 'A high-quality reference image.',
      model: wireModel,
      quality: 'auto',
      size,
      response_format: 'b64_json',
      output_format: 'png',
    };

    return {
      url: buildOpenAIImageUrl(baseUrl, false),
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      meta: { wireModel, size },
    };
  },

  async parseResponse({ resp, ctx, request }: { resp: Response; ctx: RenderContext; request: VendorRequest<ImageRouterMeta> }): Promise<RenderResult> {
    const data = await parseOpenAICompatibleJson(resp, 'imagerouter image');
    const bytes = await bytesFromOpenAICompatibleData({ data, providerTag: 'imagerouter image' }, ctx);
    return {
      bytes,
      providerNote: `imagerouter/${request.meta.wireModel} · ${request.meta.size} · ${bytes.length} bytes`,
      suggestedExt: sniffImageExt(bytes),
    };
  },
};

export async function renderImageRouterImage({ ctx, credentials }: { ctx: RenderContext; credentials: ProviderCredentials }): Promise<RenderResult> {
  return dispatchVendorRequest({ adapter: imageRouterImageAdapter, ctx, credentials });
}

interface ImageRouterVideoMeta {
  readonly wireModel: string;
  readonly size: string;
  readonly seconds: number | 'auto';
}

const imageRouterVideoAdapter: VendorAdapter<ImageRouterVideoMeta> = {
  requireCredential: requireApiKey({ message: NO_CREDENTIAL_MESSAGE }),

  buildRequest({ ctx, credentials }: { ctx: RenderContext; credentials: ProviderCredentials }): VendorRequest<ImageRouterVideoMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = (credentials.baseUrl || DEFAULT_BASE_URL).trim();
    const wireModel = (credentials.model || ctx.wireModel).trim();
    const seconds = typeof ctx.length === 'number' ? ctx.length : 'auto';
    const size = imageRouterSizeFor({ aspect: ctx.aspect, surface: 'video' });
    const body: Record<string, unknown> = {
      prompt: ctx.prompt || 'A short cinematic clip.',
      model: wireModel,
      size,
      seconds,
      response_format: 'b64_json',
    };

    return {
      url: buildOpenAIVideoUrl(baseUrl),
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      meta: { wireModel, size, seconds },
    };
  },

  async parseResponse({ resp, ctx, request }: { resp: Response; ctx: RenderContext; request: VendorRequest<ImageRouterVideoMeta> }): Promise<RenderResult> {
    const data = await parseOpenAICompatibleJson(resp, 'imagerouter video');
    const bytes = await bytesFromOpenAICompatibleData({ data, providerTag: 'imagerouter video' }, ctx);
    const { wireModel, size, seconds } = request.meta;
    return {
      bytes,
      providerNote: `imagerouter/${wireModel} · ${size} · ${seconds === 'auto' ? 'auto' : `${seconds}s`} · ${bytes.length} bytes`,
      suggestedExt: '.mp4',
    };
  },
};

export async function renderImageRouterVideo({ ctx, credentials }: { ctx: RenderContext; credentials: ProviderCredentials }): Promise<RenderResult> {
  return dispatchVendorRequest({ adapter: imageRouterVideoAdapter, ctx, credentials });
}

/** Explicit composition: importing a renderer never changes another module's registry. */
export function registerVendorAdapters(
  { registry }: { registry: Pick<VendorAdapterRegistry, 'register'> },
  _optional: Record<string, never> = {},
): void {
  registry.register({ providerId: 'imagerouter', routeKey: 'image', adapter: imageRouterImageAdapter });
  registry.register({ providerId: 'imagerouter', routeKey: 'video', adapter: imageRouterVideoAdapter });
}
