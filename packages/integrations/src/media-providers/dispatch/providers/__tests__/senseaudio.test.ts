import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSenseAudioImage, renderSenseAudioTTS } from '../senseaudio.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'audio',
    model: 'senseaudio-tts',
    wireModel: 'senseaudio-tts',
    prompt: 'hello world',
    aspect: '1:1',
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

describe('renderSenseAudioTTS', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderSenseAudioTTS(baseCtx(), {})).rejects.toThrow(/no SenseAudio credential/);
  });

  it('posts to the default base URL with the mapped model id and default voice', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.senseaudio.cn/v1/t2a_v2');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('senseaudio-tts-1.5-260319');
      expect(body.text).toBe('hello world');
      expect(body.voice_setting).toEqual({ voice_id: 'female_0033_b', speed: 1, vol: 1, pitch: 0 });
      expect(body.audio_setting).toEqual({ format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 2 });
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer sa-test');
      return okResponse({ data: { audio: Buffer.from('audio-bytes').toString('hex') }, extra_info: { audio_length: 500 } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' });
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    expect(result.providerNote).toBe('senseaudio/senseaudio-tts-1.5-260319 · female_0033_b · 0.5s · 11 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('passes an unmapped model id through unchanged', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe('some-custom-model');
      return okResponse({ data: { audio: Buffer.from('x').toString('hex') } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderSenseAudioTTS(baseCtx({ model: 'some-custom-model' }), { apiKey: 'sa-test' });
  });

  it('defaults the prompt to "This is a test." when blank/whitespace-only', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).text).toBe('This is a test.');
      return okResponse({ data: { audio: Buffer.from('x').toString('hex') } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderSenseAudioTTS(baseCtx({ prompt: '  ' }), { apiKey: 'sa-test' });
  });

  it('honors a caller-supplied voice id and a baseUrl with its trailing slash stripped', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://custom.senseaudio.example.com/v1/t2a_v2');
      expect(JSON.parse(init.body as string).voice_setting.voice_id).toBe('male_0012_a');
      return okResponse({ data: { audio: Buffer.from('x').toString('hex') } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderSenseAudioTTS(baseCtx({ voice: 'male_0012_a' }), { apiKey: 'sa-test', baseUrl: 'https://custom.senseaudio.example.com/' });
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/^senseaudio tts 429: rate limited$/);
  });

  it('throws a clear error on a non-JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/senseaudio tts non-JSON/);
  });

  it('throws an api-error when base_resp.status_code is non-zero, using status_msg when present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ base_resp: { status_code: 2013, status_msg: 'voice not on this account' } })));
    await expect(renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/senseaudio tts api error 2013: voice not on this account/);
  });

  it('falls back to "unknown" when base_resp.status_code is non-zero but status_msg is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ base_resp: { status_code: 1002 } })));
    await expect(renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/senseaudio tts api error 1002: unknown/);
  });

  it('does not throw the api-error path when base_resp.status_code is 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ base_resp: { status_code: 0 }, data: { audio: Buffer.from('x').toString('hex') } })));
    await expect(renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' })).resolves.toBeDefined();
  });

  it('throws when data.audio is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ data: {} })));
    await expect(renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/response missing data\.audio/);
  });

  it('throws when the hex payload decodes to zero bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ data: { audio: 'zz' } })));
    await expect(renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/decoded zero bytes/);
  });

  it('reports "?" seconds when extra_info.audio_length is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ data: { audio: Buffer.from('x').toString('hex') } })));
    const result = await renderSenseAudioTTS(baseCtx(), { apiKey: 'sa-test' });
    expect(result.providerNote).toContain('· ?s ·');
  });
});

describe('renderSenseAudioImage', () => {
  function imageCtx(overrides: Partial<RenderContext> = {}): RenderContext {
    return baseCtx({ surface: 'image', audioKind: undefined, model: 'senseaudio-image-2.0-260319', wireModel: 'senseaudio-image-2.0-260319', prompt: 'a red bicycle', ...overrides });
  }

  it('throws a clear error when no API key is configured', async () => {
    await expect(renderSenseAudioImage(imageCtx(), {})).rejects.toThrow(/no SenseAudio credential/);
  });

  it('posts to /v1/image/sync and downloads a public asset URL through the SSRF guard', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe('senseaudio-image-2.0-260319');
        expect(body.prompt).toBe('a red bicycle');
        expect(body.size).toBe('1024x1024');
        expect(body.reference).toBeUndefined();
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer sa-test');
        return okResponse({ url: 'http://203.0.113.5/out.png' });
      }
      if (url === 'http://203.0.113.5/out.png') {
        expect(init.redirect).toBe('error');
        return new Response(Buffer.from('img-bytes'), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' });
    expect(result.bytes.toString('utf8')).toBe('img-bytes');
    expect(result.providerNote).toBe('senseaudio/senseaudio-image-2.0-260319 · 1024x1024 · 9 bytes');
    expect(result.suggestedExt).toBe('.png');
  });

  it.each([
    ['16:9', '1280x720'],
    ['9:16', '720x1280'],
    ['4:3', '1024x768'],
    ['3:4', '768x1024'],
    [undefined, '1024x1024'],
  ] as const)('maps aspect %s to size %s', async (aspect, expectedSize) => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        expect(JSON.parse(init.body as string).size).toBe(expectedSize);
        return okResponse({ url: 'http://203.0.113.5/out.png' });
      }
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderSenseAudioImage(imageCtx({ aspect }), { apiKey: 'sa-test' });
  });

  it('defaults the prompt to a placeholder when blank/whitespace-only', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        expect(JSON.parse(init.body as string).prompt).toBe('A high-quality reference image.');
        return okResponse({ url: 'http://203.0.113.5/out.png' });
      }
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderSenseAudioImage(imageCtx({ prompt: '   ' }), { apiKey: 'sa-test' });
  });

  it('truncates a prompt over 2000 characters', async () => {
    const longPrompt = 'x'.repeat(2500);
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        expect(JSON.parse(init.body as string).prompt).toHaveLength(2000);
        return okResponse({ url: 'http://203.0.113.5/out.png' });
      }
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderSenseAudioImage(imageCtx({ prompt: longPrompt }), { apiKey: 'sa-test' });
  });

  it('sends a reference image and appends the i2i marker to providerNote', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        expect(JSON.parse(init.body as string).reference).toBe('data:image/png;base64,REF');
        return okResponse({ url: 'http://203.0.113.5/out.png' });
      }
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderSenseAudioImage(imageCtx({ imageRef: { dataUrl: 'data:image/png;base64,REF' } }), { apiKey: 'sa-test' });
    expect(result.providerNote).toContain('· i2i');
  });

  it('honors a baseUrl with its trailing slash stripped', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://custom.senseaudio.example.com/v1/image/sync') {
        return okResponse({ url: 'http://203.0.113.5/out.png' });
      }
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test', baseUrl: 'https://custom.senseaudio.example.com/' });
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/^senseaudio image 400: bad request$/);
  });

  it('throws a clear error on a non-JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/senseaudio image non-JSON/);
  });

  it('throws an api-error when base_resp.status_code is non-zero, using status_msg when present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ base_resp: { status_code: 3001, status_msg: 'quota exceeded' } })));
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/senseaudio image api error 3001: quota exceeded/);
  });

  it('falls back to "unknown" when base_resp.status_code is non-zero but status_msg is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ base_resp: { status_code: 3002 } })));
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/senseaudio image api error 3002: unknown/);
  });

  it('throws error_message when present, even without a base_resp failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ base_resp: { status_code: 0 }, error_message: '参数错误：size' })));
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/senseaudio image api error: 参数错误：size/);
  });

  it('throws when the url field is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({})));
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/response missing url/);
  });

  it('rejects a blocked (SSRF-guarded) download url without ever fetching it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        return okResponse({ url: 'http://10.0.0.5/out.png' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/blocked download url/);
  });

  it('throws when the download response is not ok', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        return okResponse({ url: 'http://203.0.113.5/out.png' });
      }
      return new Response('', { status: 502 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/senseaudio image fetch 502/);
  });

  it('throws when the downloaded image has zero bytes', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.senseaudio.cn/v1/image/sync') {
        return okResponse({ url: 'http://203.0.113.5/out.png' });
      }
      return new Response(Buffer.alloc(0), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderSenseAudioImage(imageCtx(), { apiKey: 'sa-test' })).rejects.toThrow(/returned zero bytes/);
  });
});
