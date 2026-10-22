import { createNodeMediaHttpClient } from '../../node.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderOpenAIImage, renderOpenAISpeech } from '../openai.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    httpClient: createNodeMediaHttpClient({}),
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
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: {} })).rejects.toThrow(/no OpenAI credential/);
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
        const result = await renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'sk-test' } });
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
        const result = await renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'sk-test' } });
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
        await renderOpenAIImage({ ctx: baseCtx({ model: 'dall-e-3', wireModel: 'dall-e-3' }), credentials: { apiKey: 'sk-test' } });
    });
    it('applies "standard" quality for dall-e-2 (any dall-e-* model other than dall-e-3)', async () => {
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string);
            expect(body.quality).toBe('standard');
            return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        await renderOpenAIImage({ ctx: baseCtx({ model: 'dall-e-2', wireModel: 'dall-e-2' }), credentials: { apiKey: 'sk-test' } });
    });
    it('throws when the url-fetch fallback response is not ok', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (url === 'https://api.openai.com/v1/images/generations') {
                return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/x.png' }] }), { status: 200 });
            }
            return new Response('', { status: 502 });
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'sk-test' } })).rejects.toThrow(/openai image fetch 502/);
    });
    it('throws a clear error on a non-JSON response body', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'sk-test' } })).rejects.toThrow(/openai non-JSON response/);
    });
    it('throws when data.data is not an array at all (not just empty)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: 'not-an-array' }), { status: 200 })));
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'sk-test' } })).rejects.toThrow(/no data\[0\]/);
    });
    it('throws when the entry has neither b64_json nor url', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{}] }), { status: 200 })));
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'sk-test' } })).rejects.toThrow(/neither b64_json nor url/);
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
        await renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'azure-key', baseUrl: 'https://x.openai.azure.com/openai/deployments/gpt-image-2' } });
    });
    it('throws a truncated, tagged error on a non-OK response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request details', { status: 400 })));
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'sk-test' } })).rejects.toThrow(/^openai 400: bad request details$/);
    });
    it('tags a non-OK response with azure-openai when the base URL is an azure deployment', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('deployment not found', { status: 404 })));
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'azure-key', baseUrl: 'https://x.openai.azure.com/openai/deployments/gpt-image-2' } })).rejects.toThrow(/^azure-openai 404: deployment not found$/);
    });
    it('throws when the response has no data[0]', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'sk-test' } })).rejects.toThrow(/no data\[0\]/);
    });
});

describe('renderOpenAISpeech', () => {
    it('throws a clear error when no API key is configured', async () => {
        await expect(renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech' }), credentials: {} })).rejects.toThrow(/no OpenAI credential/);
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
        const result = await renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts' }), credentials: { apiKey: 'sk-test' } });
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
        await renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech', voice: 'nova', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts' }), credentials: { apiKey: 'sk-test' } });
    });
    it('treats an unrecognized voice string as free-form instructions for gpt-4o-mini-tts', async () => {
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string);
            expect(body.voice).toBe('alloy');
            expect(body.instructions).toBe('speak like a pirate');
            return new Response(Buffer.from('x'), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        await renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech', voice: 'speak like a pirate', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts' }), credentials: { apiKey: 'sk-test' } });
    });
    it('requests the wav format and returns a .wav suggestedExt when speechFormat is wav', async () => {
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string);
            expect(body.response_format).toBe('wav');
            return new Response(Buffer.from('x'), { status: 200 });
        }));
        const result = await renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech', speechFormat: 'wav', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts' }), credentials: { apiKey: 'sk-test' } });
        expect(result.suggestedExt).toBe('.wav');
    });
    it('maps opus format to a .ogg suggestedExt', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('x'), { status: 200 })));
        const result = await renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech', speechFormat: 'opus' }), credentials: { apiKey: 'sk-test' } });
        expect(result.suggestedExt).toBe('.ogg');
    });
    it('throws when the provider returns zero bytes', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(0), { status: 200 })));
        await expect(renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech' }), credentials: { apiKey: 'sk-test' } })).rejects.toThrow(/zero bytes/);
    });
    it('throws a truncated, tagged error on a non-OK response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
        await expect(renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech' }), credentials: { apiKey: 'sk-test' } })).rejects.toThrow(/^openai speech 429: rate limited$/);
    });
    it('tags a non-OK speech response with azure-openai when the base URL is an azure deployment', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('deployment not found', { status: 404 })));
        await expect(renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech' }), credentials: { apiKey: 'azure-key', baseUrl: 'https://x.openai.azure.com/openai/deployments/tts' } })).rejects.toThrow(/^azure-openai speech 404: deployment not found$/);
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
        const result = await renderOpenAISpeech({ ctx: baseCtx({ surface: 'audio', audioKind: 'speech' }), credentials: { apiKey: 'azure-key', baseUrl: 'https://x.openai.azure.com/openai/deployments/tts' } });
        expect(result.providerNote).toContain('azure-openai/');
    });
});

describe('renderOpenAISpeech request shape (pinned before refactor)', () => {
    function speechCtx(overrides: Partial<RenderContext> = {}): RenderContext {
        return baseCtx({ surface: 'audio', audioKind: 'speech', model: 'gpt-4o-mini-tts', wireModel: 'gpt-4o-mini-tts', ...overrides });
    }
    function captureSpeech(): { calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> } {
        const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> });
            return new Response(Buffer.from('abc'), { status: 200 });
        }));
        return { calls };
    }
    it('sends the trimmed prompt as input', async () => {
        const { calls } = captureSpeech();
        await renderOpenAISpeech({ ctx: speechCtx({ prompt: '  hello there  ' }), credentials: { apiKey: 'k1' } });
        expect(calls[0]!.body.input).toBe('hello there');
    });
    it('defaults the input to "This is a test." when the prompt is whitespace-only', async () => {
        const { calls } = captureSpeech();
        await renderOpenAISpeech({ ctx: speechCtx({ prompt: '   ' }), credentials: { apiKey: 'k1' } });
        expect(calls[0]!.body.input).toBe('This is a test.');
    });
    it('treats a whitespace-only voice as no voice: alloy, no instructions, no "styled" note', async () => {
        const { calls } = captureSpeech();
        const result = await renderOpenAISpeech({ ctx: speechCtx({ voice: '   ' }), credentials: { apiKey: 'k1' } });
        expect(calls[0]!.body.voice).toBe('alloy');
        expect(calls[0]!.body).not.toHaveProperty('instructions');
        expect(result.providerNote).toBe('openai/gpt-4o-mini-tts · alloy · mp3 · 3 bytes');
    });
    it('trims a recognized voice id before matching it', async () => {
        const { calls } = captureSpeech();
        await renderOpenAISpeech({ ctx: speechCtx({ voice: ' nova ' }), credentials: { apiKey: 'k1' } });
        expect(calls[0]!.body.voice).toBe('nova');
    });
    it('marks the providerNote "styled" when free-form instructions are sent', async () => {
        captureSpeech();
        const result = await renderOpenAISpeech({ ctx: speechCtx({ voice: 'whisper softly' }), credentials: { apiKey: 'k1' } });
        expect(result.providerNote).toBe('openai/gpt-4o-mini-tts · alloy · styled · mp3 · 3 bytes');
    });
    it('drops free-form instructions from the body for a model other than gpt-4o-mini-tts but still notes "styled" (reported, not fixed)', async () => {
        const { calls } = captureSpeech();
        const result = await renderOpenAISpeech({ ctx: speechCtx({ voice: 'whisper softly', model: 'tts-1', wireModel: 'tts-1' }), credentials: { apiKey: 'k1' } });
        expect(calls[0]!.body).not.toHaveProperty('instructions');
        expect(result.providerNote).toBe('openai/tts-1 · alloy · styled · mp3 · 3 bytes');
    });
    it('sends the wire model (not the catalog id) on a non-Azure body, with Bearer auth and no api-key header', async () => {
        const { calls } = captureSpeech();
        await renderOpenAISpeech({ ctx: speechCtx({ wireModel: 'my-alias' }), credentials: { apiKey: 'k1' } });
        expect(calls[0]!.body.model).toBe('my-alias');
        expect(calls[0]!.headers).toEqual({ authorization: 'Bearer k1', 'content-type': 'application/json', 'User-Agent': 'media-provider' });
    });
    it('sends both Bearer and api-key headers to an Azure endpoint', async () => {
        const { calls } = captureSpeech();
        await renderOpenAISpeech({ ctx: speechCtx(), credentials: { apiKey: 'k1', baseUrl: 'https://x.openai.azure.com/openai/deployments/tts' } });
        expect(calls[0]!.headers).toEqual({ authorization: 'Bearer k1', 'content-type': 'application/json', 'api-key': 'k1', 'User-Agent': 'media-provider' });
    });
});

describe('renderOpenAIImage request/response shape (pinned before refactor)', () => {
    it('sends Bearer auth without an api-key header and the full gpt-image body on the standard endpoint', async () => {
        let seen: { body: Record<string, unknown>; headers: Record<string, string> } | undefined;
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
            seen = { body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> };
            return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('ab').toString('base64') }] }), { status: 200 });
        }));
        const result = await renderOpenAIImage({ ctx: baseCtx({ prompt: '', aspect: '1:1' }), credentials: { apiKey: 'k1' } });
        expect(seen!.headers).toEqual({ authorization: 'Bearer k1', 'content-type': 'application/json', 'User-Agent': 'media-provider' });
        expect(seen!.body).toEqual({ prompt: 'A high-quality reference image.', n: 1, size: '1024x1024', model: 'gpt-image-2', quality: 'high' });
        expect(result.providerNote).toBe('openai/gpt-image-2 · 1:1 · 2 bytes');
    });
    it('throws a TypeError on a JSON null body instead of a tagged error (reported, not fixed)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })));
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'k1' } })).rejects.toThrow(TypeError);
    });
    it('keeps the non-JSON error untagged even for an Azure endpoint', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 200 })));
        await expect(renderOpenAIImage({ ctx: baseCtx(), credentials: { apiKey: 'k1', baseUrl: 'https://x.openai.azure.com/openai/deployments/img' } })).rejects.toThrow(/^openai non-JSON response: oops$/);
    });
});

vi.mock('@jini-ai/platform/http/guarded', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  const { testNodeGuardedHttpPorts } = await import('../../__tests__/outbound-fixtures.js');
  return { ...original, createNodeGuardedHttpPorts: testNodeGuardedHttpPorts };
});
