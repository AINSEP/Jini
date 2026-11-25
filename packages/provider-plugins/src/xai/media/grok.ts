/**
 * Provider: xAI Grok — image generation via an OpenAI-images-compatible
 * `/images/generations` endpoint (`renderGrokImage`), plus text-to-speech
 * via a dedicated `/tts` endpoint (`renderXAITTS`). Ported near-verbatim
 * from Open Design's `apps/daemon/src/media/index.ts` `renderGrokImage`/
 * `renderXAITTS` — see `archived provenance ledger`.
 *
 * Image response shape (`{ data: [{ b64_json | url }] }`) is identical to
 * OpenAI's images API, so `renderGrokImage` routes through
 * `openai-compatible.ts`'s already-ported JSON-parsing/byte-extraction/
 * URL-building helpers rather than re-implementing them. `/tts` is xAI's
 * own dedicated endpoint (not the OpenAI `/audio/speech` shape) — it
 * returns raw audio bytes directly from a plain JSON POST, with no
 * per-request format negotiation the caller can control, so `renderXAITTS`
 * doesn't route through `openai-compatible.ts` at all (only the generic
 * `truncate`/`withRequestInit` helpers are shared).
 *
 * Dropped from the origin's no-credential error messages (both
 * functions): the OD-specific "sign in with your SuperGrok subscription
 * (in OD or via `hermes auth add xai-oauth`)" OAuth guidance — this
 * package has no OAuth chain or local-CLI-login concept; credentials are
 * always host-injected (see `types.ts`'s `ProviderCredentials`), matching
 * every other ported provider's error-message style (e.g. `openai.ts`'s
 * `OPENAI_IMAGE_NO_CREDENTIAL_MESSAGE`).
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`) — two adapters registered on
 * the same `grok` provider id (`image`/`audio:speech`). External behavior
 * is unchanged (verified against `grok.test.ts`, which asserts URL/body/
 * header/error-message/providerNote shape and passes unmodified) — only
 * the internal implementation moved. The image adapter is not routed
 * through `response-parsers.ts`'s factories (reuses
 * `openai-compatible.ts`'s JSON-parsing helpers directly, same as before —
 * see `imagerouter.ts`'s module doc for the identical reasoning); the TTS
 * adapter's response (raw bytes, no envelope) is the same shape
 * `fishaudio.ts`/`openai.ts`'s speech renderer return, so it now shares
 * `response-parsers.ts`'s `createRawBytesParser`.
 */
import type { XaiCredentials, XaiMediaKit, XaiRenderContext, XaiRenderResult, XaiVendorAdapter, XaiVendorRequest } from './kit.js';

const NO_CREDENTIAL_MESSAGE = 'no xAI credential — configure an API key or set XAI_API_KEY.';

interface GrokImageMeta {
  readonly wireModel: string;
  readonly aspectRatio: string;
}

/**
 * The Grok image adapter, built from the host-injected kit.
 * @returns A fresh adapter for the `image` route.
 * @complexity O(1) to build; O(b) per request for b bounded response bytes.
 */
export function createGrokImageAdapter<Ctx extends XaiRenderContext>({ kit }: { kit: XaiMediaKit<Ctx, unknown> }, _optional: Record<string, never> = {}): XaiVendorAdapter<GrokImageMeta, Ctx> {
  return {
    requireCredential: kit.requireApiKey({ message: NO_CREDENTIAL_MESSAGE }),

    buildRequest({ ctx, credentials }: { ctx: Ctx; credentials: XaiCredentials }): XaiVendorRequest<GrokImageMeta> {
      const apiKey = credentials.apiKey!; // requireCredential already validated this.
      const baseUrl = (credentials.baseUrl || 'https://api.x.ai/v1').replace(/\/$/, '');
      const aspectRatio = kit.standardImageAspectFor({ aspect: ctx.aspect });
      const body: Record<string, unknown> = {
        model: ctx.wireModel,
        prompt: ctx.prompt || 'A high-quality reference image.',
        n: 1,
        aspect_ratio: aspectRatio,
        response_format: 'b64_json',
      };

      return {
        url: kit.buildOpenAIImageUrl({ baseUrl, isAzure: false }),
        init: kit.jsonPostInit({ ctx, body }, { apiKey }),
        meta: { wireModel: ctx.wireModel, aspectRatio },
      };
    },

    async parseResponse({ resp, ctx, request }: { resp: Response; ctx: Ctx; request: XaiVendorRequest<GrokImageMeta> }): Promise<XaiRenderResult> {
      const data = await kit.parseOpenAICompatibleJson({ resp, providerTag: 'grok image' });
      const bytes = await kit.bytesFromOpenAICompatibleData({ data, providerTag: 'grok image' }, ctx);
      return {
        bytes,
        providerNote: `grok/${request.meta.wireModel} · ${request.meta.aspectRatio} · ${bytes.length} bytes`,
        suggestedExt: kit.sniffImageExt(bytes),
      };
    },
  };
}

const XAI_TTS_DEFAULT_VOICE_ID = 'eve';
const XAI_TTS_DEFAULT_LANGUAGE = 'en';

interface XAITTSMeta {
  readonly wireModel: string;
  readonly voiceId: string;
  readonly language: string;
}

/**
 * xAI's `/tts` endpoint takes only `{ text, voice_id, language }` — no
 * per-request output-format field — and always returns mp3/24kHz/128kbps
 * audio bytes directly (not wrapped in JSON), matching the origin exactly.
 * `ctx.speechFormat` (used by `openai.ts`'s `renderOpenAISpeech`/AIHubMix's
 * TTS) has no equivalent here since the wire protocol offers nothing to
 * set it with.
 * @returns A fresh adapter for the `audio:speech` route.
 * @complexity O(1) to build; O(b) per request for b bounded response bytes.
 */
export function createXaiTTSAdapter<Ctx extends XaiRenderContext>({ kit }: { kit: XaiMediaKit<Ctx, unknown> }, _optional: Record<string, never> = {}): XaiVendorAdapter<XAITTSMeta, Ctx> {
  return {
    requireCredential: kit.requireApiKey({ message: NO_CREDENTIAL_MESSAGE }),

    buildRequest({ ctx, credentials }: { ctx: Ctx; credentials: XaiCredentials }): XaiVendorRequest<XAITTSMeta> {
      const apiKey = credentials.apiKey!; // requireCredential already validated this.
      const baseUrl = (credentials.baseUrl || 'https://api.x.ai/v1').replace(/\/$/, '');
      const text = (ctx.prompt && ctx.prompt.trim()) || 'This is a test.';
      const voiceId = (ctx.voice && ctx.voice.trim()) || XAI_TTS_DEFAULT_VOICE_ID;
      const language = ctx.language.trim() || XAI_TTS_DEFAULT_LANGUAGE;
      const body = { text, voice_id: voiceId, language };

      return {
        url: `${baseUrl}/tts`,
        init: kit.jsonPostInit({ ctx, body }, { apiKey }),
        meta: { wireModel: ctx.wireModel, voiceId, language },
      };
    },

    parseResponse: kit.createRawBytesParser<XAITTSMeta>({
      errorTag: 'xai tts',
      zeroBytesMessage: 'xai tts response had zero bytes',
      note: ({ bytes, meta }) => `xai/${meta.wireModel} · voice=${meta.voiceId} · ${meta.language} · ${bytes.length} bytes`,
      suggestedExt: '.mp3',
    }),
  };
}
