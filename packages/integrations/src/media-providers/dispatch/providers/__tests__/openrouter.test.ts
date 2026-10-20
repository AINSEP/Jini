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
        expect(openRouterAspectFor({ aspect: '1:1' })).toBe('1:1');
        expect(openRouterAspectFor({ aspect: '16:9' })).toBe('16:9');
        expect(openRouterAspectFor({ aspect: '9:16' })).toBe('9:16');
        expect(openRouterAspectFor({ aspect: '4:3' })).toBe('4:3');
        expect(openRouterAspectFor({ aspect: '3:4' })).toBe('3:4');
    });
    it('defaults to 16:9 for an unrecognized or missing aspect', () => {
        expect(openRouterAspectFor({ aspect: undefined })).toBe('16:9');
        expect(openRouterAspectFor({ aspect: '21:9' })).toBe('16:9');
    });
});

describe('renderOpenRouterImage', () => {
    it('throws a clear error when no API key is configured', async () => {
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: {} })).rejects.toThrow(/no OpenRouter API key/);
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
        const result = await renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } });
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
        await renderOpenRouterImage({ ctx: baseCtx({ model: 'openrouter/google/gemini-2.5-flash-image', wireModel: 'openrouter/google/gemini-2.5-flash-image' }), credentials: { apiKey: 'or-test' } });
    });
    it('honors credentials.model over ctx.wireModel', async () => {
        const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string);
            expect(body.model).toBe('override/model');
            return chatResponse([{ image_url: { url: dataUrl } }]);
        });
        vi.stubGlobal('fetch', fetchMock);
        await renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test', model: 'openrouter/override/model' } });
    });
    it('leaves a model slug without the openrouter/ prefix unchanged', async () => {
        const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string);
            expect(body.model).toBe('black-forest-labs/flux-1.1-pro');
            return chatResponse([{ image_url: { url: dataUrl } }]);
        });
        vi.stubGlobal('fetch', fetchMock);
        await renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test', model: 'black-forest-labs/flux-1.1-pro' } });
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
        const result = await renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } });
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
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/openrouter image download 404/);
    });
    it('treats a bare string as raw base64 when it has neither a data: prefix nor an http(s) scheme', async () => {
        const raw = Buffer.from('raw-bytes').toString('base64');
        vi.stubGlobal('fetch', vi.fn(async () => chatResponse([{ image_url: { url: raw } }])));
        const result = await renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } });
        expect(result.bytes.toString('utf8')).toBe('raw-bytes');
    });
    it('surfaces a tagged error on a non-OK response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/openrouter image 429/);
    });
    it('surfaces a tagged error on a non-JSON response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/non-JSON response/);
    });
    it('throws when the response contains no images', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => chatResponse(undefined)));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/contained no images/);
    });
    it('throws when the response has an empty images array', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => chatResponse([])));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/contained no images/);
    });
    it('throws when the first image is missing image_url.url', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => chatResponse([{ image_url: {} }])));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/missing image_url\.url/);
    });
});

describe('renderOpenRouterImage response parsing (pinned before refactor)', () => {
    const MODEL = 'black-forest-labs/flux-1.1-pro';
    function stubBody(body: string): ReturnType<typeof vi.fn> {
        const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }
    it('reports no images for a JSON null body', async () => {
        stubBody('null');
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(`openrouter image response contained no images for model ${MODEL}: null`);
    });
    it('reports no images for an empty choices array', async () => {
        stubBody('{"choices":[]}');
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(`openrouter image response contained no images for model ${MODEL}: {"choices":[]}`);
    });
    it('reports a missing url when the first image entry is null', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => chatResponse([null])));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow('openrouter image response missing image_url.url: {"choices":[{"message":{"images":[null]}}]}');
    });
    it('reports a missing url when image_url.url is not a string', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => chatResponse([{ image_url: { url: 42 } }])));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/^openrouter image response missing image_url\.url: /);
    });
    it('reports a missing url when image_url.url is an empty string', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => chatResponse([{ image_url: { url: '' } }])));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/^openrouter image response missing image_url\.url: /);
    });
    it('decodes a data:image base64 URI (including a multi-line payload) without a second fetch, sniffing the extension', async () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
        const b64 = png.toString('base64');
        const fetchMock = vi.fn(async () => chatResponse([{ image_url: { url: `data:image/png;base64,${b64.slice(0, 4)}\n${b64.slice(4)}` } }]));
        vi.stubGlobal('fetch', fetchMock);
        const result = await renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } });
        expect(result.bytes.equals(png)).toBe(true);
        expect(result.suggestedExt).toBe('.png');
        expect(result.providerNote).toBe(`openrouter/${MODEL} · 16:9 · 10 bytes`);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('treats a non-image data: URI as raw base64 of the whole string', async () => {
        const url = 'data:text/plain;base64,aGk=';
        vi.stubGlobal('fetch', vi.fn(async () => chatResponse([{ image_url: { url } }])));
        const result = await renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } });
        expect(result.bytes.equals(Buffer.from(url, 'base64'))).toBe(true);
    });
    it('downloads an http URL only through the SSRF guard, which refuses a private address', async () => {
        const fetchMock = vi.fn(async () => chatResponse([{ image_url: { url: 'http://10.0.0.5/x.png' } }]));
        vi.stubGlobal('fetch', fetchMock);
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/blocked download url/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('sends a non-URL string starting with "http" to the SSRF guard rather than decoding it as base64', async () => {
        const fetchMock = vi.fn(async () => chatResponse([{ image_url: { url: 'httpAAAA' } }]));
        vi.stubGlobal('fetch', fetchMock);
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/blocked download url/);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('truncates the body in the non-OK error to 240 chars', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(300), { status: 500 })));
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(`openrouter image 500: ${'x'.repeat(239)}…`);
    });
    it('quotes the truncated body in the non-JSON error', async () => {
        stubBody('<html>');
        await expect(renderOpenRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'or-test' } })).rejects.toThrow(/^openrouter image non-JSON response: <html>$/);
    });
});

vi.mock('@jini-ai/platform/http/guarded', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  const { testNodeGuardedHttpPorts } = await import('../../__tests__/outbound-fixtures.js');
  return { ...original, createNodeGuardedHttpPorts: testNodeGuardedHttpPorts };
});
