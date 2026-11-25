/**
 * xAI Grok Imagine as a media provider contribution: image generation through an
 * OpenAI-images-compatible `/images/generations` endpoint, plus text-to-speech through the vendor's own
 * `/tts` endpoint. Moved out of the host's built-in dispatch set; the request/response wire helpers are
 * the host's, handed in as {@link MediaWirePort}.
 *
 * Image responses (`{ data: [{ b64_json | url }] }`) match the OpenAI images shape, so the image adapter
 * reuses the host's JSON parsing and byte extraction. `/tts` returns raw audio bytes from a plain JSON
 * POST with no per-request format negotiation, so it uses the raw-bytes parser. No OAuth or
 * local-CLI-login concept lives here: credentials are always host-injected.
 */
import type {
  MediaProviderContribution, MediaProviderCredentials, MediaRenderContext, MediaVendorAdapter, MediaVendorRequest, MediaWirePort,
} from '@jini-ai/core/contracts/site/media-provider-contribution';

const PROVIDER_ID = 'xai-grok-imagine';
const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const NO_CREDENTIAL_MESSAGE = 'no xAI credential — configure an API key or set XAI_API_KEY.';
const TTS_DEFAULT_VOICE_ID = 'eve';
const TTS_DEFAULT_LANGUAGE = 'en';

interface ImageMeta {
  readonly wireModel: string;
  readonly aspectRatio: string;
}

interface TtsMeta {
  readonly wireModel: string;
  readonly voiceId: string;
  readonly language: string;
}

const baseUrlOf = (credentials: MediaProviderCredentials): string => (credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');

function createImageAdapter({ mediaWire }: { mediaWire: MediaWirePort }, _optional: Record<string, never> = {}): MediaVendorAdapter<ImageMeta> {
  return {
    requireCredential: mediaWire.requireApiKey({ message: NO_CREDENTIAL_MESSAGE }),
    buildRequest({ ctx, credentials }: { ctx: MediaRenderContext; credentials: MediaProviderCredentials }): MediaVendorRequest<ImageMeta> {
      const apiKey = credentials.apiKey!; // requireCredential already validated this.
      const aspectRatio = mediaWire.imageAspectFor({ aspect: ctx.aspect });
      const body = {
        model: ctx.wireModel, prompt: ctx.prompt || 'A high-quality reference image.', n: 1, aspect_ratio: aspectRatio, response_format: 'b64_json',
      };
      return {
        url: mediaWire.imageGenerationUrl({ baseUrl: baseUrlOf(credentials) }),
        init: mediaWire.jsonPostInit({ ctx, body }, { apiKey }),
        meta: { wireModel: ctx.wireModel, aspectRatio },
      };
    },
    async parseResponse({ resp, ctx, request }) {
      const data = await mediaWire.parseJson({ resp, providerTag: 'grok image' });
      const bytes = await mediaWire.imageBytesFromData({ data, providerTag: 'grok image', ctx });
      return {
        bytes,
        providerNote: `grok/${request.meta.wireModel} · ${request.meta.aspectRatio} · ${bytes.length} bytes`,
        suggestedExt: mediaWire.sniffImageExt({ bytes }),
      };
    },
  };
}

/**
 * The `/tts` endpoint takes only `{ text, voice_id, language }` — no per-request output-format field —
 * and always returns mp3 audio bytes directly (not wrapped in JSON), so `speechFormat` has no equivalent.
 */
function createSpeechAdapter({ mediaWire }: { mediaWire: MediaWirePort }, _optional: Record<string, never> = {}): MediaVendorAdapter<TtsMeta> {
  return {
    requireCredential: mediaWire.requireApiKey({ message: NO_CREDENTIAL_MESSAGE }),
    buildRequest({ ctx, credentials }: { ctx: MediaRenderContext; credentials: MediaProviderCredentials }): MediaVendorRequest<TtsMeta> {
      const apiKey = credentials.apiKey!; // requireCredential already validated this.
      const text = (ctx.prompt && ctx.prompt.trim()) || 'This is a test.';
      const voiceId = (ctx.voice && ctx.voice.trim()) || TTS_DEFAULT_VOICE_ID;
      const language = ctx.language.trim() || TTS_DEFAULT_LANGUAGE;
      return {
        url: `${baseUrlOf(credentials)}/tts`,
        init: mediaWire.jsonPostInit({ ctx, body: { text, voice_id: voiceId, language } }, { apiKey }),
        meta: { wireModel: ctx.wireModel, voiceId, language },
      };
    },
    parseResponse: mediaWire.createRawBytesParser<TtsMeta>({
      errorTag: 'xai tts',
      zeroBytesMessage: 'xai tts response had zero bytes',
      note: ({ bytes, meta }) => `xai/${meta.wireModel} · voice=${meta.voiceId} · ${meta.language} · ${bytes.length} bytes`,
      suggestedExt: '.mp3',
    }),
  };
}

/**
 * Builds the xAI media contribution: one provider row, its three catalogued models and the image and
 * speech adapters. The video model is a catalogue declaration only; no standalone video adapter exists.
 * @param required.mediaWire - The host's generic wire helpers.
 * @returns A fresh contribution; allocates no connection and reads no environment.
 * @complexity O(1) time and space; no I/O.
 */
// Why: extracting vendor media does not merge credential lanes, change endpoint ownership, or widen transport permissions.
export function createXaiMediaContribution({ mediaWire }: { mediaWire: MediaWirePort }, _optional: Record<string, never> = {}): MediaProviderContribution {
  const model = (id: string, hint: string, caps: readonly string[]) => ({ id, label: id, hint, provider: PROVIDER_ID, caps });
  return {
    provider: { id: PROVIDER_ID, label: 'xAI Grok Imagine', hint: 'grok-imagine — image + video with native audio', integrated: true, defaultBaseUrl: DEFAULT_BASE_URL },
    models: [
      { ...model('grok-imagine-image', 'xAI · 2K text-to-image', ['t2i']), surface: 'image' },
      { ...model('grok-imagine-video', 'xAI · 720p t2v + i2v + native audio', ['t2v', 'i2v', 'audio']), surface: 'video' },
      { ...model('grok-tts', 'xAI · multilingual · uses Grok subscription', ['tts']), surface: 'audio', audioKind: 'speech' },
    ] as MediaProviderContribution['models'],
    adapters: {
      image: createImageAdapter({ mediaWire }) as MediaVendorAdapter<never>,
      'audio:speech': createSpeechAdapter({ mediaWire }) as MediaVendorAdapter<never>,
    },
  };
}
