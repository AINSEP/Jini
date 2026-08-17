/**
 * Reusable `VendorResponseParser` factories for the two response shapes
 * that genuinely repeat, byte-for-byte, across multiple already-ported
 * vendors (verified by reading their real bodies — see `source-map.md`'s
 * 2026-07-21 dispatch-engine-generalization section, not assumed from
 * their doc comments alone):
 *
 * - `createRawBytesParser` — "POST JSON, get raw audio/image bytes back
 *   directly (no envelope)" — used today by `providers/fishaudio.ts`'s
 *   `renderFishAudioTTS` and `providers/openai.ts`'s `renderOpenAISpeech`.
 *   xAI TTS (`grok.ts`'s `renderXAITTS`) and ElevenLabs's two renderers
 *   have the identical shape and are natural future migrations onto this
 *   same parser, not yet done this pass (see source-map.md for why).
 * - `createHexEnvelopeAudioParser` — "POST JSON, get hex-encoded audio back
 *   inside a `base_resp`-enveloped JSON body" — used today by
 *   `providers/minimax.ts` and `providers/senseaudio.ts`'s TTS renderers,
 *   which were verified (by reading both files in full) to share this
 *   exact structure down to the literal error-message templates, modulo a
 *   provider-tag string.
 *
 * Not every vendor's response shape fits either factory (e.g. OpenAI's own
 * image response, whose non-JSON error message is NOT azure-tag-aware
 * while its non-ok error message IS — see `providers/openai.ts`'s
 * `parseOpenAIImageResponse` — or SenseAudio's image response, which needs
 * a second SSRF-guarded fetch mid-parse). Those stay custom
 * `VendorResponseParser` functions, which is the expected, legitimate
 * outcome for a vendor whose wire shape doesn't actually match another
 * vendor's — see this package's `vendor-adapter.ts` module doc for why
 * `parseResponse` is a function, not a further declarative shape.
 */
import { truncate } from './openai-compatible.js';
import type { VendorResponseParser } from './vendor-adapter.js';

type Resolvable<T, Args extends readonly unknown[]> = T | ((...args: Args) => T);

function resolve<T, Args extends readonly unknown[]>(value: Resolvable<T, Args>, args: Args): T {
  return typeof value === 'function' ? (value as (...args: Args) => T)(...args) : value;
}

export interface RawBytesParserOptions<Meta> {
  /** Used in the `${tag} ${status}: ${truncated body}` message thrown on a non-OK response. A function receives the request's `meta` (e.g. so a dynamically-computed azure/non-azure tag survives the port — see `providers/openai.ts`). */
  readonly errorTag: Resolvable<string, [meta: Meta]>;
  /** Thrown verbatim when the response body decodes to zero bytes. */
  readonly zeroBytesMessage: Resolvable<string, [meta: Meta]>;
  /** Builds the successful `RenderResult.providerNote`. */
  readonly note: (bytes: Buffer, meta: Meta) => string;
  /** The successful `RenderResult.suggestedExt`. */
  readonly suggestedExt: Resolvable<string, [bytes: Buffer, meta: Meta]>;
}

/**
 * A `VendorResponseParser` for vendors that return raw bytes directly (no
 * JSON envelope): non-OK -> read text, throw a tagged/truncated error;
 * otherwise read the full body as bytes, throw on zero bytes, else build a
 * `RenderResult` via `note`/`suggestedExt`. This is the exact control flow
 * `fishaudio.ts`'s `renderFishAudioTTS` and `openai.ts`'s
 * `renderOpenAISpeech` each independently hand-wrote before this pass.
 */
export function createRawBytesParser<Meta = undefined>(options: RawBytesParserOptions<Meta>): VendorResponseParser<Meta> {
  return async (resp, _ctx, request) => {
    if (!resp.ok) {
      const text = await resp.text();
      const tag = resolve(options.errorTag, [request.meta]);
      throw new Error(`${tag} ${resp.status}: ${truncate(text, 240)}`);
    }
    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.length === 0) {
      throw new Error(resolve(options.zeroBytesMessage, [request.meta]));
    }
    return {
      bytes,
      providerNote: options.note(bytes, request.meta),
      suggestedExt: resolve(options.suggestedExt, [bytes, request.meta]),
    };
  };
}

/** The `meta` shape `createHexEnvelopeAudioParser` needs to build a `providerNote` — the resolved wire model id and voice id, both already computed by the adapter's `buildRequest`. */
export interface HexEnvelopeAudioMeta {
  readonly wireModel: string;
  readonly voiceId: string;
}

interface HexEnvelopeAudioResponse {
  readonly base_resp?: { readonly status_code?: number; readonly status_msg?: string };
  readonly data?: { readonly audio?: string };
  readonly extra_info?: { readonly audio_length?: number };
}

export interface HexEnvelopeAudioParserOptions {
  /** Used verbatim as the tag in every error this parser can throw (`${errorTag} ${status}: ...`, `${errorTag} non-JSON: ...`, `${errorTag} api error ...: ...`, `${errorTag} response missing data.audio`, `${errorTag} decoded zero bytes`) — e.g. `'minimax tts'` / `'senseaudio tts'`. */
  readonly errorTag: string;
  /** Used as the `providerNote`'s `<providerId>/<wireModel> · <voiceId> · <seconds>s · <bytes> bytes` prefix — e.g. `'minimax'` / `'senseaudio'`. */
  readonly providerId: string;
}

/**
 * A `VendorResponseParser` for vendors whose TTS response wraps hex-encoded
 * audio inside a `base_resp`-enveloped JSON body (an HTTP 200 can still be
 * a *logical* failure) — the exact shape MiniMax's and SenseAudio's TTS
 * endpoints both independently return, verified identical (down to the
 * literal error-message templates) by reading both origin renderers in
 * full. `extra_info.audio_length` is centiseconds; `seconds` is `'?'` when
 * absent, matching both vendors' own formatting.
 */
export function createHexEnvelopeAudioParser<Meta extends HexEnvelopeAudioMeta>(
  options: HexEnvelopeAudioParserOptions,
): VendorResponseParser<Meta> {
  return async (resp, _ctx, request) => {
    const respText = await resp.text();
    if (!resp.ok) {
      throw new Error(`${options.errorTag} ${resp.status}: ${truncate(respText, 240)}`);
    }
    let data: HexEnvelopeAudioResponse;
    try {
      data = JSON.parse(respText);
    } catch {
      throw new Error(`${options.errorTag} non-JSON: ${truncate(respText, 200)}`);
    }
    if (data.base_resp && data.base_resp.status_code !== 0) {
      throw new Error(`${options.errorTag} api error ${data.base_resp.status_code}: ${data.base_resp.status_msg || 'unknown'}`);
    }
    const hex = data.data?.audio;
    if (typeof hex !== 'string' || !hex) {
      throw new Error(`${options.errorTag} response missing data.audio`);
    }
    const bytes = Buffer.from(hex, 'hex');
    if (bytes.length === 0) {
      throw new Error(`${options.errorTag} decoded zero bytes`);
    }
    const audioLength = data.extra_info?.audio_length;
    const seconds = audioLength ? Math.round(audioLength / 100) / 10 : '?';
    return {
      bytes,
      providerNote: `${options.providerId}/${request.meta.wireModel} · ${request.meta.voiceId} · ${seconds}s · ${bytes.length} bytes`,
      suggestedExt: '.mp3',
    };
  };
}
