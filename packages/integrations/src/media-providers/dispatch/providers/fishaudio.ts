/**
 * Provider: FishAudio — Speech-1.x family text-to-speech (synchronous,
 * `POST /v1/tts`). Ported near-verbatim from Open Design's
 * `apps/daemon/src/media/index.ts` `renderFishAudioTTS` — see
 * `source-map.md`.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`). External behavior (URL,
 * body, headers, every error message, `providerNote` format) is unchanged
 * — only the internal implementation moved into a registered
 * `VendorAdapter`. Its response is raw bytes with no envelope, the same
 * shape `openai.ts`'s `renderOpenAISpeech` returns, so both now share
 * `response-parsers.ts`'s `createRawBytesParser`.
 *
 * Returns raw audio bytes directly (not wrapped in JSON, unlike
 * MiniMax/SenseAudio's hex-in-JSON shape, and not the OpenAI
 * `/audio/speech` shape either), so this reuses only the generic
 * `withRequestInit` helper from `openai-compatible.ts`.
 *
 * Dropped from the origin's no-credential error message: the `OD_`-
 * prefixed override env var (`OD_FISHAUDIO_API_KEY`) — `providers.ts`'s
 * `PROVIDER_CREDENTIAL_ENV_VARS.fishaudio` already de-branded this to
 * plain `FISH_AUDIO_API_KEY`.
 */
import { withRequestInit } from '../openai-compatible.js';
import { createRawBytesParser } from '../response-parsers.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';

const FISHAUDIO_DEFAULT_BASE_URL = 'https://api.fish.audio';

const FISHAUDIO_TTS_MODEL_MAP: Record<string, string> = {
  'fish-speech-2': 'speech-1.6',
};

const NO_CREDENTIAL_MESSAGE = 'no FishAudio credential — configure an API key or set FISH_AUDIO_API_KEY.';

interface FishAudioTTSMeta {
  readonly wireModel: string;
}

const fishAudioTTSAdapter: VendorAdapter<FishAudioTTSMeta> = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<FishAudioTTSMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = (credentials.baseUrl || FISHAUDIO_DEFAULT_BASE_URL).replace(/\/$/, '');
    // Same precedence as minimax.ts's renderMinimaxTTS: an explicit caller
    // alias (ctx.wireModel set to something other than the catalog id) wins
    // over the project's hardcoded FishAudio rename map, which in turn wins
    // over passing the catalog id through unchanged.
    const wireModel = ctx.wireModel !== ctx.model ? ctx.wireModel : FISHAUDIO_TTS_MODEL_MAP[ctx.model] || ctx.model;
    const text = (ctx.prompt && ctx.prompt.trim()) || 'This is a test.';

    const body: Record<string, unknown> = {
      text,
      format: 'mp3',
      mp3_bitrate: 128,
      model: wireModel,
      normalize: true,
      latency: 'normal',
    };
    // FishAudio's `reference_id` slot pins which voice the synth uses;
    // empty/absent means FishAudio falls back to its own default voice for
    // the chosen model.
    if (ctx.voice && ctx.voice.trim()) {
      body.reference_id = ctx.voice.trim();
    }

    return {
      url: `${baseUrl}/v1/tts`,
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      meta: { wireModel },
    };
  },

  parseResponse: createRawBytesParser<FishAudioTTSMeta>({
    errorTag: 'fishaudio tts',
    zeroBytesMessage: 'fishaudio tts returned zero bytes',
    note: (bytes, meta) => `fishaudio/${meta.wireModel} · ${bytes.length} bytes`,
    suggestedExt: '.mp3',
  }),
};

mediaVendorRegistry.register('fishaudio', 'audio:speech', fishAudioTTSAdapter);

export async function renderFishAudioTTS(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(fishAudioTTSAdapter, ctx, credentials);
}
