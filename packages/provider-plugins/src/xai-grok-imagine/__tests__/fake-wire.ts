/** A fake of the host's generic wire helpers: enough behaviour to drive the vendor adapters, no network. */
import type { MediaRenderContext, MediaVendorAdapter, MediaWirePort } from '@jini-ai/core/contracts/site/media-provider-contribution';

const ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);

export const fakeWire: MediaWirePort = {
  requireApiKey: ({ message }) => ({ credentials }) => { if (!credentials.apiKey) throw new Error(message); },
  imageAspectFor: ({ aspect }) => (aspect !== undefined && ASPECTS.has(aspect) ? aspect : '16:9'),
  imageGenerationUrl: ({ baseUrl }) => `${baseUrl}/images/generations`,
  jsonPostInit: ({ body }, { apiKey } = {}) => ({
    method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify(body),
  }),
  parseJson: async ({ resp, providerTag }) => {
    const text = await resp.text();
    if (!resp.ok) throw new Error(`${providerTag} ${resp.status}: ${text.slice(0, 240)}`);
    return JSON.parse(text) as unknown;
  },
  imageBytesFromData: async ({ data, providerTag }) => {
    const entry = (data as { data?: { b64_json?: string; url?: string }[] }).data?.[0];
    if (entry?.b64_json) return Buffer.from(entry.b64_json, 'base64');
    if (entry?.url) return Buffer.from(`fetched:${entry.url}`);
    throw new Error(`${providerTag} response had no data[0]`);
  },
  sniffImageExt: () => '.png',
  createRawBytesParser: ({ errorTag, zeroBytesMessage, note, suggestedExt }) => async ({ resp, request }) => {
    if (!resp.ok) throw new Error(`${errorTag} ${resp.status}: ${(await resp.text()).slice(0, 240)}`);
    const bytes = Buffer.from(await resp.arrayBuffer());
    if (bytes.length === 0) throw new Error(zeroBytesMessage);
    return { bytes, providerNote: note({ bytes, meta: request.meta }), suggestedExt };
  },
};

export function renderContext(overrides: Partial<MediaRenderContext> = {}): MediaRenderContext {
  return { wireModel: 'grok-imagine-image', prompt: 'a red bicycle', aspect: '16:9', voice: '', language: '', requestInit: {}, ...overrides };
}

/** The same credential -> build -> one fetch -> parse round trip the host's dispatch runs, over a fake fetch. */
export async function runAdapter(
  { adapter, ctx, credentials, respond }: { adapter: MediaVendorAdapter<never>; ctx: MediaRenderContext; credentials: { apiKey?: string; baseUrl?: string }; respond: (request: { url: string; init: RequestInit }) => Response },
) {
  adapter.requireCredential?.({ credentials });
  const request = adapter.buildRequest({ ctx, credentials });
  return adapter.parseResponse({ resp: respond(request), ctx, request });
}
