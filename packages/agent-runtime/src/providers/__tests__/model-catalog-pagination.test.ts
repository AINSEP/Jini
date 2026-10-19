import { describe, expect, it } from 'vitest';
import { listProviderModels } from '../model-catalog.js';
const noDns = async () => [{ address: '93.184.216.34', family: 4 }];
describe('provider catalog pagination through injected HTTP', () => {
  it('follows Anthropic cursors and deduplicates all pages', async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(urls.length === 1
        ? { data: [{ id: 'claude-a', display_name: 'Claude A' }], has_more: true, last_id: 'claude-a' }
        : { data: [{ id: 'claude-a', display_name: 'Claude A' }, { id: 'claude-b', display_name: 'Claude B' }], has_more: false }), { status: 200 });
    };
    const result = await listProviderModels({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result.models).toEqual([{ id: 'claude-a', label: 'Claude A' }, { id: 'claude-b', label: 'Claude B' }]);
    expect(urls).toHaveLength(2); expect(new URL(urls[1]!).searchParams.get('after_id')).toBe('claude-a');
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });
  it('keeps the Google BYOK provider and follows nextPageToken', async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ models: [{ name: `models/gemini-${urls.length}`, displayName: `Gemini ${urls.length}`, supportedGenerationMethods: ['generateContent'] }], ...(urls.length === 1 ? { nextPageToken: 'next' } : {}) }));
    };
    const result = await listProviderModels({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result.models?.map((row) => row.id)).toEqual(['gemini-1', 'gemini-2']);
    expect(new URL(urls[1]!).searchParams.get('pageToken')).toBe('next');
  });
  it('refuses a pagination loop without exposing cursor values', async () => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'private-cursor' }));
    const result = await listProviderModels({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result.ok).toBe(false); expect(result.detail).toBe('Provider repeated a pagination cursor.');
    expect(JSON.stringify(result)).not.toContain('private-cursor');
  });
  it('refuses to follow redirects on the catalog request', async () => {
    const inits: RequestInit[] = [];
    const fetchFn: typeof fetch = async (_url, init) => { inits.push(init!); return new Response(JSON.stringify({ data: [{ id: 'gpt-a' }] })); };
    await listProviderModels({ protocol: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(inits[0]).toMatchObject({ method: 'GET', redirect: 'error', headers: { authorization: 'Bearer test-secret' } });
  });
  it('follows an OpenAI-style next_cursor with the cursor query param', async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: [{ id: `gpt-${urls.length}` }], ...(urls.length === 1 ? { next_cursor: 'c2' } : {}) }));
    };
    const result = await listProviderModels({ protocol: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result.models?.map((row) => row.id)).toEqual(['gpt-1', 'gpt-2']);
    expect(new URL(urls[1]!).searchParams.get('cursor')).toBe('c2');
  });
  it('ignores a Google-style nextPageToken from a non-Google provider', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => { calls += 1; return new Response(JSON.stringify({ data: [{ id: 'gpt-a' }], nextPageToken: 'next' })); };
    const result = await listProviderModels({ protocol: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
  });
  it('refuses has_more without a cursor', async () => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ data: [{ id: 'claude-a' }], has_more: true }));
    const result = await listProviderModels({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result).toMatchObject({ ok: false, kind: 'unknown', detail: 'Provider omitted its pagination cursor.' });
  });
  it('leaves the detail empty for an error status with an empty body', async () => {
    const fetchFn: typeof fetch = async () => new Response('', { status: 503 });
    const result = await listProviderModels({ protocol: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result).toMatchObject({ ok: false, kind: 'upstream_unavailable', status: 503, detail: '' });
  });
  it('treats a non-object JSON body as an empty catalog', async () => {
    const fetchFn: typeof fetch = async () => new Response('5');
    const result = await listProviderModels({ protocol: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result).toMatchObject({ ok: false, kind: 'no_models', detail: 'Provider returned no usable text-generation models.' });
  });
  // BUG (pinned, not fixed): a JSON `null` body reaches the extractor, which
  // dereferences it; the TypeError surfaces as an `unknown` network-style failure.
  it('reports a JSON null body as the extractor TypeError', async () => {
    const fetchFn: typeof fetch = async () => new Response('null');
    const result = await listProviderModels({ protocol: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result).toMatchObject({ ok: false, kind: 'unknown', detail: "Cannot read properties of null (reading 'data')" });
  });
  it('stops after 100 pages of distinct cursors', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async () => { calls += 1; return new Response(JSON.stringify({ data: [{ id: 'gpt-a' }], next_cursor: `c${calls}` })); };
    const result = await listProviderModels({ protocol: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result).toMatchObject({ ok: false, kind: 'unknown', detail: 'Provider pagination exceeded its safety limit.' });
    expect(calls).toBe(100);
  });
  // BUG (pinned, not fixed): validateBaseUrl trims NBSP before parsing, but the
  // endpoint builder re-parses the raw string, which `new URL` rejects. The
  // failure surfaces as `unsupported_protocol` instead of a base-URL problem.
  it('reports an NBSP-padded base url that passes the guard as unsupported_protocol', async () => {
    const fetchFn: typeof fetch = async () => new Response('{}');
    const result = await listProviderModels({ protocol: 'openai', baseUrl: '\u00a0https://api.openai.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result).toMatchObject({ ok: false, kind: 'unsupported_protocol', detail: 'Invalid URL' });
  });
});
