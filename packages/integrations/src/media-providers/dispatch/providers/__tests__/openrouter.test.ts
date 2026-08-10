import { afterEach, describe, expect, it, vi } from 'vitest';
import { openRouterAspectFor, renderOpenRouterImage } from '../openrouter.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'openrouter/black-forest-labs/flux-1.1-pro',
    wireModel: 'openrouter/black-forest-labs/flux-1.1-pro',
    prompt: 'a red bicycle',
    aspect: '16:9',
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

function chatResponse(images: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { images } }] }), { status: 200 });
}

describe('openRouterAspectFor', () => {
  it('passes through every recognized aspect', () => {
    expect(openRouterAspectFor('1:1')).toBe('1:1');
    expect(openRouterAspectFor('16:9')).toBe('16:9');
    expect(openRouterAspectFor('9:16')).toBe('9:16');
    expect(openRouterAspectFor('4:3')).toBe('4:3');
    expect(openRouterAspectFor('3:4')).toBe('3:4');
  });

  it('defaults to 16:9 for an unrecognized or missing aspect', () => {
    expect(openRouterAspectFor(undefined)).toBe('16:9');
    expect(openRouterAspectFor('21:9')).toBe('16:9');
  });
});

describe('renderOpenRouterImage', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderOpenRouterImage(baseCtx(), {})).rejects.toThrow(/no OpenRouter API key/);
  });

  it('strips the openrouter/ catalogue prefix and posts to /chat/completions', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('img-bytes').toString('base64')}`;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('black-forest-labs/flux-1.1-pro');
      expect(body.modalities).toEqual(['image']);
      expect(body.image_config).toEqual({ aspect_ratio: '16:9', image_size: '1K' });
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer or-test');
      return chatResponse([{ image_url: { url: dataUrl } }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' });
    expect(result.bytes.toString('utf8')).toBe('img-bytes');
    expect(result.providerNote).toContain('openrouter/black-forest-labs/flux-1.1-pro');
  });

  it('requests both image and text modalities for a gemini-slug model', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.modalities).toEqual(['image', 'text']);
      return chatResponse([{ image_url: { url: dataUrl } }]);
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenRouterImage(
      baseCtx({ model: 'openrouter/google/gemini-2.5-flash-image', wireModel: 'openrouter/google/gemini-2.5-flash-image' }),
      { apiKey: 'or-test' },
    );
  });

  it('honors credentials.model over ctx.wireModel', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('override/model');
      return chatResponse([{ image_url: { url: dataUrl } }]);
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenRouterImage(baseCtx(), { apiKey: 'or-test', model: 'openrouter/override/model' });
  });

  it('leaves a model slug without the openrouter/ prefix unchanged', async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('black-forest-labs/flux-1.1-pro');
      return chatResponse([{ image_url: { url: dataUrl } }]);
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenRouterImage(baseCtx(), { apiKey: 'or-test', model: 'black-forest-labs/flux-1.1-pro' });
  });

  it('downloads a plain http(s) image URL when no data: prefix is present', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/chat/completions') {
        return chatResponse([{ image_url: { url: 'https://cdn.example.com/or.png' } }]);
      }
      if (url === 'https://cdn.example.com/or.png') {
        return new Response(Buffer.from('remote-bytes'), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' });
    expect(result.bytes.toString('utf8')).toBe('remote-bytes');
  });

  it('throws when the http(s) image download fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://openrouter.ai/api/v1/chat/completions') {
        return chatResponse([{ image_url: { url: 'https://cdn.example.com/missing.png' } }]);
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' })).rejects.toThrow(/openrouter image download 404/);
  });

  it('treats a bare string as raw base64 when it has neither a data: prefix nor an http(s) scheme', async () => {
    const raw = Buffer.from('raw-bytes').toString('base64');
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse([{ image_url: { url: raw } }])));
    const result = await renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' });
    expect(result.bytes.toString('utf8')).toBe('raw-bytes');
  });

  it('surfaces a tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' })).rejects.toThrow(/openrouter image 429/);
  });

  it('surfaces a tagged error on a non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' })).rejects.toThrow(/non-JSON response/);
  });

  it('throws when the response contains no images', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse(undefined)));
    await expect(renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' })).rejects.toThrow(/contained no images/);
  });

  it('throws when the response has an empty images array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse([])));
    await expect(renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' })).rejects.toThrow(/contained no images/);
  });

  it('throws when the first image is missing image_url.url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse([{ image_url: {} }])));
    await expect(renderOpenRouterImage(baseCtx(), { apiKey: 'or-test' })).rejects.toThrow(/missing image_url\.url/);
  });
});
