import { describe, expect, it } from 'vitest';
import {
  AIHUBMIX_APP_CODE,
  aihubmixAppCodeHeader,
  aihubmixGeminiImageBytes,
  aihubmixGeminiImageUrl,
  aihubmixHeaders,
  aihubmixOriginFromBase,
  aihubmixWireModel,
  classifyAIHubMixModel,
} from '../aihubmix-shared.js';

describe('aihubmixHeaders / aihubmixAppCodeHeader', () => {
  it('builds the Bearer + APP-Code header set', () => {
    expect(aihubmixHeaders('sk-test')).toEqual({ authorization: 'Bearer sk-test', 'APP-Code': AIHUBMIX_APP_CODE });
  });

  it('returns just the APP-Code header on its own', () => {
    expect(aihubmixAppCodeHeader()).toEqual({ 'APP-Code': AIHUBMIX_APP_CODE });
  });
});

describe('classifyAIHubMixModel', () => {
  it('classifies gemini-/imagen-prefixed models as gemini', () => {
    expect(classifyAIHubMixModel('gemini-3-pro-image-preview')).toBe('gemini');
    expect(classifyAIHubMixModel('imagen-4')).toBe('gemini');
  });

  it('normalizes case and surrounding whitespace before classifying', () => {
    expect(classifyAIHubMixModel(' GEMINI-Pro ')).toBe('gemini');
  });

  it('excludes -nothink and -search suffixed gemini models from the gemini classification', () => {
    expect(classifyAIHubMixModel('gemini-3-pro-nothink')).toBe('openai');
    expect(classifyAIHubMixModel('gemini-3-pro-search')).toBe('openai');
  });

  it('excludes embedding models from the gemini classification', () => {
    expect(classifyAIHubMixModel('gemini-embedding-001')).toBe('openai');
  });

  it('classifies claude-prefixed models as anthropic', () => {
    expect(classifyAIHubMixModel('claude-3-opus')).toBe('anthropic');
  });

  it('falls back to openai for everything else, including an empty model id', () => {
    expect(classifyAIHubMixModel('gpt-image-1')).toBe('openai');
    expect(classifyAIHubMixModel('')).toBe('openai');
  });
});

describe('aihubmixOriginFromBase', () => {
  it('returns the origin of a valid base URL', () => {
    expect(aihubmixOriginFromBase('https://aihubmix.com/v1')).toBe('https://aihubmix.com');
    expect(aihubmixOriginFromBase('https://custom.gateway.example.com/v1/openai')).toBe('https://custom.gateway.example.com');
  });

  it('defaults to the canonical AIHubMix origin when baseUrl is empty', () => {
    expect(aihubmixOriginFromBase('')).toBe('https://aihubmix.com');
  });

  it('falls back to the canonical AIHubMix origin on an unparseable URL', () => {
    expect(aihubmixOriginFromBase('not a url')).toBe('https://aihubmix.com');
  });
});

describe('aihubmixGeminiImageUrl', () => {
  it('builds the Gemini-native generateContent endpoint with the model URI-encoded', () => {
    expect(aihubmixGeminiImageUrl('https://aihubmix.com/v1', 'gemini-3-pro-image-preview')).toBe(
      'https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image-preview:generateContent',
    );
  });
});

describe('aihubmixWireModel', () => {
  it('maps known aihubmix- catalog ids to their real upstream names', () => {
    expect(aihubmixWireModel('aihubmix-gpt-image-1')).toBe('gpt-image-1');
    expect(aihubmixWireModel('aihubmix-dall-e-3')).toBe('dall-e-3');
    expect(aihubmixWireModel('aihubmix-tts-1')).toBe('tts-1');
  });

  it('strips an unmapped aihubmix- prefix as a fallback', () => {
    expect(aihubmixWireModel('aihubmix-gemini-3-pro-image-preview')).toBe('gemini-3-pro-image-preview');
  });

  it('passes an id with no aihubmix- prefix through unchanged', () => {
    expect(aihubmixWireModel('some-arbitrary-id')).toBe('some-arbitrary-id');
  });
});

describe('aihubmixGeminiImageBytes', () => {
  const baseReq = { baseUrl: 'https://aihubmix.com/v1', apiKey: 'sk-test', wireModel: 'gemini-3-pro-image-preview', prompt: 'a red bicycle', aspect: '1:1' };

  it('posts to the Gemini-native endpoint with the x-goog-api-key + APP-Code headers and decodes inlineData', async () => {
    const doFetch = async (url: string, init: RequestInit) => {
      expect(url).toBe('https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image-preview:generateContent');
      expect(init.redirect).toBe('error');
      const headers = init.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('sk-test');
      expect(headers['APP-Code']).toBe(AIHUBMIX_APP_CODE);
      const body = JSON.parse(init.body as string);
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'a red bicycle' }] }]);
      expect(body.generationConfig).toEqual({ responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } });
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('img-bytes').toString('base64') } }] } }] }),
        { status: 200 },
      );
    };
    const bytes = await aihubmixGeminiImageBytes(baseReq, doFetch);
    expect(bytes.toString('utf8')).toBe('img-bytes');
  });

  it('decodes the snake_case inline_data field when that is what the response uses', async () => {
    const doFetch = async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { data: Buffer.from('x').toString('base64') } }] } }] }), { status: 200 });
    const bytes = await aihubmixGeminiImageBytes(baseReq, doFetch);
    expect(bytes.toString('utf8')).toBe('x');
  });

  it('finds inline data in a later part when an earlier part has none', async () => {
    const doFetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'no image here' }, { inlineData: { data: Buffer.from('later').toString('base64') } }] } }],
        }),
        { status: 200 },
      );
    const bytes = await aihubmixGeminiImageBytes(baseReq, doFetch);
    expect(bytes.toString('utf8')).toBe('later');
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    const doFetch = async () => new Response('bad request', { status: 400 });
    await expect(aihubmixGeminiImageBytes(baseReq, doFetch)).rejects.toThrow(/^aihubmix image \(gemini\) 400: bad request$/);
  });

  it('falls back to an empty error body when reading the non-OK response text itself fails', async () => {
    const doFetch = async () =>
      ({ ok: false, status: 500, text: () => Promise.reject(new Error('stream closed')) }) as unknown as Response;
    await expect(aihubmixGeminiImageBytes(baseReq, doFetch)).rejects.toThrow(/^aihubmix image \(gemini\) 500: $/);
  });

  it('throws when the response has no inline image data anywhere', async () => {
    const doFetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }), { status: 200 });
    await expect(aihubmixGeminiImageBytes(baseReq, doFetch)).rejects.toThrow(/had no inline image data/);
  });

  it('throws when candidates is entirely absent', async () => {
    const doFetch = async () => new Response(JSON.stringify({}), { status: 200 });
    await expect(aihubmixGeminiImageBytes(baseReq, doFetch)).rejects.toThrow(/had no inline image data/);
  });
});
