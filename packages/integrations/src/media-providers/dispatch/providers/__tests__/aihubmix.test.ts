import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAIHubMixImage, renderAIHubMixTTS } from '../aihubmix.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'aihubmix-gpt-image-1',
    wireModel: 'aihubmix-gpt-image-1',
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

describe('renderAIHubMixImage', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderAIHubMixImage(baseCtx(), {})).rejects.toThrow(/no AIHubMix credential/);
  });

  it('resolves the wire model from ctx.wireModel via the aihubmix- prefix map and posts to /images/generations', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://aihubmix.com/v1/images/generations');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-image-1');
      expect(body.quality).toBe('high');
      expect(body.response_format).toBeUndefined();
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer ahm-test');
      expect(headers['APP-Code']).toBe('DMCY9912');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img-bytes').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' });
    expect(result.bytes.toString('utf8')).toBe('img-bytes');
    expect(result.providerNote).toBe('aihubmix/gpt-image-1 · 1:1 · 9 bytes');
    expect(result.suggestedExt).toBe('.png');
  });

  it('prefers credentials.model over ctx.wireModel when resolving the wire model', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe('dall-e-3');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-dall-e-3' });
  });

  it('applies dall-e-3 quality/response_format fields', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.quality).toBe('hd');
      expect(body.response_format).toBe('b64_json');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-dall-e-3' });
  });

  it('applies "standard" quality for a dall-e-* model that is not dall-e-3', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).quality).toBe('standard');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    // Not in AIHUBMIX_WIRE_MODELS, so aihubmixWireModel falls back to a
    // plain aihubmix- prefix strip: dall-e-2.
    await renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-dall-e-2' });
  });

  it('fetches the bytes when the response returns a url instead of b64_json (through the SSRF guard)', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://aihubmix.com/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: 'http://203.0.113.7/x.png' }] }), { status: 200 });
      }
      if (url === 'http://203.0.113.7/x.png') {
        expect(init.redirect).toBe('error');
        return new Response(Buffer.from('remote-bytes'), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' });
    expect(result.bytes.toString('utf8')).toBe('remote-bytes');
  });

  it('rejects an SSRF-blocked download url without ever fetching it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ url: 'http://192.168.1.1/x.png' }] }), { status: 200 })));
    await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/blocked download url/);
  });

  it('throws when the url-fetch fallback response is not ok', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://aihubmix.com/v1/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: 'http://203.0.113.7/x.png' }] }), { status: 200 });
      }
      return new Response('', { status: 502 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/aihubmix image fetch 502/);
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/^aihubmix 400: bad request$/);
  });

  it('throws a clear error on a non-JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/aihubmix non-JSON response/);
  });

  it('throws when data.data is not an array at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: 'nope' }), { status: 200 })));
    await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/no data\[0\]/);
  });

  it('throws when the response has no data[0]', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/no data\[0\]/);
  });

  it('throws when the entry has neither b64_json nor url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{}] }), { status: 200 })));
    await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/neither b64_json nor url/);
  });

  describe('gemini-family models', () => {
    it('redirects to the Gemini-native path and posts x-goog-api-key + APP-Code headers', async () => {
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image-preview:generateContent');
        const headers = init.headers as Record<string, string>;
        expect(headers['x-goog-api-key']).toBe('ahm-test');
        expect(headers['APP-Code']).toBe('DMCY9912');
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('gemini-bytes').toString('base64') } }] } }] }),
          { status: 200 },
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      const result = await renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' });
      expect(result.bytes.toString('utf8')).toBe('gemini-bytes');
      expect(result.providerNote).toBe('aihubmix/gemini-3-pro-image-preview · 1:1 · 12 bytes (gemini-native)');
      expect(result.suggestedExt).toBe('.png');
    });

    it('defaults the aspect to 1:1 when ctx.aspect is falsy', async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        expect(JSON.parse(init.body as string).generationConfig.imageConfig.aspectRatio).toBe('1:1');
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('x').toString('base64') } }] } }] }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      await renderAIHubMixImage(baseCtx({ aspect: undefined }), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' });
    });

    it('defaults the prompt to a placeholder when blank/whitespace-only', async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        expect(body.contents[0].parts[0].text).toBe('A high-quality reference image.');
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('x').toString('base64') } }] } }] }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      await renderAIHubMixImage(baseCtx({ prompt: '' }), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' });
    });

    it('throws a truncated, tagged error on a non-OK response', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
      await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' })).rejects.toThrow(
        /^aihubmix image \(gemini\) 400: bad request$/,
      );
    });

    it('falls back to an empty error body when reading the non-OK response text itself fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 500, text: () => Promise.reject(new Error('stream closed')) }) as unknown as Response),
      );
      await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' })).rejects.toThrow(
        /^aihubmix image \(gemini\) 500: $/,
      );
    });

    it('throws when the response has no inline image data anywhere', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }), { status: 200 })));
      await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' })).rejects.toThrow(
        /had no inline image data/,
      );
    });

    it('throws when candidates is entirely absent', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
      await expect(renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' })).rejects.toThrow(
        /had no inline image data/,
      );
    });

    it('decodes the snake_case inline_data field when that is what the response uses', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inline_data: { data: Buffer.from('snake').toString('base64') } }] } }] }), { status: 200 })),
      );
      const result = await renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' });
      expect(result.bytes.toString('utf8')).toBe('snake');
    });

    it('finds inline data in a later part when an earlier part has none', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                candidates: [{ content: { parts: [{ text: 'no image here' }, { inlineData: { data: Buffer.from('later').toString('base64') } }] } }],
              }),
              { status: 200 },
            ),
        ),
      );
      const result = await renderAIHubMixImage(baseCtx(), { apiKey: 'ahm-test', model: 'aihubmix-gemini-3-pro-image-preview' });
      expect(result.bytes.toString('utf8')).toBe('later');
    });
  });
});

describe('renderAIHubMixTTS', () => {
  function ttsCtx(overrides: Partial<RenderContext> = {}): RenderContext {
    return baseCtx({ surface: 'audio', audioKind: 'speech', model: 'aihubmix-tts-1', wireModel: 'aihubmix-tts-1', prompt: 'hello there', ...overrides });
  }

  it('throws a clear error when no API key is configured', async () => {
    await expect(renderAIHubMixTTS(ttsCtx(), {})).rejects.toThrow(/no AIHubMix credential/);
  });

  it('posts to /audio/speech with the mapped model id and default voice', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://aihubmix.com/v1/audio/speech');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('tts-1');
      expect(body.input).toBe('hello there');
      expect(body.voice).toBe('alloy');
      expect(body.response_format).toBe('mp3');
      const headers = init.headers as Record<string, string>;
      expect(headers['APP-Code']).toBe('DMCY9912');
      return new Response(Buffer.from('audio-bytes'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderAIHubMixTTS(ttsCtx(), { apiKey: 'ahm-test' });
    expect(result.bytes.toString('utf8')).toBe('audio-bytes');
    expect(result.providerNote).toBe('aihubmix/tts-1 · alloy · mp3 · 11 bytes');
    expect(result.suggestedExt).toBe('.mp3');
  });

  it('uses a recognized requested voice id verbatim', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).voice).toBe('nova');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderAIHubMixTTS(ttsCtx({ voice: 'nova' }), { apiKey: 'ahm-test' });
  });

  it('falls back to "alloy" for an unrecognized voice id', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).voice).toBe('alloy');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderAIHubMixTTS(ttsCtx({ voice: 'not-a-real-voice' }), { apiKey: 'ahm-test' });
  });

  it('prefers credentials.model over ctx.wireModel', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).model).toBe('my-custom-tts-deployment');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderAIHubMixTTS(ttsCtx(), { apiKey: 'ahm-test', model: 'my-custom-tts-deployment' });
  });

  it('defaults the prompt to "This is a test." when blank/whitespace-only', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).input).toBe('This is a test.');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderAIHubMixTTS(ttsCtx({ prompt: '   ' }), { apiKey: 'ahm-test' });
  });

  it('requests the wav format and returns a .wav suggestedExt when speechFormat is wav', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).response_format).toBe('wav');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderAIHubMixTTS(ttsCtx({ speechFormat: 'wav' }), { apiKey: 'ahm-test' });
    expect(result.suggestedExt).toBe('.wav');
  });

  it('maps opus format to a .ogg suggestedExt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('x'), { status: 200 })));
    const result = await renderAIHubMixTTS(ttsCtx({ speechFormat: 'opus' }), { apiKey: 'ahm-test' });
    expect(result.suggestedExt).toBe('.ogg');
  });

  it('honors a caller-supplied baseUrl', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://custom.aihubmix.example.com/audio/speech');
      return new Response(Buffer.from('x'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderAIHubMixTTS(ttsCtx(), { apiKey: 'ahm-test', baseUrl: 'https://custom.aihubmix.example.com' });
  });

  it('throws a truncated, tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(renderAIHubMixTTS(ttsCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/^aihubmix speech 429: rate limited$/);
  });

  it('throws when the response has zero bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(0), { status: 200 })));
    await expect(renderAIHubMixTTS(ttsCtx(), { apiKey: 'ahm-test' })).rejects.toThrow(/zero bytes/);
  });
});
