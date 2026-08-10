import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bytesFromOpenAICompatibleData,
  buildOpenAICompatibleGenerationUrl,
  buildOpenAIImageEditUrl,
  buildOpenAIImageUrl,
  buildOpenAISpeechUrl,
  buildOpenAIVideoUrl,
  detectAzureEndpoint,
  normalizeOpenAICompatiblePath,
  openaiSizeFor,
  parseOpenAICompatibleJson,
  resolveSpeechFormat,
  sniffImageExt,
  truncate,
  withRequestInit,
} from '../openai-compatible.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('truncate', () => {
  it('returns the string unchanged when within the limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and appends an ellipsis when over the limit', () => {
    expect(truncate('hello world', 5)).toBe('hell…');
  });

  it('coerces non-string/nullish input to a string', () => {
    expect(truncate(undefined, 10)).toBe('');
    expect(truncate(123, 10)).toBe('123');
  });
});

describe('withRequestInit', () => {
  it('merges ctx.requestInit under an explicit init, with init winning on overlap', () => {
    const dispatcher = {} as NonNullable<RequestInit['dispatcher']>;
    const merged = withRequestInit({ requestInit: { dispatcher } }, { method: 'POST' });
    expect(merged).toEqual({ dispatcher, method: 'POST' });
  });

  it('defaults to ctx.requestInit alone when no explicit init is given', () => {
    const dispatcher = {} as NonNullable<RequestInit['dispatcher']>;
    expect(withRequestInit({ requestInit: { dispatcher } })).toEqual({ dispatcher });
  });
});

describe('sniffImageExt', () => {
  it('detects jpeg magic bytes', () => {
    expect(sniffImageExt(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('.jpg');
  });

  it('detects png magic bytes', () => {
    expect(sniffImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe('.png');
  });

  it('detects webp (RIFF....WEBP)', () => {
    const bytes = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')]);
    expect(sniffImageExt(bytes)).toBe('.webp');
  });

  it('defaults to png for unrecognized bytes', () => {
    expect(sniffImageExt(Buffer.from([1, 2, 3]))).toBe('.png');
  });
});

describe('resolveSpeechFormat', () => {
  it('defaults to mp3 when undefined', () => {
    expect(resolveSpeechFormat(undefined)).toBe('mp3');
  });

  it('passes through a recognized format', () => {
    expect(resolveSpeechFormat('wav')).toBe('wav');
    expect(resolveSpeechFormat('opus')).toBe('opus');
  });
});

describe('detectAzureEndpoint', () => {
  it('detects *.azure.com hosts', () => {
    expect(detectAzureEndpoint('https://x.cognitiveservices.azure.com/openai/deployments/gpt-image-2')).toBe(true);
    expect(detectAzureEndpoint('https://x.openai.azure.com/openai/deployments/foo')).toBe(true);
  });

  it('detects /openai/deployments/ path segments regardless of host', () => {
    expect(detectAzureEndpoint('/openai/deployments/foo?api-version=2024-02-01')).toBe(true);
  });

  it('returns false for the standard OpenAI endpoint and local URLs', () => {
    expect(detectAzureEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(detectAzureEndpoint('http://localhost:8080/v1')).toBe(false);
  });

  it('returns false for non-string/empty input', () => {
    expect(detectAzureEndpoint('')).toBe(false);
    expect(detectAzureEndpoint(undefined as unknown as string)).toBe(false);
  });
});

describe('normalizeOpenAICompatiblePath', () => {
  it('appends /images/generations when the path has no suffix', () => {
    expect(normalizeOpenAICompatiblePath('/v1', 'images', 'generations')).toBe('/v1/images/generations');
  });

  it('rewrites /images/generations -> /images/edits when mode is edits', () => {
    expect(normalizeOpenAICompatiblePath('/v1/images/generations', 'images', 'edits')).toBe('/v1/images/edits');
  });

  it('rewrites /images/edits -> /images/generations when mode is generations', () => {
    expect(normalizeOpenAICompatiblePath('/v1/images/edits', 'images', 'generations')).toBe('/v1/images/generations');
  });

  it('is idempotent when the path already ends in the target suffix', () => {
    expect(normalizeOpenAICompatiblePath('/v1/images/generations', 'images', 'generations')).toBe('/v1/images/generations');
    expect(normalizeOpenAICompatiblePath('/v1/images/edits', 'images', 'edits')).toBe('/v1/images/edits');
  });

  it('videos has no edits suffix, so edits mode still appends /videos/generations', () => {
    expect(normalizeOpenAICompatiblePath('/v1', 'videos', 'edits')).toBe('/v1/videos/generations');
  });

  it('videos already ending in /videos/generations with edits mode falls through to the unchanged path (no edits suffix to rewrite to)', () => {
    expect(normalizeOpenAICompatiblePath('/v1/videos/generations', 'videos', 'edits')).toBe('/v1/videos/generations');
  });
});

describe('buildOpenAICompatibleGenerationUrl / buildOpenAIImageUrl / buildOpenAIImageEditUrl / buildOpenAIVideoUrl', () => {
  it('builds a standard images generations URL', () => {
    expect(buildOpenAIImageUrl('https://api.openai.com/v1', false)).toBe('https://api.openai.com/v1/images/generations');
  });

  it('appends the default azure api-version when azure and none supplied', () => {
    const url = buildOpenAIImageUrl('https://x.openai.azure.com/openai/deployments/gpt-image-2', true);
    expect(url).toContain('/images/generations');
    expect(url).toContain('api-version=2024-02-01');
  });

  it('preserves a caller-supplied api-version instead of overriding it', () => {
    const url = buildOpenAIImageUrl('https://x.openai.azure.com/openai/deployments/gpt-image-2?api-version=2025-01-01', true);
    expect(url).toContain('api-version=2025-01-01');
    expect(url).not.toContain('2024-02-01');
  });

  it('falls back to naive concat on an unparseable base URL', () => {
    expect(buildOpenAICompatibleGenerationUrl('not a url', 'images')).toBe('not a url/images/generations');
  });

  it('buildOpenAIImageUrl falls back to naive concat when even the fallback string is not a parseable URL', () => {
    // buildOpenAICompatibleGenerationUrl('not a url', 'images') itself returns
    // the non-URL string 'not a url/images/generations' via its own catch;
    // wrapping THAT in `new URL(...)` inside buildOpenAIImageUrl throws too,
    // exercising buildOpenAIImageUrl's own separate catch block.
    expect(buildOpenAIImageUrl('not a url', false)).toBe('not a url/images/generations');
  });

  it('builds the images/edits URL', () => {
    expect(buildOpenAIImageEditUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/images/edits');
  });

  it('buildOpenAIImageEditUrl falls back to naive concat on an unparseable base URL', () => {
    expect(buildOpenAIImageEditUrl('not a url')).toBe('not a url/images/edits');
  });

  it('builds the videos/generations URL', () => {
    expect(buildOpenAIVideoUrl('https://api.imagerouter.io/v1/openai')).toBe('https://api.imagerouter.io/v1/openai/videos/generations');
  });
});

describe('buildOpenAISpeechUrl', () => {
  it('appends /audio/speech to the base URL', () => {
    expect(buildOpenAISpeechUrl('https://api.openai.com/v1', false)).toBe('https://api.openai.com/v1/audio/speech');
  });

  it('appends the default azure api-version when azure and none supplied', () => {
    const url = buildOpenAISpeechUrl('https://x.openai.azure.com/openai/deployments/tts', true);
    expect(url).toContain('/audio/speech');
    expect(url).toContain('api-version=2024-02-01');
  });

  it('falls back to naive concat on an unparseable base URL', () => {
    expect(buildOpenAISpeechUrl('not a url', false)).toBe('not a url/audio/speech');
  });
});

describe('openaiSizeFor', () => {
  it('picks a size tuned to the aspect ratio for gpt-image-* models', () => {
    expect(openaiSizeFor('gpt-image-2', '16:9')).toBe('1792x1024');
    expect(openaiSizeFor('gpt-image-2', '9:16')).toBe('1024x1792');
    expect(openaiSizeFor('gpt-image-2', '4:3')).toBe('1408x1056');
    expect(openaiSizeFor('gpt-image-2', '3:4')).toBe('1056x1408');
    expect(openaiSizeFor('gpt-image-2', undefined)).toBe('1024x1024');
  });

  it('picks a size for dall-e-3', () => {
    expect(openaiSizeFor('dall-e-3', '16:9')).toBe('1792x1024');
    expect(openaiSizeFor('dall-e-3', '9:16')).toBe('1024x1792');
    expect(openaiSizeFor('dall-e-3', undefined)).toBe('1024x1024');
  });

  it('dall-e-2 only supports the square size', () => {
    expect(openaiSizeFor('dall-e-2', '16:9')).toBe('1024x1024');
  });
});

describe('parseOpenAICompatibleJson', () => {
  it('parses a JSON body on a successful response', async () => {
    const resp = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await expect(parseOpenAICompatibleJson(resp, 'test')).resolves.toEqual({ ok: true });
  });

  it('throws a provider-tagged, truncated error on a non-OK status', async () => {
    const resp = new Response('x'.repeat(500), { status: 500 });
    await expect(parseOpenAICompatibleJson(resp, 'test')).rejects.toThrow(/^test 500: x+…$/);
  });

  it('throws a clear error on a non-JSON body', async () => {
    const resp = new Response('not json', { status: 200 });
    await expect(parseOpenAICompatibleJson(resp, 'test')).rejects.toThrow(/non-JSON response/);
  });
});

describe('bytesFromOpenAICompatibleData', () => {
  it('decodes a plain base64 b64_json entry', async () => {
    const b64 = Buffer.from('hello').toString('base64');
    const bytes = await bytesFromOpenAICompatibleData({ data: [{ b64_json: b64 }] }, 'test');
    expect(bytes.toString('utf8')).toBe('hello');
  });

  it('strips a data-URL prefix from b64_json before decoding', async () => {
    const b64 = Buffer.from('hello').toString('base64');
    const bytes = await bytesFromOpenAICompatibleData({ data: [{ b64_json: `data:image/png;base64,${b64}` }] }, 'test');
    expect(bytes.toString('utf8')).toBe('hello');
  });

  it('fetches from a url entry when b64_json is absent', async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from('bytes-from-url'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const bytes = await bytesFromOpenAICompatibleData({ data: [{ url: 'https://example.com/x.png' }] }, 'test');
    expect(bytes.toString('utf8')).toBe('bytes-from-url');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/x.png', {});
  });

  it('throws when the url fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await expect(bytesFromOpenAICompatibleData({ data: [{ url: 'https://example.com/x.png' }] }, 'test')).rejects.toThrow(/media fetch 502/);
  });

  it('throws when data[0] is missing', async () => {
    await expect(bytesFromOpenAICompatibleData({ data: [] }, 'test')).rejects.toThrow(/no data\[0\]/);
    await expect(bytesFromOpenAICompatibleData({}, 'test')).rejects.toThrow(/no data\[0\]/);
  });

  it('throws when the entry has neither b64_json nor url', async () => {
    await expect(bytesFromOpenAICompatibleData({ data: [{}] }, 'test')).rejects.toThrow(/neither b64_json nor url/);
  });
});
