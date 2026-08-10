import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchVendorRequest, requireApiKey } from '../vendor-adapter.js';
import type { VendorAdapter, VendorRequest } from '../vendor-adapter.js';
import type { RenderContext } from '../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseCtx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    surface: 'image',
    model: 'test-model',
    wireModel: 'test-model',
    prompt: 'a prompt',
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

describe('dispatchVendorRequest', () => {
  it('runs requireCredential -> buildRequest -> fetch -> parseResponse in order', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(`fetch:${url}`);
      return new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter: VendorAdapter<{ tag: string }> = {
      requireCredential: (credentials) => {
        calls.push('requireCredential');
        if (!credentials.apiKey) throw new Error('missing key');
      },
      buildRequest: (_ctx, _credentials) => {
        calls.push('buildRequest');
        return { url: 'https://example.com/generate', init: { method: 'POST' }, meta: { tag: 'x' } };
      },
      parseResponse: async (resp, _ctx, request) => {
        calls.push('parseResponse');
        expect(request.meta.tag).toBe('x');
        const text = await resp.text();
        return { bytes: Buffer.from(text), providerNote: 'note', suggestedExt: '.bin' };
      },
    };

    const result = await dispatchVendorRequest(adapter, baseCtx(), { apiKey: 'k' });
    expect(calls).toEqual(['requireCredential', 'buildRequest', 'fetch:https://example.com/generate', 'parseResponse']);
    expect(result.bytes.toString('utf8')).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws from requireCredential before ever calling buildRequest or fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('should not be called', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const buildRequest = vi.fn();

    const adapter: VendorAdapter = {
      requireCredential: () => {
        throw new Error('no credential configured');
      },
      buildRequest,
      parseResponse: async () => ({ bytes: Buffer.alloc(0), providerNote: '' }),
    };

    await expect(dispatchVendorRequest(adapter, baseCtx(), {})).rejects.toThrow(/no credential configured/);
    expect(buildRequest).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('works with no requireCredential at all (optional)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bytes', { status: 200 })));
    const adapter: VendorAdapter = {
      buildRequest: () => ({ url: 'https://example.com/x', init: {}, meta: undefined }),
      parseResponse: async (resp) => ({ bytes: Buffer.from(await resp.text()), providerNote: 'ok' }),
    };
    const result = await dispatchVendorRequest(adapter, baseCtx(), {});
    expect(result.bytes.toString('utf8')).toBe('bytes');
  });

  it('propagates parseResponse errors (e.g. mapped from a non-OK status)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })));
    const adapter: VendorAdapter = {
      buildRequest: () => ({ url: 'https://example.com/x', init: {}, meta: undefined }),
      parseResponse: async (resp) => {
        if (!resp.ok) throw new Error(`vendor x ${resp.status}`);
        return { bytes: Buffer.alloc(0), providerNote: '' };
      },
    };
    await expect(dispatchVendorRequest(adapter, baseCtx(), {})).rejects.toThrow(/vendor x 500/);
  });

  it('passes the exact request (url + init) buildRequest constructed into fetch', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://example.com/custom');
      expect(init.method).toBe('PUT');
      expect((init.headers as Record<string, string>)['x-test']).toBe('1');
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter: VendorAdapter = {
      buildRequest: () => ({
        url: 'https://example.com/custom',
        init: { method: 'PUT', headers: { 'x-test': '1' } },
        meta: undefined,
      }),
      parseResponse: async () => ({ bytes: Buffer.alloc(0), providerNote: '' }),
    };
    await dispatchVendorRequest(adapter, baseCtx(), {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('requireApiKey', () => {
  it('throws the configured message when apiKey is absent', () => {
    const guard = requireApiKey('no credential for vendor x');
    expect(() => guard({})).toThrow(/no credential for vendor x/);
  });

  it('throws when apiKey is an empty string', () => {
    const guard = requireApiKey('no credential for vendor x');
    expect(() => guard({ apiKey: '' })).toThrow(/no credential for vendor x/);
  });

  it('does not throw when apiKey is set', () => {
    const guard = requireApiKey('no credential for vendor x');
    expect(() => guard({ apiKey: 'sk-real' })).not.toThrow();
  });
});

describe('VendorRequest meta plumbing', () => {
  it('threads meta computed in buildRequest through to parseResponse untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    interface Meta {
      readonly wireModel: string;
      readonly count: number;
    }
    let observed: VendorRequest<Meta> | undefined;
    const adapter: VendorAdapter<Meta> = {
      buildRequest: () => ({ url: 'https://example.com', init: {}, meta: { wireModel: 'm-1', count: 3 } }),
      parseResponse: async (_resp, _ctx, request) => {
        observed = request;
        return { bytes: Buffer.alloc(0), providerNote: '' };
      },
    };
    await dispatchVendorRequest(adapter, baseCtx(), {});
    expect(observed?.meta).toEqual({ wireModel: 'm-1', count: 3 });
  });
});
