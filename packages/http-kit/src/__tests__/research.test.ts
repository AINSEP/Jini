import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '../origin-validation.js';
import { registerResearchRoutes, researchSearchRoute, type ResearchHttpDeps } from '../research.js';

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(() => true),
}));

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  patch: (path: string, handler: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return { get: make('get'), post: make('post'), put: make('put'), delete: make('delete'), patch: make('patch'), handlers };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const adapter = { resolvedPortRef: { current: 7456 } };

function okFetchResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function makeDeps(overrides: Partial<ResearchHttpDeps> = {}): ResearchHttpDeps {
  return {
    resolveCredentials: async () => ({ apiKey: 'tvly-test-key' }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('researchSearchRoute.parse', () => {
  it('rejects a non-object body', () => {
    expect(researchSearchRoute.parse({ body: 'nope', query: {}, params: {} })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' },
    });
  });

  it('rejects a missing/empty query', () => {
    expect(researchSearchRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
    expect(researchSearchRoute.parse({ body: { query: '   ' }, query: {}, params: {} }).ok).toBe(false);
  });

  it('rejects a non-positive maxSources when provided', () => {
    expect(researchSearchRoute.parse({ body: { query: 'q', maxSources: 0 }, query: {}, params: {} }).ok).toBe(false);
    expect(researchSearchRoute.parse({ body: { query: 'q', maxSources: -1 }, query: {}, params: {} }).ok).toBe(false);
    expect(researchSearchRoute.parse({ body: { query: 'q', maxSources: 'ten' }, query: {}, params: {} }).ok).toBe(false);
  });

  it('accepts a bare query and an optional maxSources', () => {
    expect(researchSearchRoute.parse({ body: { query: 'weather in SF' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { query: 'weather in SF' },
    });
    expect(researchSearchRoute.parse({ body: { query: 'q', maxSources: 3 }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { query: 'q', maxSources: 3 },
    });
  });

  it("trims whitespace and caps the query at 1000 characters, matching OD's real searchResearch normalization (confirmed live: a 1112-char padded query arrived at the mock Tavily backend as exactly 1000 trimmed chars)", () => {
    expect(researchSearchRoute.parse({ body: { query: '  padded query  ' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { query: 'padded query' },
    });
    const longQuery = 'x'.repeat(1200);
    const parsed = researchSearchRoute.parse({ body: { query: longQuery }, query: {}, params: {} });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.query).toBe('x'.repeat(1000));
  });

  it('accepts an explicit providers: ["tavily"], matching OD live behavior', () => {
    expect(researchSearchRoute.parse({ body: { query: 'q', providers: ['tavily'] }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { query: 'q' },
    });
  });

  it("rejects a providers[0] other than 'tavily', matching OD's live UNSUPPORTED_RESEARCH_PROVIDER 400", () => {
    const result = researchSearchRoute.parse({ body: { query: 'q', providers: ['bing'] }, query: {}, params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BAD_REQUEST');
  });

  it('treats a non-array providers value as absent rather than rejecting it, matching OD (OD only guards Array.isArray(providers))', () => {
    expect(researchSearchRoute.parse({ body: { query: 'q', providers: 'tavily' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { query: 'q' },
    });
  });
});

describe('researchSearchRoute.handle', () => {
  it('rejects with NOT_CONFIGURED (no fetch call) when the resolved credentials have no apiKey', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const deps = makeDeps({ resolveCredentials: async () => ({}) });
    const result = await researchSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'tavily provider not configured' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Tavily POST {baseUrl}/search with the Bearer auth header and the documented body shape, defaulting to api.tavily.com, and returns the OD-shaped ResearchFindings envelope (query/summary/sources/provider/depth/fetchedAt)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okFetchResponse({ answer: 'It is sunny.', results: [{ title: 'Weather', url: 'https://example.com/w', content: 'Sunny today', published_date: '2026-07-22' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const before = Date.now();
    const result = await researchSearchRoute.handle({ query: 'weather in SF' }, makeDeps());
    const after = Date.now();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { fetchedAt, ...rest } = result.value;
      expect(rest).toEqual({
        query: 'weather in SF',
        summary: 'It is sunny.',
        sources: [{ title: 'Weather', url: 'https://example.com/w', snippet: 'Sunny today', provider: 'tavily', publishedAt: '2026-07-22' }],
        provider: 'tavily',
        depth: 'shallow',
      });
      expect(fetchedAt).toBeGreaterThanOrEqual(before);
      expect(fetchedAt).toBeLessThanOrEqual(after);
    }
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tvly-test-key');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ query: 'weather in SF', search_depth: 'basic', max_results: 5, include_answer: true, include_raw_content: false });
  });

  it('honors a caller-supplied baseUrl and clamps maxSources to the documented 20-result cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okFetchResponse({ answer: 'ok', results: [{ title: 'T', url: 'https://example.com/x', content: 'c' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const deps = makeDeps({ resolveCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://gateway.example.com/tavily/' }) });
    await researchSearchRoute.handle({ query: 'q', maxSources: 999 }, deps);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/tavily/search');
    const body = JSON.parse(init.body);
    expect(body.max_results).toBe(20);
  });

  it("floors a fractional maxSources before sending max_results to Tavily, matching OD's live behavior (maxSources: 2.7 -> max_results: 2 on the wire, confirmed against the real daemon)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okFetchResponse({ answer: 'ok', results: [{ title: 'T', url: 'https://example.com/x', content: 'c' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await researchSearchRoute.handle({ query: 'q', maxSources: 2.7 }, makeDeps());
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body).max_results).toBe(2);
  });

  it('falls back to the source url when title is blank, and empty snippet when content is not a string; synthesizes a fallback summary from the top sources when Tavily returns no answer text (ported verbatim from OD\'s real synthesizeFallbackSummary)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okFetchResponse({ answer: '', results: [{ title: '  ', url: 'https://example.com/x' }, { url: '' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await researchSearchRoute.handle({ query: 'q' }, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sources).toEqual([{ title: 'https://example.com/x', url: 'https://example.com/x', snippet: '', provider: 'tavily' }]);
      expect(result.value.summary).toBe('(No provider summary; top snippets follow.)\n- [1] https://example.com/x: ');
    }
  });

  it("returns NOT_FOUND (404) when Tavily's results map to zero usable sources, matching OD's live NO_RESEARCH_SOURCES behavior (confirmed against the real daemon with an empty-results mock Tavily backend)", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okFetchResponse({ answer: 'nothing found', results: [] })));
    const result = await researchSearchRoute.handle({ query: 'q' }, makeDeps());
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'no sources found' } });
  });

  it('SEC-005: a non-ok Tavily response is reported to onInternalError and never leaks the api key to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized: tvly-test-key invalid' }));
    const onInternalError = vi.fn();
    const result = await researchSearchRoute.handle({ query: 'q' }, makeDeps({ onInternalError }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('an internal error occurred');
      expect(JSON.stringify(result.error)).not.toContain('tvly-test-key');
    }
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const reportedError = onInternalError.mock.calls[0]![0].error as Error;
    expect(reportedError.message).not.toContain('tvly-test-key');
    expect(reportedError.message).toContain('[REDACTED]');
  });

  it('SEC-005: a network-level fetch rejection is also redacted and reported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const onInternalError = vi.fn();
    const result = await researchSearchRoute.handle({ query: 'q' }, makeDeps({ onInternalError }));
    expect(result.ok).toBe(false);
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('rejects a forbidden internal base url (SSRF guard) without ever calling fetch, reporting it as an INTERNAL_ERROR', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onInternalError = vi.fn();
    const deps = makeDeps({ resolveCredentials: async () => ({ apiKey: 'k', baseUrl: 'http://169.254.169.254' }), onInternalError });
    const result = await researchSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('SEC-005: a throwing resolveCredentials is caught and reported as INTERNAL_ERROR', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({
      resolveCredentials: async () => {
        throw new Error('vault unreachable');
      },
      onInternalError,
    });
    const result = await researchSearchRoute.handle({ query: 'q' }, deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });
});

describe('registerResearchRoutes', () => {
  it('mounts exactly POST /api/research/search', () => {
    const app = makeApp();
    registerResearchRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers)).toEqual(['POST /api/research/search']);
  });

  it('requires same-origin: rejects a cross-origin request with 403 before touching fetch', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = makeApp();
    registerResearchRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['POST /api/research/search']!({ body: { query: 'q' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a same-origin request with a configured provider returns 200 with the OD-shaped ResearchFindings result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okFetchResponse({ answer: 'ok', results: [{ title: 'T', url: 'https://example.com/x', content: 'c' }] })),
    );
    const app = makeApp();
    registerResearchRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['POST /api/research/search']!({ body: { query: 'q' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledTimes(1);
    const [body] = res.json.mock.calls[0]!;
    expect(body).toMatchObject({
      query: 'q',
      summary: 'ok',
      sources: [{ title: 'T', url: 'https://example.com/x', snippet: 'c', provider: 'tavily' }],
      provider: 'tavily',
      depth: 'shallow',
    });
    expect(typeof body.fetchedAt).toBe('number');
  });
});
