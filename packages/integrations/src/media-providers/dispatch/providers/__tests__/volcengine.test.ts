import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderVolcengineImage } from '../volcengine.js';
import type { RenderContext } from '../../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'doubao-seedream-3-0-t2i-250415',
    wireModel: 'doubao-seedream-3-0-t2i-250415',
    prompt: 'a mountain lake at dawn',
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

describe('renderVolcengineImage', () => {
  it('throws a clear error when no API key is configured', async () => {
    await expect(renderVolcengineImage(baseCtx(), {})).rejects.toThrow(/no Volcengine Ark credential/);
  });

  it('posts to the default base URL with a b64_json response_format request and decodes the response', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('doubao-seedream-3-0-t2i-250415');
      expect(body.prompt).toBe('a mountain lake at dawn');
      expect(body.response_format).toBe('b64_json');
      // openaiSizeFor only special-cases gpt-image-*/dall-e-3 catalog ids;
      // a Volcengine catalog id falls through to the default 1024x1024
      // regardless of the requested aspect — a genuine origin quirk, not a
      // test bug (see the module doc comment).
      expect(body.size).toBe('1024x1024');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer ark-test');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img-bytes').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderVolcengineImage(baseCtx(), { apiKey: 'ark-test' });
    expect(result.bytes.toString('utf8')).toBe('img-bytes');
    expect(result.providerNote).toBe('volcengine/doubao-seedream-3-0-t2i-250415 · 16:9 · 9 bytes');
    // Unlike grok.ts, this is hardcoded to .png (never sniffed) — matching
    // the origin exactly (Seedream/Seededit are documented to always
    // return PNG bytes).
    expect(result.suggestedExt).toBe('.png');
  });

  it('honors a caller-supplied baseUrl (trailing slash stripped)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://custom.ark.example.com/images/generations');
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderVolcengineImage(baseCtx(), { apiKey: 'ark-test', baseUrl: 'https://custom.ark.example.com/' });
  });

  it('fetches the bytes when the response returns a url instead of b64_json (plain fetch, no SSRF guard — matches the origin)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://ark.cn-beijing.volces.com/api/v3/images/generations') {
        return new Response(JSON.stringify({ data: [{ url: 'http://169.254.169.254/latest/meta-data/' }] }), { status: 200 });
      }
      if (url === 'http://169.254.169.254/latest/meta-data/') {
        return new Response(Buffer.from('remote-bytes'), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await renderVolcengineImage(baseCtx(), { apiKey: 'ark-test' });
    expect(result.bytes.toString('utf8')).toBe('remote-bytes');
  });

  it('surfaces a tagged error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    await expect(renderVolcengineImage(baseCtx(), { apiKey: 'ark-test' })).rejects.toThrow(/volcengine image 400/);
  });
});
