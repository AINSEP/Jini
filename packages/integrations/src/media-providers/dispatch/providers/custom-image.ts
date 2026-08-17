/**
 * Provider: `custom-image` — a user-supplied OpenAI-compatible
 * `/v1/images/generations` + `/v1/images/edits` endpoint. Ported
 * near-verbatim from Open Design's `apps/daemon/src/media/index.ts`
 * `renderCustomOpenAIImage`/`customImageOverridesOpenAIModel` — see
 * `source-map.md`.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`). External behavior is
 * unchanged (verified against `custom-image.test.ts`, which asserts
 * URL/body/header/error-message/providerNote shape and passes unmodified)
 * — only the internal implementation moved into a registered
 * `VendorAdapter`. Unlike every other migrated vendor, `apiKey` is
 * OPTIONAL here (a self-hosted gateway may need no auth at all), so this
 * adapter has no `requireCredential` guard — its two required-field checks
 * (`baseUrl`, resolved `wireModel`) instead live at the top of
 * `buildRequest`, which throws synchronously before any request is built —
 * the same "abort before the fetch" effect a `requireCredential` guard
 * gets, just expressed as a plain throw since the check needs `ctx` (to
 * resolve `wireModel`), which `requireCredential`'s signature doesn't
 * receive.
 *
 * Not routed through `response-parsers.ts`'s factories — this vendor's
 * `{ data: [...] }` JSON envelope isn't the "no envelope" raw-bytes shape
 * either factory covers; it reuses `openai-compatible.ts`'s
 * `parseOpenAICompatibleJson`/`bytesFromOpenAICompatibleData` helpers
 * directly instead, same as it did before this pass.
 */
import { buildOpenAIImageEditUrl, buildOpenAIImageUrl, bytesFromOpenAICompatibleData, openaiSizeFor, parseOpenAICompatibleJson, sniffImageExt, withRequestInit } from '../openai-compatible.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';

export const CUSTOM_IMAGE_MODEL_ID = 'custom-image';

interface CustomImageMeta {
  readonly wireModel: string;
  readonly size: string;
}

const customImageAdapter: VendorAdapter<CustomImageMeta> = {
  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<CustomImageMeta> {
    const baseUrl = (credentials.baseUrl || '').trim();
    if (!baseUrl) {
      throw new Error('Custom Image API base URL required — configure an OpenAI-compatible /v1/images/generations or /v1/images/edits endpoint');
    }
    const wireModel = (credentials.model || (ctx.wireModel !== CUSTOM_IMAGE_MODEL_ID ? ctx.wireModel : '')).trim();
    if (!wireModel) {
      throw new Error('Custom Image API model required — configure the provider model');
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (credentials.apiKey) {
      headers.authorization = `Bearer ${credentials.apiKey}`;
    }
    const size = openaiSizeFor('gpt-image-1', ctx.aspect);
    const body: Record<string, unknown> = {
      prompt: ctx.prompt || 'A high-quality reference image.',
      model: wireModel,
      n: 1,
      size,
    };
    let url = buildOpenAIImageUrl(baseUrl, false);
    if (ctx.imageRef?.dataUrl) {
      body.response_format = 'b64_json';
      body.images = [{ image_url: ctx.imageRef.dataUrl }];
      url = buildOpenAIImageEditUrl(baseUrl);
    }

    return {
      url,
      init: withRequestInit(ctx, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
      meta: { wireModel, size },
    };
  },

  async parseResponse(resp: Response, ctx: RenderContext, request: VendorRequest<CustomImageMeta>): Promise<RenderResult> {
    const data = await parseOpenAICompatibleJson(resp, 'custom image');
    const bytes = await bytesFromOpenAICompatibleData(data, 'custom image', ctx.requestInit);
    return {
      bytes,
      providerNote: `custom-image/${request.meta.wireModel} · ${request.meta.size} · ${bytes.length} bytes`,
      suggestedExt: sniffImageExt(bytes),
    };
  },
};

mediaVendorRegistry.register('custom-image', 'image', customImageAdapter);

export async function renderCustomOpenAIImage(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(customImageAdapter, ctx, credentials);
}

/** Whether the caller's `custom-image` credentials should override an `openai`-provider request (same model configured on both). */
export function customImageOverridesOpenAIModel(ctx: RenderContext, credentials: ProviderCredentials | null): credentials is ProviderCredentials {
  const baseUrl = credentials?.baseUrl?.trim();
  const model = credentials?.model?.trim();
  if (!baseUrl || !model) return false;
  return model === ctx.model || model === ctx.wireModel;
}
