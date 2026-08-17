import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderOpenAIImage, renderOpenAISpeech } from '../openai.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'gpt-image-2',
    wireModel: 'gpt-image-2',
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

describe('renderOpenAIImage', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderOpenAIImage(baseCtx(), {})).rejects.toThrow(/no OpenAI credential/);
  });

  it('posts to the standard OpenAI endpoint and decodes a b64_json response', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/images/generations');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-image-2');
      expect(body.prompt).toBe('a red bicycle');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderOpenAIImage(baseCtx(), { apiKey: 'sk-test' });
    expect(result.bytes.toString('utf8')).toBe('png-bytes');
    expect(result.suggestedExt).toBe('.png');
    expect(result.providerNote).toContain('openai/gpt-image-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches the bytes when the response returns a url instead of b64_json', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.openai.com/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/x.png' }] }), { status: 200 });
      }
      if (url === 'https://cdn.example.com/x.png') {
        return new Response(Buffer.from('remote-bytes'), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderOpenAIImage(baseCtx(), { apiKey: 'sk-test' });
    expect(result.bytes.toString('utf8')).toBe('remote-bytes');
  });

  it('applies dall-e-3 specific quality/response_format fields', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.quality).toBe('hd');
      expect(body.response_format).toBe('b64_json');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenAIImage(baseCtx({ model: 'dall-e-3', wireModel: 'dall-e-3' }), { apiKey: 'sk-test' });
  });

  it('applies "standard" quality for dall-e-2 (any dall-e-* model other than dall-e-3)', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.quality).toBe('standard');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenAIImage(baseCtx({ model: 'dall-e-2', wireModel: 'dall-e-2' }), { apiKey: 'sk-test' });
  });

  it('throws when the url-fetch fallback response is not ok', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.openai.com/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/x.png' }] }), { status: 200 });
      }
      return new Response('', { status: 502 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderOpenAIImage(baseCtx(), { apiKey: 'sk-test' })).rejects.toThrow(/openai image fetch 502/);
  });

  it('throws a clear error on a non-JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(renderOpenAIImage(baseCtx(), { apiKey: 'sk-test' })).rejects.toThrow(/openai non-JSON response/);
  });

  it('throws when data.data is not an array at all (not just empty)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: 'not-an-array' }), { status: 200 })));
    await expect(renderOpenAIImage(baseCtx(), { apiKey: 'sk-test' })).rejects.toThrow(/no data\[0\]/);
  });

  it('throws when the entry has neither b64_json nor url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{}] }), { status: 200 })));
    await expect(renderOpenAIImage(baseCtx(), { apiKey: 'sk-test' })).rejects.toThrow(/neither b64_json nor url/);
  });

  it('detects an Azure endpoint, appends api-version, sends api-key header, and omits model from the body', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('api-version=2024-02-01');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBeUndefined();
      expect((init.headers as Record<string, string>)['api-key']).toBe('azure-key');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenAIImage(baseCtx(), { apiKey: 'azure-key', baseUrl: 'https://x.openai.azure.com/openai/deployments/gpt-image-2' });
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request details', { status: 400 })));
    await expect(renderOpenAIImage(baseCtx(), { apiKey: 'sk-test' })).rejects.toThrow(/^openai 400: bad request details$/);
  });

  it('tags a non-OK response with azure-openai when the base URL is an azure deployment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('deployment not found', { status: 404 })));
    await expect(
      renderOpenAIImage(baseCtx(), { apiKey: 'azure-key', baseUrl: 'https://x.openai.azure.com/openai/deployments/gpt-image-2' }),
    ).rejects.toThrow(/^azure-openai 404: deployment not found$/);
  });

  it('throws when the response has no data[0]', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    await expect(renderOpenAIImage(baseCtx(), { apiKey: 'sk-test' })).rejects.toThrow(/no data\[0\]/);
  });
});

describe('renderOpenAISpeech', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderOpenAISpeech(baseCtx({ surface: 'audio', audioKind: 'speech' }), {})).rejects.toThrow(/no OpenAI credential/);
  });

  it('posts to /audio/speech and returns the raw audio bytes', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/audio/speech');
      const body = JSON.parse(init.body as string);
      expect(body.voice).toBe('alloy');
      expect(body.response_format).toBe('mp3');
      return new Response(Buffer.from('audio-bytes'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderOpenAISpeech(baseCtx({ surface: 'audio', audioKind: 'speech', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts' }), { apiKey: 'sk-test' });
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('treats a recognized voice id as the voice, not free-form instructions', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.voice).toBe('nova');
      expect(body.instructions).toBeUndefined();
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenAISpeech(baseCtx({ surface: 'audio', audioKind: 'speech', voice: 'nova', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts' }), { apiKey: 'sk-test' });
  });

  it('treats an unrecognized voice string as free-form instructions for gpt-4o-mini-tts', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.voice).toBe('alloy');
      expect(body.instructions).toBe('speak like a pirate');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderOpenAISpeech(
      baseCtx({ surface: 'audio', audioKind: 'speech', voice: 'speak like a pirate', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts' }),
      { apiKey: 'sk-test' },
    );
  });

  it('requests the wav format and returns a .wav suggestedExt when speechFormat is wav', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        expect(body.response_format).toBe('wav');
        return new Response(Buffer.from('x'), { status: 200 });
      }),
    );
    const result = await renderOpenAISpeech(baseCtx({ surface: 'audio', audioKind: 'speech', speechFormat: 'wav', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts' }), { apiKey: 'sk-test' });
    expect(result.suggestedExt).toBe('.wav');
  });

  it('maps opus format to a .ogg suggestedExt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('x'), { status: 200 })));
    const result = await renderOpenAISpeech(baseCtx({ surface: 'audio', audioKind: 'speech', speechFormat: 'opus' }), { apiKey: 'sk-test' });
    expect(result.suggestedExt).toBe('.ogg');
  });

  it('throws when the provider returns zero bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(0), { status: 200 })));
    await expect(renderOpenAISpeech(baseCtx({ surface: 'audio', audioKind: 'speech' }), { apiKey: 'sk-test' })).rejects.toThrow(/zero bytes/);
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(renderOpenAISpeech(baseCtx({ surface: 'audio', audioKind: 'speech' }), { apiKey: 'sk-test' })).rejects.toThrow(/^openai speech 429: rate limited$/);
  });

  it('tags a non-OK speech response with azure-openai when the base URL is an azure deployment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('deployment not found', { status: 404 })));
    await expect(
      renderOpenAISpeech(baseCtx({ surface: 'audio', audioKind: 'speech' }), { apiKey: 'azure-key', baseUrl: 'https://x.openai.azure.com/openai/deployments/tts' }),
    ).rejects.toThrow(/^azure-openai speech 404: deployment not found$/);
  });

  it('detects an Azure endpoint, sends the api-key header, and omits model from the body', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('api-version=2024-02-01');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBeUndefined();
      expect((init.headers as Record<string, string>)['api-key']).toBe('azure-key');
      return new Response(Buffer.from('audio-bytes'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderOpenAISpeech(
      baseCtx({ surface: 'audio', audioKind: 'speech' }),
      { apiKey: 'azure-key', baseUrl: 'https://x.openai.azure.com/openai/deployments/tts' },
    );
    expect(result.providerNote).toContain('azure-openai/');
  });
});
