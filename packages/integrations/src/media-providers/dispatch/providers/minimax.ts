/**
 * Provider: MiniMax — Speech-02 family text-to-speech (synchronous,
 * `POST /t2a_v2`). Ported near-verbatim from Open Design's
 * `apps/daemon/src/media/index.ts` `renderMinimaxTTS` — see
 * `source-map.md`.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`) — `renderMinimaxTTS`'s
 * external behavior (URL, body, headers, every error message,
 * `providerNote` format) is unchanged; only the internal implementation
 * moved from one hand-written async function into a registered
 * `VendorAdapter` dispatched via `dispatchVendorRequest`. Its response
 * envelope (hex-encoded audio inside a `base_resp`-wrapped JSON body) is
 * identical to `senseaudio.ts`'s TTS renderer, so both now share
 * `response-parsers.ts`'s `createHexEnvelopeAudioParser` — the first real,
 * observable de-duplication this engine buys, not just a mechanical
 * reshuffle.
 *
 * Not OpenAI-wire-compatible — MiniMax's request body
 * (`voice_setting`/`audio_setting`) and response shape share nothing with
 * `/audio/speech`, so this does not route through `openai-compatible.ts`'s
 * JSON-parsing helpers — only the genuinely vendor-agnostic
 * `withRequestInit` is reused (matching `nanobanana.ts`'s/`openrouter.ts`'s
 * reasoning for the same call).
 *
 * `renderMinimaxImage` (a *different* surface on the same provider slot,
 * gated behind its own `OD_MINIMAX_IMAGE_BASE_URL` env var read directly
 * from `process.env` in the origin) is intentionally not ported — this
 * package never reads `process.env` itself (see `providers.ts`'s standing
 * invariant) and the task for this pass only covers MiniMax TTS.
 *
 * Dropped from the origin's no-credential error message: the `OD_`-
 * prefixed override env var (`OD_MINIMAX_API_KEY`) — `providers.ts`'s
 * `PROVIDER_CREDENTIAL_ENV_VARS.minimax` already de-branded this to plain
 * `MINIMAX_API_KEY`.
 */
import { withRequestInit } from '../openai-compatible.js';
import type { HexEnvelopeAudioMeta } from '../response-parsers.js';
import { createHexEnvelopeAudioParser } from '../response-parsers.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';

const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.chat/v1';
const MINIMAX_DEFAULT_VOICE_ID = 'male-qn-qingse';

const MINIMAX_TTS_MODEL_MAP: Record<string, string> = {
  'minimax-tts': 'speech-02-turbo',
};

const NO_CREDENTIAL_MESSAGE = 'no MiniMax credential — configure an API key or set MINIMAX_API_KEY.';

const minimaxTTSAdapter: VendorAdapter<HexEnvelopeAudioMeta> = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<HexEnvelopeAudioMeta> {
    // Safe: `requireCredential` above already validated this is set before
    // `dispatchVendorRequest` ever calls `buildRequest`.
    const apiKey = credentials.apiKey!;
    const baseUrl = (credentials.baseUrl || MINIMAX_DEFAULT_BASE_URL).replace(/\/$/, '');
    // Precedence: an explicit caller alias (ctx.wireModel set to something
    // other than the catalog id) wins over the legacy MiniMax rename map,
    // which in turn wins over passing the catalog id through unchanged.
    const wireModel = ctx.wireModel !== ctx.model ? ctx.wireModel : MINIMAX_TTS_MODEL_MAP[ctx.model] || ctx.model;
    const text = (ctx.prompt && ctx.prompt.trim()) || 'This is a test.';
    const voiceId = (ctx.voice && ctx.voice.trim()) || MINIMAX_DEFAULT_VOICE_ID;
    const languageBoost = ctx.language.trim();

    const body: Record<string, unknown> = {
      model: wireModel,
      text,
      stream: false,
      ...(languageBoost ? { language_boost: languageBoost } : {}),
      voice_setting: {
        voice_id: voiceId,
        speed: 1.0,
        vol: 1.0,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        format: 'mp3',
      },
    };

    return {
      url: `${baseUrl}/t2a_v2`,
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      meta: { wireModel, voiceId },
    };
  },

  parseResponse: createHexEnvelopeAudioParser<HexEnvelopeAudioMeta>({ errorTag: 'minimax tts', providerId: 'minimax' }),
};

mediaVendorRegistry.register('minimax', 'audio:speech', minimaxTTSAdapter);

export async function renderMinimaxTTS(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(minimaxTTSAdapter, ctx, credentials);
}
