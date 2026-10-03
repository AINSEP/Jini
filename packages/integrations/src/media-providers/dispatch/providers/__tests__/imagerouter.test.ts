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
        expect(imageRouterSizeFor({ aspect: '16:9', surface: 'image' })).toBe('1024x576');
        expect(imageRouterSizeFor({ aspect: '9:16', surface: 'image' })).toBe('576x1024');
        expect(imageRouterSizeFor({ aspect: '4:3', surface: 'image' })).toBe('1024x768');
        expect(imageRouterSizeFor({ aspect: '3:4', surface: 'image' })).toBe('768x1024');
    });
    it('video: maps every recognized aspect', () => {
        expect(imageRouterSizeFor({ aspect: '1:1', surface: 'video' })).toBe('1024x1024');
        expect(imageRouterSizeFor({ aspect: '9:16', surface: 'video' })).toBe('576x1024');
        expect(imageRouterSizeFor({ aspect: '4:3', surface: 'video' })).toBe('1024x768');
        expect(imageRouterSizeFor({ aspect: '3:4', surface: 'video' })).toBe('768x1024');
    });
    it('defaults to square (image) / 1024x576 (video) when aspect is unrecognized', () => {
        expect(imageRouterSizeFor({ aspect: undefined, surface: 'image' })).toBe('1024x1024');
        expect(imageRouterSizeFor({ aspect: undefined, surface: 'video' })).toBe('1024x576');
    });
});

describe('renderImageRouterImage', () => {
    it('throws a clear error when no API key is configured', async () => {
        await expect(renderImageRouterImage({ ctx: baseCtx(), credentials: {} })).rejects.toThrow(/no ImageRouter API key/);
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
        const result = await renderImageRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'ir-key' } });
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
        await renderImageRouterImage({ ctx: baseCtx(), credentials: { apiKey: 'ir-key', baseUrl: 'https://custom.example.com', model: 'override-model' } });
    });
});

describe('renderImageRouterVideo', () => {
    it('throws a clear error when no API key is configured', async () => {
        await expect(renderImageRouterVideo({ ctx: baseCtx({ surface: 'video' }), credentials: {} })).rejects.toThrow(/no ImageRouter API key/);
    });
    it('posts to the videos endpoint with an explicit seconds value', async () => {
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            expect(url).toBe('https://api.imagerouter.io/v1/openai/videos/generations');
            const body = JSON.parse(init.body as string);
            expect(body.seconds).toBe(5);
            return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('vid').toString('base64') }] }), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await renderImageRouterVideo({ ctx: baseCtx({ surface: 'video', length: 5 }), credentials: { apiKey: 'ir-key' } });
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
        const result = await renderImageRouterVideo({ ctx: baseCtx({ surface: 'video' }), credentials: { apiKey: 'ir-key' } });
        expect(result.providerNote).toContain('auto');
    });
});

vi.mock('@jini-ai/platform/http/guarded', async (importOriginal) => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  const { testNodeGuardedHttpPorts } = await import('../../__tests__/outbound-fixtures.js');
  return { ...original, createNodeGuardedHttpPorts: testNodeGuardedHttpPorts };
});
