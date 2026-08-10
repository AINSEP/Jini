/**
 * Provider: SenseAudio — `senseaudio-tts-1.5` text-to-speech
 * (`renderSenseAudioTTS`, `POST /v1/t2a_v2`) and text-to-image
 * (`renderSenseAudioImage`, `POST /v1/image/sync`), both synchronous.
 * Ported near-verbatim from Open Design's
 * `apps/daemon/src/media/index.ts` `renderSenseAudioTTS`/
 * `renderSenseAudioImage` — see `source-map.md`.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`). External behavior (URLs,
 * bodies, headers, every error message, `providerNote` format, the SSRF
 * guard on the image download) is unchanged; only the internal
 * implementation moved into two registered `VendorAdapter`s. TTS's
 * response envelope is identical to `minimax.ts`'s, so both now share
 * `response-parsers.ts`'s `createHexEnvelopeAudioParser`. Image's response
 * (`{ url }`, downloaded through an SSRF-guarded second fetch, with two
 * independent failure-signaling paths — `base_resp` AND a separate
 * `error_message`) has no equivalent elsewhere in this package, so it
 * keeps a custom `parseResponse` — the generic engine's `parseResponse`
 * hook is a full function precisely so a second network call mid-parse
 * (the SSRF-guarded download) stays possible; see `vendor-adapter.ts`'s
 * module doc.
 *
 * Neither endpoint is OpenAI-wire-compatible: TTS mirrors MiniMax's own
 * `voice_setting`/`audio_setting` body shape and `base_resp` response
 * envelope (an HTTP 200 can still be a logical failure), and image returns
 * `{ url }` rather than `{ data: [...] }`, so only the generic
 * `withRequestInit` helper is reused from `openai-compatible.ts` (matching
 * `minimax.ts`'s reasoning).
 *
 * `renderSenseAudioImage`'s `url` is fetched through `ssrf-guard.ts`'s
 * `assertAndFetchExternalAsset` — same as the real origin — because it is
 * attacker-controllable inside an otherwise-successful response (a
 * compromised/misconfigured gateway could point it at internal
 * infrastructure); `assertAndFetchExternalAsset` DNS-resolves the host,
 * rejects loopback/RFC1918/link-local/CGNAT/metadata-service addresses,
 * and pins `redirect: 'error'` so a validated public URL can't 302 into
 * private space either.
 *
 * Dropped from the origin's no-credential error messages (both
 * functions): the `OD_`-prefixed override env var
 * (`OD_SENSEAUDIO_API_KEY`) — `providers.ts`'s
 * `PROVIDER_CREDENTIAL_ENV_VARS.senseaudio` already de-branded this to
 * plain `SENSEAUDIO_API_KEY`.
 */
import { truncate, withRequestInit } from '../openai-compatible.js';
import type { HexEnvelopeAudioMeta } from '../response-parsers.js';
import { createHexEnvelopeAudioParser } from '../response-parsers.js';
import { assertAndFetchExternalAsset } from '../ssrf-guard.js';
import type { ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';

const SENSEAUDIO_DEFAULT_BASE_URL = 'https://api.senseaudio.cn';
const SENSEAUDIO_DEFAULT_VOICE_ID = 'female_0033_b';
const SENSEAUDIO_IMAGE_PROMPT_LIMIT = 2000;

const SENSEAUDIO_TTS_MODEL_MAP: Record<string, string> = {
  'senseaudio-tts': 'senseaudio-tts-1.5-260319',
};

const NO_CREDENTIAL_MESSAGE = 'no SenseAudio credential — configure an API key or set SENSEAUDIO_API_KEY.';

const senseAudioTTSAdapter: VendorAdapter<HexEnvelopeAudioMeta> = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<HexEnvelopeAudioMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = (credentials.baseUrl || SENSEAUDIO_DEFAULT_BASE_URL).replace(/\/$/, '');
    const wireModel = SENSEAUDIO_TTS_MODEL_MAP[ctx.model] || ctx.model;
    const text = (ctx.prompt && ctx.prompt.trim()) || 'This is a test.';
    const voiceId = (ctx.voice && ctx.voice.trim()) || SENSEAUDIO_DEFAULT_VOICE_ID;

    const body = {
      model: wireModel,
      text,
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        format: 'mp3',
        sample_rate: 32000,
        bitrate: 128000,
        channel: 2,
      },
    };

    return {
      url: `${baseUrl}/v1/t2a_v2`,
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

  parseResponse: createHexEnvelopeAudioParser<HexEnvelopeAudioMeta>({ errorTag: 'senseaudio tts', providerId: 'senseaudio' }),
};

mediaVendorRegistry.register('senseaudio', 'audio:speech', senseAudioTTSAdapter);

export async function renderSenseAudioTTS(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(senseAudioTTSAdapter, ctx, credentials);
}

/** SenseAudio's image gateway rejects non-standard pixel sizes with a 400; keep this mapping in sync with any other SenseAudio-image call site a future host adds. */
function senseAudioImageSize(aspect: string | undefined): string {
  if (aspect === '16:9') return '1280x720';
  if (aspect === '9:16') return '720x1280';
  if (aspect === '4:3') return '1024x768';
  if (aspect === '3:4') return '768x1024';
  return '1024x1024';
}

interface SenseAudioImageMeta {
  readonly size: string;
  readonly hasReference: boolean;
}

interface SenseAudioBaseResp {
  readonly status_code?: number;
  readonly status_msg?: string;
}

interface SenseAudioImageResponse {
  readonly base_resp?: SenseAudioBaseResp;
  readonly error_message?: string;
  readonly url?: string;
}

const senseAudioImageAdapter: VendorAdapter<SenseAudioImageMeta> = {
  requireCredential: requireApiKey(NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<SenseAudioImageMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const baseUrl = (credentials.baseUrl || SENSEAUDIO_DEFAULT_BASE_URL).replace(/\/$/, '');
    const promptRaw = (ctx.prompt && ctx.prompt.trim()) || 'A high-quality reference image.';
    // SenseAudio rejects prompts over 2000 chars with a 4xx; trim
    // defensively so a verbose caller doesn't dead-end the generation.
    const prompt = promptRaw.length > SENSEAUDIO_IMAGE_PROMPT_LIMIT ? promptRaw.slice(0, SENSEAUDIO_IMAGE_PROMPT_LIMIT) : promptRaw;
    const size = senseAudioImageSize(ctx.aspect);
    const reference = ctx.imageRef?.dataUrl;

    const body: Record<string, unknown> = {
      model: ctx.wireModel,
      prompt,
      size,
    };
    if (reference) {
      // The API documents `size` as optional when a reference image is
      // supplied; it is still sent so output dimensions stay deterministic
      // across t2i/i2i calls for the same model.
      body.reference = reference;
    }

    return {
      url: `${baseUrl}/v1/image/sync`,
      init: withRequestInit(ctx, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      meta: { size, hasReference: Boolean(reference) },
    };
  },

  async parseResponse(resp: Response, ctx: RenderContext, request: VendorRequest<SenseAudioImageMeta>): Promise<RenderResult> {
    const respText = await resp.text();
    if (!resp.ok) {
      throw new Error(`senseaudio image ${resp.status}: ${truncate(respText, 240)}`);
    }
    let data: SenseAudioImageResponse;
    try {
      data = JSON.parse(respText);
    } catch {
      throw new Error(`senseaudio image non-JSON: ${truncate(respText, 200)}`);
    }
    if (data.base_resp && data.base_resp.status_code !== 0) {
      throw new Error(`senseaudio image api error ${data.base_resp.status_code}: ${data.base_resp.status_msg || 'unknown'}`);
    }
    if (typeof data.error_message === 'string' && data.error_message) {
      throw new Error(`senseaudio image api error: ${data.error_message}`);
    }
    const url = typeof data.url === 'string' ? data.url : '';
    if (!url) {
      throw new Error('senseaudio image response missing url');
    }
    const imgResp = await assertAndFetchExternalAsset(url, withRequestInit(ctx));
    if (!imgResp.ok) {
      throw new Error(`senseaudio image fetch ${imgResp.status}`);
    }
    const bytes = Buffer.from(await imgResp.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error('senseaudio image fetch returned zero bytes');
    }

    return {
      bytes,
      providerNote: `senseaudio/${ctx.wireModel} · ${request.meta.size}${request.meta.hasReference ? ' · i2i' : ''} · ${bytes.length} bytes`,
      suggestedExt: '.png',
    };
  },
};

mediaVendorRegistry.register('senseaudio', 'image', senseAudioImageAdapter);

export async function renderSenseAudioImage(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(senseAudioImageAdapter, ctx, credentials);
}
