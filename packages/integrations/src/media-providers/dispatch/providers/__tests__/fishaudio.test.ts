import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderFishAudioTTS } from '../fishaudio.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'audio',
    model: 'fish-speech-2',
    wireModel: 'fish-speech-2',
    prompt: 'hello world',
    aspect: undefined,
    length: undefined,
    duration: undefined,
    voice: '',
    audioKind: 'speech',
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

describe('renderFishAudioTTS', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderFishAudioTTS(baseCtx(), {})).rejects.toThrow(/no FishAudio credential/);
  });

  it('posts to the default base URL with the mapped model id and no reference_id when voice is blank', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.fish.audio/v1/tts');
      const body = JSON.parse(init.body as string);
      expect(body.text).toBe('hello world');
      expect(body.model).toBe('speech-1.6');
      expect(body.format).toBe('mp3');
      expect(body.mp3_bitrate).toBe(128);
      expect(body.normalize).toBe(true);
      expect(body.latency).toBe('normal');
      expect(body.reference_id).toBeUndefined();
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer fa-test');
      return new Response(Buffer.from('audio-bytes'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderFishAudioTTS(baseCtx(), { apiKey: 'fa-test' });
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    expect(result.providerNote).toBe('fishaudio/speech-1.6 · 11 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('falls back to the catalog id when the model is not in the rename map and no alias is set', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe('speech-1.5');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderFishAudioTTS(baseCtx({ model: 'speech-1.5', wireModel: 'speech-1.5' }), { apiKey: 'fa-test' });
  });

  it('prefers an explicit caller alias (wireModel != model) over the rename map', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe('my-deployment-alias');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderFishAudioTTS(baseCtx({ model: 'fish-speech-2', wireModel: 'my-deployment-alias' }), { apiKey: 'fa-test' });
  });

  it('defaults the prompt to "This is a test." when blank/whitespace-only', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).text).toBe('This is a test.');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderFishAudioTTS(baseCtx({ prompt: '   ' }), { apiKey: 'fa-test' });
  });

  it('sends reference_id when a voice is supplied, and a baseUrl with its trailing slash stripped', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://custom.fish.example.com/v1/tts');
      expect(JSON.parse(init.body as string).reference_id).toBe('voice-abc');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderFishAudioTTS(baseCtx({ voice: 'voice-abc' }), { apiKey: 'fa-test', baseUrl: 'https://custom.fish.example.com/' });
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(renderFishAudioTTS(baseCtx(), { apiKey: 'fa-test' })).rejects.toThrow(/^fishaudio tts 429: rate limited$/);
  });

  it('throws when the response has zero bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(0), { status: 200 })));
    await expect(renderFishAudioTTS(baseCtx(), { apiKey: 'fa-test' })).rejects.toThrow(/zero bytes/);
  });
});
