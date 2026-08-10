import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMinimaxTTS } from '../minimax.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'audio',
    model: 'minimax-tts',
    wireModel: 'minimax-tts',
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

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

describe('renderMinimaxTTS', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderMinimaxTTS(baseCtx(), {})).rejects.toThrow(/no MiniMax credential/);
  });

  it('posts to the default base URL with the mapped model id, default voice, and no language_boost when language is blank', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.minimaxi.chat/v1/t2a_v2');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('speech-02-turbo');
      expect(body.text).toBe('hello world');
      expect(body.voice_setting).toEqual({ voice_id: 'male-qn-qingse', speed: 1.0, vol: 1.0, pitch: 0 });
      expect(body.audio_setting).toEqual({ sample_rate: 32000, format: 'mp3' });
      expect(body.language_boost).toBeUndefined();
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer mm-test');
      return okResponse({ data: { audio: Buffer.from('audio-bytes').toString('hex') }, extra_info: { audio_length: 500 } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' });
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    // extra_info.audio_length is in centiseconds: Math.round(500/100)/10 == 0.5s.
    expect(result.providerNote).toBe('minimax/speech-02-turbo · male-qn-qingse · 0.5s · 11 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('includes language_boost when ctx.language is set', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.language_boost).toBe('en');
      return okResponse({ data: { audio: Buffer.from('x').toString('hex') } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderMinimaxTTS(baseCtx({ language: 'en' }), { apiKey: 'mm-test' });
  });

  it('falls back to the catalog id when the model is not in the legacy rename map and no alias is set', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe('some-custom-model');
      return okResponse({ data: { audio: Buffer.from('x').toString('hex') } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderMinimaxTTS(baseCtx({ model: 'some-custom-model', wireModel: 'some-custom-model' }), { apiKey: 'mm-test' });
  });

  it('prefers an explicit caller alias (wireModel != model) over the legacy rename map', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe('my-deployment-alias');
      return okResponse({ data: { audio: Buffer.from('x').toString('hex') } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderMinimaxTTS(baseCtx({ model: 'minimax-tts', wireModel: 'my-deployment-alias' }), { apiKey: 'mm-test' });
  });

  it('defaults the prompt to "This is a test." when blank/whitespace-only', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).text).toBe('This is a test.');
      return okResponse({ data: { audio: Buffer.from('x').toString('hex') } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderMinimaxTTS(baseCtx({ prompt: '   ' }), { apiKey: 'mm-test' });
  });

  it('honors a caller-supplied voice id and a baseUrl with its trailing slash stripped', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://custom.minimax.example.com/t2a_v2');
      expect(JSON.parse(init.body as string).voice_setting.voice_id).toBe('female-shaonv');
      return okResponse({ data: { audio: Buffer.from('x').toString('hex') } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderMinimaxTTS(baseCtx({ voice: 'female-shaonv' }), { apiKey: 'mm-test', baseUrl: 'https://custom.minimax.example.com/' });
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' })).rejects.toThrow(/^minimax tts 429: rate limited$/);
  });

  it('throws a clear error on a non-JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' })).rejects.toThrow(/minimax tts non-JSON/);
  });

  it('throws an api-error when base_resp.status_code is non-zero, using status_msg when present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } })));
    await expect(renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' })).rejects.toThrow(/minimax tts api error 1004: invalid api key/);
  });

  it('falls back to "unknown" when base_resp.status_code is non-zero but status_msg is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ base_resp: { status_code: 1002 } })));
    await expect(renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' })).rejects.toThrow(/minimax tts api error 1002: unknown/);
  });

  it('does not throw the api-error path when base_resp.status_code is 0', async () => {
    const fetchMock = vi.fn(async () => okResponse({ base_resp: { status_code: 0, status_msg: 'success' }, data: { audio: Buffer.from('x').toString('hex') } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' })).resolves.toBeDefined();
  });

  it('throws when data.audio is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ data: {} })));
    await expect(renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' })).rejects.toThrow(/response missing data\.audio/);
  });

  it('throws when the hex payload decodes to zero bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ data: { audio: 'zz' } })));
    await expect(renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' })).rejects.toThrow(/decoded zero bytes/);
  });

  it('reports "?" seconds when extra_info.audio_length is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ data: { audio: Buffer.from('x').toString('hex') } })));
    const result = await renderMinimaxTTS(baseCtx(), { apiKey: 'mm-test' });
    expect(result.providerNote).toContain('· ?s ·');
  });
});
