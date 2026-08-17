import { afterEach, describe, expect, it, vi } from 'vitest';
import { customImageOverridesOpenAIModel, renderCustomOpenAIImage } from '../custom-image.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'custom-image',
    wireModel: 'custom-image',
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

describe('customImageOverridesOpenAIModel', () => {
  it('returns false when baseUrl or model is missing', () => {
    expect(customImageOverridesOpenAIModel(baseCtx(), null)).toBe(false);
    expect(customImageOverridesOpenAIModel(baseCtx(), { baseUrl: 'https://x' })).toBe(false);
    expect(customImageOverridesOpenAIModel(baseCtx(), { model: 'x' })).toBe(false);
  });

  it('returns true when the configured model matches the catalog model or wireModel', () => {
    const ctx = baseCtx({ model: 'dall-e-3', wireModel: 'dall-e-3-alias' });
    expect(customImageOverridesOpenAIModel(ctx, { baseUrl: 'https://x', model: 'dall-e-3' })).toBe(true);
    expect(customImageOverridesOpenAIModel(ctx, { baseUrl: 'https://x', model: 'dall-e-3-alias' })).toBe(true);
  });

  it('returns false when the configured model matches neither', () => {
    const ctx = baseCtx({ model: 'dall-e-3', wireModel: 'dall-e-3' });
    expect(customImageOverridesOpenAIModel(ctx, { baseUrl: 'https://x', model: 'something-else' })).toBe(false);
  });
});

describe('renderCustomOpenAIImage', () => {
  it('throws when no base URL is configured', async () => {
    await expect(renderCustomOpenAIImage(baseCtx(), {})).rejects.toThrow(/base URL required/);
  });

  it('throws when no model is configured and the catalog id is the generic custom-image placeholder', async () => {
    await expect(renderCustomOpenAIImage(baseCtx(), { baseUrl: 'https://x.example.com' })).rejects.toThrow(/model required/);
  });

  it('falls back to ctx.wireModel when it is not the generic placeholder id', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('my-real-model');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderCustomOpenAIImage(baseCtx({ model: 'my-real-model', wireModel: 'my-real-model' }), { baseUrl: 'https://x.example.com' });
  });

  it('posts to /images/generations without auth header when no apiKey is configured', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://x.example.com/images/generations');
      expect((init.headers as Record<string, string>).authorization).toBeUndefined();
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderCustomOpenAIImage(baseCtx(), { baseUrl: 'https://x.example.com', model: 'my-model' });
    expect(result.bytes.toString('utf8')).toBe('png-bytes');
  });

  it('includes the auth header when an apiKey is configured', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-custom');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderCustomOpenAIImage(baseCtx(), { baseUrl: 'https://x.example.com', model: 'my-model', apiKey: 'sk-custom' });
  });

  it('routes to /images/edits and includes the reference image when imageRef is set', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://x.example.com/images/edits');
      const body = JSON.parse(init.body as string);
      expect(body.images).toEqual([{ image_url: 'data:image/png;base64,AAA=' }]);
      expect(body.response_format).toBe('b64_json');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderCustomOpenAIImage(baseCtx({ imageRef: { dataUrl: 'data:image/png;base64,AAA=' } }), { baseUrl: 'https://x.example.com', model: 'my-model' });
  });
});
