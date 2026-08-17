/**
 * Shared plumbing for the AIHubMix aggregator gateway (an OpenAI-wire-
 * compatible aggregator: one API key fronts OpenAI/Anthropic/Gemini
 * models, routed by model name). Ported near-verbatim from Open Design's
 * `apps/daemon/src/integrations/aihubmix.ts` — see `source-map.md`. Only
 * the pieces `providers/aihubmix.ts`'s image/TTS renderers need are
 * ported; see "Not ported" below for what's deliberately left out.
 *
 * The distinctive AIHubMix detail is the `APP-Code` attribution header — a
 * fixed per-integration code that grants a usage discount (the same
 * mechanism cherry-studio and the dify plugin use) — funneled through
 * `aihubmixHeaders()`/`aihubmixAppCodeHeader()` rather than re-derived at
 * each call site.
 *
 * Simplified from the origin: `aihubmixAppCodeHeader()` (and
 * `aihubmixHeaders()`, which spreads it) dropped the origin's
 * `AIHUBMIX_APP_CODE ? { 'APP-Code': ... } : {}` conditional.
 * `AIHUBMIX_APP_CODE` is a fixed non-empty literal with no configuration
 * surface in either the origin or this port, so the `: {}` branch is
 * provably unreachable through any real call — proven, not assumed, the
 * same way `engine.ts`'s dead-branch removals are — and was simplified to
 * an unconditional header rather than left as an untestable branch or
 * covered with a contrived test that fakes an empty app code.
 *
 * Not ported: `aihubmixVideoSeconds` (video is deferred — see
 * `source-map.md`'s async-polling bucket), `aihubmixCatalogUrl`/
 * `parseAIHubMixCatalog`/`AIHubMixCatalogModel` (a model-catalogue-
 * discovery HTTP call, not part of the render path), and
 * `AIHUBMIX_IMAGE_ASPECT_TO_SIZE` (used by OD's in-chat `generate_image`
 * tool, not the media renderer — which uses `openai-compatible.ts`'s
 * already-ported `openaiSizeFor` instead).
 */

/** Fixed App Code for this integration (from https://aihubmix.com/appstore) — sent as the `APP-Code` attribution header on every AIHubMix request to grant the integration's usage discount. */
export const AIHUBMIX_APP_CODE = 'DMCY9912';

/** Default base URL assumed when a caller leaves `baseUrl` unset. */
export const AIHUBMIX_DEFAULT_BASE_URL = 'https://aihubmix.com/v1';

/** Outbound header set for an AIHubMix Bearer-authenticated request: `Authorization` plus the `APP-Code` attribution header. */
export function aihubmixHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'APP-Code': AIHUBMIX_APP_CODE,
  };
}

/** The `APP-Code` attribution header on its own (no auth) — for routes that carry their own auth header (e.g. Gemini-native's `x-goog-api-key`), spread alongside it so every AIHubMix request still carries `APP-Code`. */
export function aihubmixAppCodeHeader(): Record<string, string> {
  return { 'APP-Code': AIHUBMIX_APP_CODE };
}

export type AIHubMixProtocol = 'openai' | 'anthropic' | 'gemini';

/**
 * Model-name -> upstream-protocol routing (AIHubMix integration guide
 * §4.3). AIHubMix dispatches by model name on its side, but for native
 * fidelity the recommended client pattern is to call each family on its
 * native wire/endpoint rather than the unified OpenAI endpoint.
 */
export function classifyAIHubMixModel(model: string): AIHubMixProtocol {
  const m = (model || '').trim().toLowerCase();
  // Gemini: gemini*/imagen*, excluding -nothink/-search suffixes and any
  // embedding model (those stay on the OpenAI-compatible path).
  if ((m.startsWith('gemini') || m.startsWith('imagen')) && !/-(nothink|search)$/.test(m) && !m.includes('embedding')) {
    return 'gemini';
  }
  if (m.startsWith('claude')) return 'anthropic';
  return 'openai';
}

/** Origin of the configured AIHubMix base URL, falling back to the canonical AIHubMix host on an unparseable input. */
export function aihubmixOriginFromBase(baseUrl: string): string {
  try {
    return new URL(baseUrl || AIHUBMIX_DEFAULT_BASE_URL).origin;
  } catch {
    return 'https://aihubmix.com';
  }
}

/** Gemini-native `generateContent` endpoint for an AIHubMix image model. */
export function aihubmixGeminiImageUrl(baseUrl: string, wireModel: string): string {
  return `${aihubmixOriginFromBase(baseUrl)}/gemini/v1beta/models/${encodeURIComponent(wireModel)}:generateContent`;
}

export interface AIHubMixGeminiImageRequest {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly wireModel: string;
  readonly prompt: string;
  /** Gemini aspectRatio string, e.g. "1:1" / "16:9". */
  readonly aspect: string;
}

/**
 * Generates an image through AIHubMix's Gemini-native `generateContent`
 * wire and returns the decoded image bytes. Gemini/Imagen-family image
 * models reject the OpenAI `/images/generations` shape ("Unknown name
 * prompt/n/size"), so `providers/aihubmix.ts` routes those models here
 * instead. `doFetch` lets the caller apply its own request-init wrapper
 * (proxy dispatcher, abort signal); throws on a non-OK status or a
 * response without inline image data.
 */
export async function aihubmixGeminiImageBytes(req: AIHubMixGeminiImageRequest, doFetch: (url: string, init: RequestInit) => Promise<Response>): Promise<Buffer> {
  const url = aihubmixGeminiImageUrl(req.baseUrl, req.wireModel);
  const resp = await doFetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': req.apiKey,
      ...aihubmixAppCodeHeader(),
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: req.aspect },
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`aihubmix image (gemini) ${resp.status}: ${text.slice(0, 240)}`);
  }
  const data = (await resp.json()) as { candidates?: ReadonlyArray<{ content?: { parts?: ReadonlyArray<{ inlineData?: { data?: unknown }; inline_data?: { data?: unknown } }> } }> };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find((d): d is string => typeof d === 'string' && d.length > 0);
  if (!b64) {
    throw new Error(`aihubmix gemini image response had no inline image data: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return Buffer.from(b64, 'base64');
}

// Catalogue ids vs wire names. The media registry requires globally-unique
// model ids, but `gpt-image-1`/`dall-e-3`/`tts-1` are already owned by the
// `openai` provider, so AIHubMix's models are registered with an
// `aihubmix-` prefix and mapped back to the real upstream name here. A
// plain prefix strip is the fallback so adding a new `aihubmix-<wire>`
// catalogue entry needs no edit here.
const AIHUBMIX_WIRE_MODELS: Readonly<Record<string, string>> = {
  'aihubmix-gpt-image-1': 'gpt-image-1',
  'aihubmix-dall-e-3': 'dall-e-3',
  'aihubmix-tts-1': 'tts-1',
};

export function aihubmixWireModel(catalogId: string): string {
  return AIHUBMIX_WIRE_MODELS[catalogId] ?? catalogId.replace(/^aihubmix-/, '');
}
