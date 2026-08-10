/**
 * Provider: OpenAI Images API (gpt-image-2, gpt-image-1.5, dall-e-3, ...)
 * and text-to-speech via `/v1/audio/speech`. Ported near-verbatim from
 * Open Design's `apps/daemon/src/media/index.ts` `renderOpenAIImage`/
 * `renderOpenAISpeech` — see `source-map.md`.
 *
 * 2026-07-21: migrated onto the generic vendor-adapter dispatch engine
 * (`vendor-adapter.ts`/`vendor-registry.ts`). External behavior is
 * unchanged (verified against `openai.test.ts`, which asserts URL/body/
 * header/error-message/providerNote shape and passes unmodified) — only
 * the internal implementation moved into two registered `VendorAdapter`s.
 * `renderOpenAISpeech`'s response (raw bytes, no envelope) is the same
 * shape `fishaudio.ts` returns, so it now shares
 * `response-parsers.ts`'s `createRawBytesParser`. `renderOpenAIImage`
 * keeps a custom `parseResponse`, deliberately NOT routed through
 * `openai-compatible.ts`'s `parseOpenAICompatibleJson`/
 * `bytesFromOpenAICompatibleData` helpers despite the superficially
 * matching `{ data: [...] }` shape: the origin's non-JSON-parse-failure
 * error message is the literal string `"openai non-JSON response: ..."`
 * regardless of whether the request was Azure-routed (unlike its
 * non-OK-status error, which IS azure-tag-aware) — a real, tested
 * asymmetry in the origin (`openai.test.ts` has no azure-tagged non-JSON
 * assertion, and the origin's own catch block never references the azure
 * tag at all). Forcing this through the shared helper (which always tags
 * both messages the same way) would have silently changed that specific
 * corner's message text — exactly the kind of behavior drift this port's
 * "no scope cuts" constraint forbids, so it stays a bespoke parser
 * instead.
 *
 * Supports both the canonical OpenAI endpoint AND Azure-hosted OpenAI
 * deployments behind the same provider slot — Azure is detected from the
 * base URL (`*.azure.com` host or a `/deployments/<name>` path segment).
 * For Azure this additionally:
 *   - appends `?api-version=...` (default 2024-02-01, unless the caller
 *     already encoded one into the base URL),
 *   - sends the `api-key` header in addition to `Authorization` (Azure
 *     accepts either; some deployments only honor `api-key`),
 *   - drops the `model` field from the body, since the deployment in the
 *     path already names the model.
 *
 * Dropped from the origin: the local Codex-CLI-subscription image
 * fallback (`codex-gpt-image-2` etc.) — an OD-specific local-CLI-login
 * integration already excluded from `providers.ts`'s catalogue, not a REST
 * credential shape any other Jini consumer could use.
 */
import { Agent as UndiciAgent } from 'undici';
import {
  buildOpenAIImageUrl,
  buildOpenAISpeechUrl,
  detectAzureEndpoint,
  openaiSizeFor,
  OPENAI_TTS_VOICES,
  truncate,
  withRequestInit,
} from '../openai-compatible.js';
import { createRawBytesParser } from '../response-parsers.js';
import type { MediaSpeechFormat, ProviderCredentials, RenderContext, RenderResult } from '../types.js';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import { mediaVendorRegistry } from '../vendor-registry.js';

// Image generation can legitimately take minutes (gpt-image-2 4K renders
// especially). A generous default headers/body timeout dispatcher is
// applied so a caller-configured global fetch default doesn't cut a
// legitimately-slow-but-succeeding generation short; a caller can still
// override via `requestInit.dispatcher`.
const OPENAI_IMAGE_HEADERS_TIMEOUT_MS = 10 * 60 * 1000;
const OPENAI_IMAGE_BODY_TIMEOUT_MS = 10 * 60 * 1000;
const openAIImageDispatcher = new UndiciAgent({
  headersTimeout: OPENAI_IMAGE_HEADERS_TIMEOUT_MS,
  bodyTimeout: OPENAI_IMAGE_BODY_TIMEOUT_MS,
});

const OPENAI_IMAGE_NO_CREDENTIAL_MESSAGE = 'no OpenAI credential — configure an API key or set OPENAI_API_KEY.';
const OPENAI_SPEECH_NO_CREDENTIAL_MESSAGE = 'no OpenAI credential — configure an API key or set OPENAI_API_KEY';

interface OpenAIImageMeta {
  readonly tag: 'openai' | 'azure-openai';
  readonly wireModel: string;
}

const openAIImageAdapter: VendorAdapter<OpenAIImageMeta> = {
  requireCredential: requireApiKey(OPENAI_IMAGE_NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<OpenAIImageMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const rawBase = credentials.baseUrl || 'https://api.openai.com/v1';
    const azure = detectAzureEndpoint(rawBase);
    const url = buildOpenAIImageUrl(rawBase, azure);

    const body: Record<string, unknown> = {
      prompt: ctx.prompt || 'A high-quality reference image.',
      n: 1,
      size: openaiSizeFor(ctx.model, ctx.aspect),
    };
    // For non-Azure calls, include `model` in the body. Azure infers it from
    // the deployment in the path so omitting it keeps payloads compatible
    // across both flavors. The wire-name (post-alias) goes on the body so a
    // host's model-aliasing layer, if any, reaches the API.
    if (!azure) {
      body.model = ctx.wireModel;
    }
    // Capability branches key off the CATALOG id (not the wire alias) so a
    // host that aliased `dall-e-3` to a custom Azure/proxy deployment still
    // gets the DALL-E-specific quality + response_format flags.
    if (ctx.model.startsWith('dall-e-')) {
      body.response_format = 'b64_json';
      body.quality = ctx.model === 'dall-e-3' ? 'hd' : 'standard';
    } else {
      // gpt-image-* accepts quality 'high' | 'medium' | 'low'.
      body.quality = 'high';
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    };
    if (azure) {
      // Azure's canonical auth header. Some deployments accept Bearer too,
      // but api-key is what their docs document, so both are sent. OpenAI
      // ignores unknown headers, so this is harmless on the standard
      // endpoint too.
      headers['api-key'] = apiKey;
    }

    return {
      url,
      init: withRequestInit(ctx, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        dispatcher: ctx.requestInit.dispatcher ?? (openAIImageDispatcher as unknown as NonNullable<RequestInit['dispatcher']>),
        signal: AbortSignal.timeout(Math.max(OPENAI_IMAGE_HEADERS_TIMEOUT_MS, OPENAI_IMAGE_BODY_TIMEOUT_MS)),
      }),
      meta: { tag: azure ? 'azure-openai' : 'openai', wireModel: ctx.wireModel },
    };
  },

  async parseResponse(resp: Response, ctx: RenderContext, request: VendorRequest<OpenAIImageMeta>): Promise<RenderResult> {
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`${request.meta.tag} ${resp.status}: ${truncate(text, 240)}`);
    }
    let data: { data?: Array<{ b64_json?: string; url?: string }> };
    try {
      data = JSON.parse(text);
    } catch {
      // Deliberately not azure-tag-aware — matches the origin exactly, see
      // this module's doc comment for why.
      throw new Error(`openai non-JSON response: ${truncate(text, 200)}`);
    }
    const entry = Array.isArray(data.data) ? data.data[0] : null;
    if (!entry) throw new Error('openai response had no data[0]');
    let bytes: Buffer;
    if (entry.b64_json) {
      bytes = Buffer.from(entry.b64_json, 'base64');
    } else if (entry.url) {
      const imgResp = await fetch(entry.url, withRequestInit(ctx));
      if (!imgResp.ok) throw new Error(`openai image fetch ${imgResp.status}`);
      const arr = await imgResp.arrayBuffer();
      bytes = Buffer.from(arr);
    } else {
      throw new Error('openai response had neither b64_json nor url');
    }

    return {
      bytes,
      providerNote: `${request.meta.tag}/${request.meta.wireModel} · ${ctx.aspect} · ${bytes.length} bytes`,
      suggestedExt: '.png',
    };
  },
};

mediaVendorRegistry.register('openai', 'image', openAIImageAdapter);

export async function renderOpenAIImage(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(openAIImageAdapter, ctx, credentials);
}

interface OpenAISpeechMeta {
  readonly tag: 'openai' | 'azure-openai';
  readonly wireModel: string;
  readonly voiceId: string;
  readonly format: MediaSpeechFormat;
  readonly instructions: string;
}

const openAISpeechAdapter: VendorAdapter<OpenAISpeechMeta> = {
  requireCredential: requireApiKey(OPENAI_SPEECH_NO_CREDENTIAL_MESSAGE),

  buildRequest(ctx: RenderContext, credentials: ProviderCredentials): VendorRequest<OpenAISpeechMeta> {
    const apiKey = credentials.apiKey!; // requireCredential already validated this.
    const rawBase = credentials.baseUrl || 'https://api.openai.com/v1';
    const azure = detectAzureEndpoint(rawBase);
    const url = buildOpenAISpeechUrl(rawBase, azure);
    const format = ctx.speechFormat;
    const text = (ctx.prompt && ctx.prompt.trim()) || 'This is a test.';

    let voiceId = 'alloy';
    let instructions = '';
    const requestedVoice = (ctx.voice && ctx.voice.trim()) || '';
    if (requestedVoice) {
      if (OPENAI_TTS_VOICES.has(requestedVoice)) {
        voiceId = requestedVoice;
      } else {
        // gpt-4o-mini-tts accepts free-form speaking-style instructions. If
        // the caller passed prose rather than a concrete voice id, preserve
        // it here instead of surfacing a provider error.
        instructions = requestedVoice;
      }
    }

    const body: Record<string, unknown> = {
      input: text,
      voice: voiceId,
      response_format: format,
    };
    if (!azure) {
      body.model = ctx.wireModel;
    }
    if (instructions && ctx.model === 'gpt-4o-mini-tts') {
      body.instructions = instructions;
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    };
    if (azure) {
      headers['api-key'] = apiKey;
    }

    return {
      url,
      init: withRequestInit(ctx, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
      meta: { tag: azure ? 'azure-openai' : 'openai', wireModel: ctx.wireModel, voiceId, format, instructions },
    };
  },

  parseResponse: createRawBytesParser<OpenAISpeechMeta>({
    errorTag: (meta) => `${meta.tag} speech`,
    // Deliberately not azure-tag-aware — matches the origin exactly (see
    // this module's doc comment).
    zeroBytesMessage: 'openai speech returned zero bytes',
    note: (bytes, meta) => {
      const noteBits = [`${meta.tag}/${meta.wireModel}`, meta.voiceId, meta.format, `${bytes.length} bytes`];
      if (meta.instructions) noteBits.splice(2, 0, 'styled');
      return noteBits.join(' · ');
    },
    suggestedExt: (_bytes, meta) => (meta.format === 'opus' ? '.ogg' : `.${meta.format}`),
  }),
};

mediaVendorRegistry.register('openai', 'audio:speech', openAISpeechAdapter);

export async function renderOpenAISpeech(ctx: RenderContext, credentials: ProviderCredentials): Promise<RenderResult> {
  return dispatchVendorRequest(openAISpeechAdapter, ctx, credentials);
}
