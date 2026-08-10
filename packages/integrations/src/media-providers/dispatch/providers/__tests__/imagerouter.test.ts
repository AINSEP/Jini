import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageRouterSizeFor, renderImageRouterImage, renderImageRouterVideo } from '../imagerouter.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'openai/gpt-image-2',
    wireModel: 'openai/gpt-image-2',
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

describe('imageRouterSizeFor', () => {
  it('image: maps every recognized aspect', () => {
    expect(imageRouterSizeFor('16:9', 'image')).toBe('1024x576');
    expect(imageRouterSizeFor('9:16', 'image')).toBe('576x1024');
    expect(imageRouterSizeFor('4:3', 'image')).toBe('1024x768');
    expect(imageRouterSizeFor('3:4', 'image')).toBe('768x1024');
  });

  it('video: maps every recognized aspect', () => {
    expect(imageRouterSizeFor('1:1', 'video')).toBe('1024x1024');
    expect(imageRouterSizeFor('9:16', 'video')).toBe('576x1024');
    expect(imageRouterSizeFor('4:3', 'video')).toBe('1024x768');
    expect(imageRouterSizeFor('3:4', 'video')).toBe('768x1024');
  });

  it('defaults to square (image) / 1024x576 (video) when aspect is unrecognized', () => {
    expect(imageRouterSizeFor(undefined, 'image')).toBe('1024x1024');
    expect(imageRouterSizeFor(undefined, 'video')).toBe('1024x576');
  });
});

describe('renderImageRouterImage', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderImageRouterImage(baseCtx(), {})).rejects.toThrow(/no ImageRouter API key/);
  });

  it('posts to the default base URL and decodes a b64_json response', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.imagerouter.io/v1/openai/images/generations');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('openai/gpt-image-2');
      expect(body.size).toBe('1024x576');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderImageRouterImage(baseCtx(), { apiKey: 'ir-key' });
    expect(result.bytes.toString('utf8')).toBe('img');
    expect(result.providerNote).toContain('imagerouter/openai/gpt-image-2');
  });

  it('honors a caller-supplied baseUrl and model override', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://custom.example.com/images/generations');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('override-model');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderImageRouterImage(baseCtx(), { apiKey: 'ir-key', baseUrl: 'https://custom.example.com', model: 'override-model' });
  });
});

describe('renderImageRouterVideo', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderImageRouterVideo(baseCtx({ surface: 'video' }), {})).rejects.toThrow(/no ImageRouter API key/);
  });

  it('posts to the videos endpoint with an explicit seconds value', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.imagerouter.io/v1/openai/videos/generations');
      const body = JSON.parse(init.body as string);
      expect(body.seconds).toBe(5);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('vid').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderImageRouterVideo(baseCtx({ surface: 'video', length: 5 }), { apiKey: 'ir-key' });
    expect(result.suggestedExt).toBe('.mp4');
    expect(result.providerNote).toContain('5s');
  });

  it('sends seconds: "auto" when no length is supplied', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.seconds).toBe('auto');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('vid').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderImageRouterVideo(baseCtx({ surface: 'video' }), { apiKey: 'ir-key' });
    expect(result.providerNote).toContain('auto');
  });
});
