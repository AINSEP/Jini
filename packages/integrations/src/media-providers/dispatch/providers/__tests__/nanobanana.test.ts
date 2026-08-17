import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderNanoBananaImage } from '../nanobanana.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'gemini-3.1-flash-image-preview',
    wireModel: 'gemini-3.1-flash-image-preview',
    prompt: 'a red bicycle',
    aspect: '1:1',
    length: undefined,
    duration: undefined,
    voice: '',
    audioKind: undefined,
    language: '',
    loop: false,
    promptInfluence: undefined,
    imageRef: null,
    imageRefs: [],
    requestInit: {},
    speechFormat: 'mp3',
    onProgress: undefined,
    ...overrides,
  };
}

function contentResponse(b64: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: b64 } }] } }] }),
    { status: 200 },
  );
}

describe('renderNanoBananaImage', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderNanoBananaImage(baseCtx(), {})).rejects.toThrow(/no Nano Banana credential/);
  });

  it('posts to the official Google endpoint with x-goog-api-key and decodes inlineData', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
      const headers = init.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('g-key');
      expect(headers.authorization).toBeUndefined();
      const body = JSON.parse(init.body as string);
      expect(body.contents[0].parts[0].text).toBe('a red bicycle');
      expect(body.generationConfig.imageConfig.aspectRatio).toBe('1:1');
      return contentResponse(Buffer.from('img-bytes').toString('base64'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderNanoBananaImage(baseCtx(), { apiKey: 'g-key' });
    expect(result.bytes.toString('utf8')).toBe('img-bytes');
    expect(result.providerNote).toContain('nano-banana/gemini-3.1-flash-image-preview');
    expect(result.suggestedExt).toBe('.png');
  });

  it('uses an Authorization: Bearer header for a non-official (custom gateway) baseUrl', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://gateway.example.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer g-key');
      expect(headers['x-goog-api-key']).toBeUndefined();
      return contentResponse(Buffer.from('x').toString('base64'));
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderNanoBananaImage(baseCtx(), { apiKey: 'g-key', baseUrl: 'https://gateway.example.com/' });
  });

  it('falls back to an Authorization header when baseUrl is not a parseable URL', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer g-key');
      return contentResponse(Buffer.from('x').toString('base64'));
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderNanoBananaImage(baseCtx(), { apiKey: 'g-key', baseUrl: 'not a url' });
  });

  it('prefers credentials.model over ctx.wireModel, and falls back to the default model when neither is set', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/custom-model:generateContent');
      return contentResponse(Buffer.from('x').toString('base64'));
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderNanoBananaImage(baseCtx(), { apiKey: 'g-key', model: 'custom-model' });

    const fetchMock2 = vi.fn(async (url: string) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
      return contentResponse(Buffer.from('x').toString('base64'));
    });
    vi.stubGlobal('fetch', fetchMock2);
    await renderNanoBananaImage(baseCtx({ wireModel: '' }), { apiKey: 'g-key' });
  });

  it('maps every recognized aspect and defaults an unrecognized one to 1:1', async () => {
    const aspects = ['1:1', '16:9', '9:16', '4:3', '3:4', undefined, 'not-an-aspect'] as const;
    for (const aspect of aspects) {
      const expected = aspect === '1:1' || aspect === '16:9' || aspect === '9:16' || aspect === '4:3' || aspect === '3:4' ? aspect : '1:1';
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        expect(body.generationConfig.imageConfig.aspectRatio).toBe(expected);
        return contentResponse(Buffer.from('x').toString('base64'));
      });
      vi.stubGlobal('fetch', fetchMock);
      await renderNanoBananaImage(baseCtx({ aspect }), { apiKey: 'g-key' });
    }
  });

  it('surfaces a tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })));
    await expect(renderNanoBananaImage(baseCtx(), { apiKey: 'g-key' })).rejects.toThrow(/nano-banana image 429/);
  });

  it('surfaces a tagged error on a non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(renderNanoBananaImage(baseCtx(), { apiKey: 'g-key' })).rejects.toThrow(/non-JSON response/);
  });

  it('throws when candidates is missing or not an array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    await expect(renderNanoBananaImage(baseCtx(), { apiKey: 'g-key' })).rejects.toThrow(/missing candidates/);
  });

  it('throws when a candidate has no parts array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: {} }] }), { status: 200 })));
    await expect(renderNanoBananaImage(baseCtx(), { apiKey: 'g-key' })).rejects.toThrow(/missing candidates/);
  });

  it('throws when no part has inlineData.data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no image here' }] } }] }), { status: 200 })),
    );
    await expect(renderNanoBananaImage(baseCtx(), { apiKey: 'g-key' })).rejects.toThrow(/missing candidates/);
  });
});
