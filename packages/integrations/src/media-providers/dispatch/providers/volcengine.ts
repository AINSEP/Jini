/**
 * Provider: Volcengine Ark (Doubao) — Seedream / Seededit image generation
 * via an OpenAI-images-compatible `/images/generations` endpoint. Ported
 * near-verbatim from Open Design's `apps/daemon/src/media/index.ts`
 * `renderVolcengineImage` — see `source-map.md`.
 *
 * The response shape (`{ data: [{ b64_json | url }] }`) matches OpenAI's
 * images API, so this routes through `openai-compatible.ts`'s already-
 * ported URL-building/JSON-parsing/byte-extraction helpers rather than
 * re-implementing them — same reasoning `grok.ts` already documents for
 * the identical shape match.
 *
 * Unlike `grok.ts`, the origin does not sniff the downloaded bytes' magic
 * number for `suggestedExt` here — Seedream/Seededit are documented to
 * always return PNG, so the origin hardcodes `.png` and this port
 * preserves that exactly rather than silently "upgrading" it to
 * `sniffImageExt`.
 *
 * Also unlike `senseaudio.ts`/`aihubmix.ts` (ported alongside this batch),
 * the origin's `entry.url` fallback download here is a plain `fetch`, not
 * routed through `ssrf-guard.ts`'s `assertAndFetchExternalAsset` — this
 * mirrors the real origin exactly (verified: `assertAndFetchExternalAsset`
 * is only called from `renderSenseAudioImage`/`renderAIHubMixImage`/
 * `renderAIHubMixVideo` in the actual source, never from
 * `renderVolcengineImage`), not a gap this port introduced. Flagged here
 * as a real asymmetry present in the origin itself, not silently smoothed
 * over — the same asymmetry already exists for `openai.ts`/`grok.ts`'s own
 * `entry.url` fallbacks, which are equally unguarded in the origin.
 *
 * A genuine origin quirk, preserved rather than "fixed": `openaiSizeFor`
 * only special-cases `gpt-image-*`/`dall-e-3` catalog ids; every Volcengine
 * catalog id (`doubao-seedream-*`/`doubao-seededit-*`) falls through to its
 * default branch, so the request `size` is always `1024x1024` regardless of
 * the requested aspect ratio. The origin's own inline comment flags this
 * ("lefarcen + codex P2 on PR #1309") as a known review note rather than a
 * silent bug, and calls `openaiSizeFor(ctx.model, ctx.aspect)` unchanged —
 * this port keeps that exact call and behavior.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`). External behavior is
 * unchanged (verified against `volcengine.test.ts`, which asserts
 * URL/body/error-message/providerNote shape and passes unmodified) — only
 * the internal implementation moved into a registered `VendorAdapter`. Not
 * routed through `response-parsers.ts`'s factories — reuses
 * `openai-compatible.ts`'s `parseOpenAICompatibleJson`/
 * `bytesFromOpenAICompatibleData` helpers directly, same as before this
 * pass (see `imagerouter.ts`'s module doc for the identical reasoning).
 */
import { buildOpenAIImageUrl, bytesFromOpenAICompatibleData, openaiSizeFor, parseOpenAICompatibleJson, withRequestInit } from '../openai-compatible.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';

const NO_CREDENTIAL_MESSAGE = 'no Volcengine Ark credential — configure an API key or set ARK_API_KEY.';

const volcengineImageAdapter: VendorAdapter = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = (credentials.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    const body: Record<string, unknown> = {
      model: ctx.wireModel,
      prompt: ctx.prompt || 'A high-quality reference image.',
      response_format: 'b64_json',
      // openaiSizeFor branches on the catalog id (gpt-image-* vs dall-e-*
      // accept different size enums), so it must see the pre-alias catalog
      // model, not the post-alias wire name — matching `openai.ts`'s own
      // `renderOpenAIImage` (which carries the same origin-code comment).
      size: openaiSizeFor(ctx.model, ctx.aspect),
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
      meta: undefined,
    };
  },

  async parseResponse(resp: Response, ctx: RenderContext): Promise<RenderResult> {
    const data = await parseOpenAICompatibleJson(resp, 'volcengine image');
    const bytes = await bytesFromOpenAICompatibleData(data, 'volcengine image', ctx.requestInit);
    return {
      bytes,
      providerNote: `volcengine/${ctx.wireModel} · ${ctx.aspect} · ${bytes.length} bytes`,
      suggestedExt: '.png',
    };
  },
};

mediaVendorRegistry.register('volcengine', 'image', volcengineImageAdapter);

export async function renderVolcengineImage(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(volcengineImageAdapter, ctx, credentials);
}
