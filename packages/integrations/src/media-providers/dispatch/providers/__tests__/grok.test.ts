import { afterEach, describe, expect, it, vi } from 'vitest';
import { grokAspectFor, renderGrokImage, renderXAITTS } from '../grok.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'grok-imagine-image',
    wireModel: 'grok-imagine-image',
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

describe('grokAspectFor', () => {
  it('passes through every recognized aspect', () => {
    expect(grokAspectFor('1:1')).toBe('1:1');
    expect(grokAspectFor('16:9')).toBe('16:9');
    expect(grokAspectFor('9:16')).toBe('9:16');
    expect(grokAspectFor('4:3')).toBe('4:3');
    expect(grokAspectFor('3:4')).toBe('3:4');
  });

  it('defaults to 16:9 for an unrecognized or missing aspect', () => {
    expect(grokAspectFor(undefined)).toBe('16:9');
    expect(grokAspectFor('21:9')).toBe('16:9');
  });
});

describe('renderGrokImage', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderGrokImage(baseCtx(), {})).rejects.toThrow(/no xAI credential/);
  });

  it('posts to the default base URL and decodes a b64_json response', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.x.ai/v1/images/generations');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('grok-imagine-image');
      expect(body.aspect_ratio).toBe('16:9');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer xai-test');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img-bytes').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderGrokImage(baseCtx(), { apiKey: 'xai-test' });
    expect(result.bytes.toString('utf8')).toBe('img-bytes');
    expect(result.providerNote).toContain('grok/grok-imagine-image');
    expect(result.suggestedExt).toBe('.png');
  });

  it('honors a caller-supplied baseUrl (trailing slash stripped)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://custom.x.example.com/images/generations');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderGrokImage(baseCtx(), { apiKey: 'xai-test', baseUrl: 'https://custom.x.example.com/' });
  });

  it('fetches the bytes when the response returns a url instead of b64_json', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.x.ai/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/grok.jpg' }] }), { status: 200 });
      }
      if (url === 'https://cdn.example.com/grok.jpg') {
        return new Response(Buffer.from('remote-bytes'), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderGrokImage(baseCtx(), { apiKey: 'xai-test' });
    expect(result.bytes.toString('utf8')).toBe('remote-bytes');
  });

  it('surfaces a tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    await expect(renderGrokImage(baseCtx(), { apiKey: 'xai-test' })).rejects.toThrow(/grok image 400/);
  });
});

describe('renderXAITTS', () => {
  function ttsCtx(overrides: Partial<RenderContext> = {}): RenderContext {
    return baseCtx({ surface: 'audio', audioKind: 'speech', model: 'grok-tts', wireModel: 'grok-tts', prompt: 'hello there', ...overrides });
  }

  it('throws a clear error when no API key is configured', async () => {
    await expect(renderXAITTS(ttsCtx(), {})).rejects.toThrow(/no xAI credential/);
  });

  it('posts to /tts with default voice/language and returns the raw audio bytes', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.x.ai/v1/tts');
      const body = JSON.parse(init.body as string);
      expect(body.text).toBe('hello there');
      expect(body.voice_id).toBe('eve');
      expect(body.language).toBe('en');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer xai-test');
      return new Response(Buffer.from('audio-bytes'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderXAITTS(ttsCtx(), { apiKey: 'xai-test' });
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    expect(result.providerNote).toBe('xai/grok-tts · voice=eve · en · 11 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('defaults the prompt to "This is a test." when blank/whitespace-only', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.text).toBe('This is a test.');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderXAITTS(ttsCtx({ prompt: '   ' }), { apiKey: 'xai-test' });
  });

  it('honors a caller-supplied voice and language, and a baseUrl with its trailing slash stripped', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://custom.x.example.com/tts');
      const body = JSON.parse(init.body as string);
      expect(body.voice_id).toBe('vex');
      expect(body.language).toBe('fr');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderXAITTS(ttsCtx({ voice: 'vex', language: 'fr' }), { apiKey: 'xai-test', baseUrl: 'https://custom.x.example.com/' });
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(renderXAITTS(ttsCtx(), { apiKey: 'xai-test' })).rejects.toThrow(/^xai tts 429: rate limited$/);
  });

  it('throws when the response has zero bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(0), { status: 200 })));
    await expect(renderXAITTS(ttsCtx(), { apiKey: 'xai-test' })).rejects.toThrow(/zero bytes/);
  });
});
