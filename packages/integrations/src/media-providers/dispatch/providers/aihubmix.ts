/**
 * Provider: AIHubMix — an OpenAI-wire-compatible aggregator gateway.
 * `renderAIHubMixImage` (`POST /images/generations`, OpenAI shape) with an
 * internal redirect to a Gemini-native path for gemini/imagen-family
 * catalog ids, and `renderAIHubMixTTS` (`POST /audio/speech`, OpenAI
 * shape). Ported near-verbatim from Open Design's
 * `apps/daemon/src/media/index.ts` `renderAIHubMixImage`/
 * `renderAIHubMixGeminiImage`/`renderAIHubMixTTS` — see `source-map.md`.
 *
 * The non-Gemini image path and the TTS path route through
 * `openai-compatible.ts`'s shared helpers since AIHubMix's default wire
 * shape is genuinely OpenAI-compatible (the whole point of the
 * aggregator). The Gemini-family image path does not — see
 * `aihubmix-shared.ts`'s `aihubmixGeminiImageBytes` doc comment.
 *
 * `renderAIHubMixImage`'s `entry.url` fallback is downloaded through
 * `ssrf-guard.ts`'s `assertAndFetchExternalAsset`, matching the real
 * origin exactly and `senseaudio.ts`'s identical reasoning: the URL is
 * attacker-controllable inside an otherwise-successful response.
 *
 * Dropped from the origin's no-credential error messages (both exported
 * functions): the `OD_`-prefixed override env var
 * (`OD_AIHUBMIX_API_KEY`) — `providers.ts`'s
 * `PROVIDER_CREDENTIAL_ENV_VARS.aihubmix` already de-branded this to plain
 * `AIHUBMIX_API_KEY`.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`) — two adapters registered on
 * the same `aihubmix` provider id (`image`/`audio:speech`). External
 * behavior is unchanged (verified against `aihubmix.test.ts`, which
 * asserts URL/body/header/error-message/providerNote shape and passes
 * unmodified) — only the internal implementation moved.
 *
 * The image adapter's Gemini-vs-OpenAI branch is a genuine design decision
 * this port had to make, not a mechanical translation: the origin decides
 * which wire shape to use *before* any network call (a pure function of
 * `wireModel` via `classifyAIHubMixModel`), so `buildRequest` makes that
 * same decision up front and returns the ONE real request for whichever
 * endpoint is correct — never the OpenAI endpoint for a Gemini model (that
 * combination fails on AIHubMix's side, see `aihubmix-shared.ts`'s
 * `aihubmixGeminiImageBytes` doc comment) — tagging the choice in `meta` so
 * `parseResponse` decodes the one response that comes back. This is
 * deliberately NOT `aihubmix-shared.ts`'s `aihubmixGeminiImageBytes`
 * reused as a black box: that helper bundles its own `fetch` inside it,
 * which would mean either a second, wasted real network call (fetching the
 * OpenAI endpoint just to discard the response, then a real Gemini fetch)
 * or reimplementing its URL/header building a second time just to satisfy
 * an unused `doFetch` parameter — neither is a legitimate use of the
 * generic harness's "one fetch" contract. Instead this file's `parseResponse`
 * replicates `aihubmixGeminiImageBytes`'s response-decoding logic directly
 * against the harness's already-fetched `Response` (same error messages,
 * same candidate/part walk, verified line-for-line against that function) —
 * `aihubmixGeminiImageBytes` itself stays exported and independently
 * covered by `aihubmix-shared.test.ts`, just no longer called from here.
 */
import { buildOpenAIImageUrl, buildOpenAISpeechUrl, openaiSizeFor, OPENAI_TTS_VOICES, resolveSpeechFormat, truncate, withRequestInit } from '../openai-compatible.js';
import { createRawBytesParser } from '../response-parsers.js';
import { assertAndFetchExternalAsset } from '../ssrf-guard.js';
import type { MediaSpeechFormat, ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';
import { aihubmixAppCodeHeader, aihubmixGeminiImageUrl, aihubmixHeaders, AIHUBMIX_DEFAULT_BASE_URL, aihubmixWireModel, classifyAIHubMixModel } from './aihubmix-shared.js';

const NO_CREDENTIAL_MESSAGE = 'no AIHubMix credential — configure an API key or set AIHUBMIX_API_KEY.';

type AIHubMixImageMeta = { readonly kind: 'gemini'; readonly wireModel: string; readonly aspect: string } | { readonly kind: 'openai'; readonly wireModel: string };

const aihubmixImageAdapter: VendorAdapter<AIHubMixImageMeta> = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<AIHubMixImageMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = credentials.baseUrl || AIHUBMIX_DEFAULT_BASE_URL;
    const wireModel = aihubmixWireModel(credentials.model || ctx.wireModel);

    if (classifyAIHubMixModel(wireModel) === 'gemini') {
      const aspect = ctx.aspect || '1:1';
      return {
        url: aihubmixGeminiImageUrl(baseUrl, wireModel),
        init: withRequestInit(ctx, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey,
            ...aihubmixAppCodeHeader(),
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: ctx.prompt || 'A high-quality reference image.' }] }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: { aspectRatio: aspect },
            },
          }),
        }),
        meta: { kind: 'gemini', wireModel, aspect },
      };
    }

    const body: Record<string, unknown> = {
      model: wireModel,
      prompt: ctx.prompt || 'A high-quality reference image.',
      n: 1,
      size: openaiSizeFor(wireModel, ctx.aspect),
    };
    if (wireModel.startsWith('dall-e-')) {
      body.response_format = 'b64_json';
      body.quality = wireModel === 'dall-e-3' ? 'hd' : 'standard';
    } else {
      body.quality = 'high';
    }

    return {
      url: buildOpenAIImageUrl(baseUrl, false),
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...aihubmixHeaders(apiKey) },
        body: JSON.stringify(body),
      }),
      meta: { kind: 'openai', wireModel },
    };
  },

  async parseResponse(resp: Response, ctx: RenderContext, request: VendorRequest<AIHubMixImageMeta>): Promise<RenderResult> {
    if (request.meta.kind === 'gemini') {
      const { wireModel, aspect } = request.meta;
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`aihubmix image (gemini) ${resp.status}: ${text.slice(0, 240)}`);
      }
      const data = (await resp.json()) as {
        candidates?: ReadonlyArray<{ content?: { parts?: ReadonlyArray<{ inlineData?: { data?: unknown }; inline_data?: { data?: unknown } }> } }>;
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const b64 = parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find((d): d is string => typeof d === 'string' && d.length > 0);
      if (!b64) {
        throw new Error(`aihubmix gemini image response had no inline image data: ${JSON.stringify(data).slice(0, 200)}`);
      }
      const bytes = Buffer.from(b64, 'base64');
      return {
        bytes,
        providerNote: `aihubmix/${wireModel} · ${aspect} · ${bytes.length} bytes (gemini-native)`,
        suggestedExt: '.png',
      };
    }

    const { wireModel } = request.meta;
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`aihubmix ${resp.status}: ${truncate(text, 240)}`);
    }
    let data: { data?: unknown };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`aihubmix non-JSON response: ${truncate(text, 200)}`);
    }
    const entry = Array.isArray(data.data) ? (data.data[0] as { b64_json?: string; url?: string } | undefined) : undefined;
    if (!entry) throw new Error('aihubmix response had no data[0]');
    let bytes: Buffer;
    if (entry.b64_json) {
      bytes = Buffer.from(entry.b64_json, 'base64');
    } else if (entry.url) {
      const imgResp = await assertAndFetchExternalAsset(entry.url, withRequestInit(ctx));
      if (!imgResp.ok) throw new Error(`aihubmix image fetch ${imgResp.status}`);
      bytes = Buffer.from(await imgResp.arrayBuffer());
    } else {
      throw new Error('aihubmix response had neither b64_json nor url');
    }
    return {
      bytes,
      providerNote: `aihubmix/${wireModel} · ${ctx.aspect} · ${bytes.length} bytes`,
      suggestedExt: '.png',
    };
  },
};

mediaVendorRegistry.register('aihubmix', 'image', aihubmixImageAdapter);

export async function renderAIHubMixImage(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(aihubmixImageAdapter, ctx, credentials);
}

interface AIHubMixTTSMeta {
  readonly wireModel: string;
  readonly voice: string;
  readonly format: MediaSpeechFormat;
}

const aihubmixTTSAdapter: VendorAdapter<AIHubMixTTSMeta> = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<AIHubMixTTSMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = credentials.baseUrl || AIHUBMIX_DEFAULT_BASE_URL;
    const wireModel = aihubmixWireModel(credentials.model || ctx.wireModel);
    const format = resolveSpeechFormat(ctx.speechFormat);
    const text = (ctx.prompt && ctx.prompt.trim()) || 'This is a test.';
    const requestedVoice = (ctx.voice && ctx.voice.trim()) || '';
    const voice = requestedVoice && OPENAI_TTS_VOICES.has(requestedVoice) ? requestedVoice : 'alloy';

    return {
      url: buildOpenAISpeechUrl(baseUrl, false),
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...aihubmixHeaders(apiKey) },
        body: JSON.stringify({ model: wireModel, input: text, voice, response_format: format }),
      }),
      meta: { wireModel, voice, format },
    };
  },

  parseResponse: createRawBytesParser<AIHubMixTTSMeta>({
    errorTag: 'aihubmix speech',
    zeroBytesMessage: 'aihubmix speech returned zero bytes',
    note: (bytes, meta) => `aihubmix/${meta.wireModel} · ${meta.voice} · ${meta.format} · ${bytes.length} bytes`,
    suggestedExt: (_bytes, meta) => (meta.format === 'opus' ? '.ogg' : `.${meta.format}`),
  }),
};

mediaVendorRegistry.register('aihubmix', 'audio:speech', aihubmixTTSAdapter);

export async function renderAIHubMixTTS(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(aihubmixTTSAdapter, ctx, credentials);
}
