import { afterEach, describe, expect, it, vi } from 'vitest';
import { denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { describeRoutes } from '../route-table.js';
import { researchRoutes, researchSearchRoute, type ResearchHttpDeps } from '../research.js';

function okFetchResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function makeDeps(overrides: Partial<ResearchHttpDeps> = {}): ResearchHttpDeps {
  return {
    resolveCredentials: async () => ({ apiKey: 'tvly-test-key' }),
    ...overrides,
  };
}

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
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'tavily provider not configured' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Tavily POST {baseUrl}/search with the Bearer auth header and the documented body shape, defaulting to api.tavily.com, and returns the OD-shaped ResearchFindings envelope (query/summary/sources/provider/depth/fetchedAt)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okFetchResponse({ answer: 'It is sunny.', results: [{ title: 'Weather', url: 'https://example.com/w', content: 'Sunny today', published_date: '2026-07-22' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const before = Date.now();
    const result = await researchSearchRoute.handle({ input: { query: 'weather in SF' }, deps: makeDeps() });
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
    await researchSearchRoute.handle({ input: { query: 'q', maxSources: 999 }, deps });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/tavily/search');
    const body = JSON.parse(init.body);
    expect(body.max_results).toBe(20);
  });

  it("floors a fractional maxSources before sending max_results to Tavily, matching OD's live behavior (maxSources: 2.7 -> max_results: 2 on the wire, confirmed against the real daemon)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okFetchResponse({ answer: 'ok', results: [{ title: 'T', url: 'https://example.com/x', content: 'c' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await researchSearchRoute.handle({ input: { query: 'q', maxSources: 2.7 }, deps: makeDeps() });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body).max_results).toBe(2);
  });

  it('falls back to the source url when title is blank, and empty snippet when content is not a string; synthesizes a fallback summary from the top sources when Tavily returns no answer text (ported verbatim from OD\'s real synthesizeFallbackSummary)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okFetchResponse({ answer: '', results: [{ title: '  ', url: 'https://example.com/x' }, { url: '' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sources).toEqual([{ title: 'https://example.com/x', url: 'https://example.com/x', snippet: '', provider: 'tavily' }]);
      expect(result.value.summary).toBe('(No provider summary; top snippets follow.)\n- [1] https://example.com/x: ');
    }
  });

  it("returns NOT_FOUND (404) when Tavily's results map to zero usable sources, matching OD's live NO_RESEARCH_SOURCES behavior (confirmed against the real daemon with an empty-results mock Tavily backend)", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okFetchResponse({ answer: 'nothing found', results: [] })));
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps() });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'no sources found' } });
  });

  it('SEC-005: a non-ok Tavily response is reported to onInternalError and never leaks the api key to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized: tvly-test-key invalid' }));
    const onInternalError = vi.fn();
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps({ onInternalError }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.error.message).toBe('The web research request could not be completed. Try again; if it keeps failing, copy the request ID and report this problem.');
      expect(JSON.stringify(result.error)).not.toContain('tvly-test-key');
    }
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const reportedError = onInternalError.mock.calls[0]![0].error as Error;
    expect(reportedError.message).not.toContain('tvly-test-key');
    expect(reportedError.message).toBe('Tavily 401: Unauthorized: [REDACTED:exact_secret] invalid');
  });

  it('SEC-005: a network-level fetch rejection is also redacted and reported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const onInternalError = vi.fn();
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps({ onInternalError }) });
    expect(result.ok).toBe(false);
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  it('rejects a forbidden internal base url (SSRF guard) without ever calling fetch, reporting it as an INTERNAL_ERROR', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onInternalError = vi.fn();
    const deps = makeDeps({ resolveCredentials: async () => ({ apiKey: 'k', baseUrl: 'http://169.254.169.254' }), onInternalError });
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });

  // Hosts resolve credentials explicitly; absent or blank credentials remain unconfigured.
  describe('host-supplied credentials', () => {
    it('uses the credential supplied by the host resolver', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        okFetchResponse({ answer: 'ok', results: [{ title: 'T', url: 'https://example.com/x', content: 'c' }] }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: { resolveCredentials: async () => ({ apiKey: 'tvly-from-env' }) } });
      expect(result.ok).toBe(true);
      // The host supplies the resolved API key used for the Bearer credential.
      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.headers.authorization).toBe('Bearer tvly-from-env');
    });

    it('reports NOT_CONFIGURED when the host resolver supplies no API key', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: { resolveCredentials: async () => ({}) } });
      expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'tavily provider not configured' } });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports NOT_CONFIGURED when the host resolver supplies an empty API key', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: { resolveCredentials: async () => ({ apiKey: '' }) } });
      expect(result).toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to console.error when no onInternalError sink is supplied', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: { resolveCredentials: async () => ({ apiKey: 'k' }) } });
      expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]![0]).toContain('internal error (research/search, correlationId=');
      expect(consoleErrorSpy.mock.calls[0]?.[1]).toBe('Error');
      consoleErrorSpy.mockRestore();
    });
  });

  // Tavily's response is untrusted input: every field this route reads is optional on the wire, and a
  // malformed one must degrade rather than throw. Each case below feeds one broken shape.
  describe('malformed Tavily responses', () => {
    it('treats a non-string answer as no summary and synthesizes one from the sources', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        okFetchResponse({ answer: { not: 'a string' }, results: [{ title: 'T', url: 'https://example.com/x', content: 'snippet text' }] }),
      ));
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps() });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.summary).toContain('(No provider summary; top snippets follow.)');
        expect(result.value.summary).toContain('snippet text');
      }
    });

    it('treats a non-array results field as zero sources (404), not a crash', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okFetchResponse({ answer: 'ok', results: 'not-an-array' })));
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps() });
      expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'no sources found' } });
    });

    it('skips a result with no usable url while keeping the rest', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        okFetchResponse({
          answer: 'ok',
          results: [
            { title: 'no url', content: 'dropped' },
            { title: 'missing url type', url: 42, content: 'also dropped' },
            { title: 'kept', url: 'https://example.com/keep', content: 'kept snippet' },
          ],
        }),
      ));
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps() });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sources).toEqual([
          { title: 'kept', url: 'https://example.com/keep', snippet: 'kept snippet', provider: 'tavily' },
        ]);
      }
    });

    it('reports an empty-bodied non-ok response as "no body" rather than an empty message', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => '' }));
      const onInternalError = vi.fn();
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps({ onInternalError }) });
      expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
      expect((onInternalError.mock.calls[0]![0].error as Error).message).toBe('Tavily 429: no body');
    });

    it('redacts a non-Error thrown value without assuming it has a .message', async () => {
      // A rejected promise carrying a bare string — real fetch polyfills and proxies do this.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('socket hang up on tvly-test-key'));
      const onInternalError = vi.fn();
      const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps({ onInternalError }) });
      expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
      const reported = onInternalError.mock.calls[0]![0].error as Error;
      expect(reported.message).toContain('Tavily request failed: socket hang up on');
      expect(reported.message).not.toContain('tvly-test-key');
    });
  });

  it('reports a stalled response body as a timeout, not a generic failure', async () => {
    // The timeout must stay armed for the whole operation, not just until `fetch` resolves — a server
    // that sends headers promptly and then stalls the body is exactly the case an earlier version of
    // this module got wrong. The mock resolves headers immediately, then never resolves `json()`,
    // and rejects only once the route's own AbortSignal fires.
    const fetchMock = vi.fn(async (_url: string, init: { signal: AbortSignal }) => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onInternalError = vi.fn();

    vi.useFakeTimers();
    try {
      const pending = researchSearchRoute.handle({ input: { query: 'q' }, deps: makeDeps({ onInternalError }) });
      // Let the fetch/json microtasks settle, then trip the route's own timer.
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await pending;
      expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
      expect((onInternalError.mock.calls[0]![0].error as Error).message).toMatch(/^Tavily request timed out after \d+ms$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SEC-005: a throwing resolveCredentials is caught and reported as INTERNAL_ERROR', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({
      resolveCredentials: async () => {
        throw new Error('vault unreachable');
      },
      onInternalError,
    });
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(onInternalError).toHaveBeenCalledTimes(1);
  });
});

describe('researchRoutes', () => {
  const serve = ({ deps, denyOrigins = false }: { deps: ResearchHttpDeps; denyOrigins?: boolean }) =>
    serveRoutes({ routes: researchRoutes({ deps, host: fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {}) }) });
  const search = async ({ deps, body, denyOrigins = false }: { deps: ResearchHttpDeps; body: unknown; denyOrigins?: boolean }) => {
    const response = await serve({ deps, denyOrigins })(jsonRequest({ path: '/api/research/search', method: 'POST' }, { body }));
    return { status: response.status, body: await response.json() as unknown };
  };

  it('lists exactly POST /api/research/search, behind the same-origin gate', () => {
    expect(describeRoutes({ routes: researchRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual([{ method: 'POST', path: '/api/research/search', gates: ['same-origin'] }]);
  });

  it('requires same-origin: rejects a cross-origin request with 403 before touching fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await search({ deps: makeDeps(), body: { query: 'q' }, denyOrigins: true })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a same-origin request with a configured provider returns 200 with the full OD-shaped ResearchFindings envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okFetchResponse({ answer: 'the answer', results: [{ title: 'T', url: 'https://example.com/x', content: 'c' }] })));
    const { status, body } = await search({ deps: makeDeps(), body: { query: 'what is jini' } });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      query: 'what is jini',
      summary: 'the answer',
      sources: [{ title: 'T', url: 'https://example.com/x', snippet: 'c', provider: 'tavily' }],
      provider: 'tavily',
      depth: 'shallow',
    });
    expect(typeof (body as { fetchedAt: unknown }).fetchedAt).toBe('number');
  });

  it('answers 404 when no usable source comes back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okFetchResponse({ answer: 'none', results: [] })));
    expect(await search({ deps: makeDeps(), body: { query: 'q' } })).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'no sources found' } } });
  });

  it('answers 503 when no provider credential is configured', async () => {
    expect(await search({ deps: { resolveCredentials: async () => ({}) }, body: { query: 'q' } })).toEqual({
      status: 503,
      body: { error: { code: 'NOT_CONFIGURED', message: 'tavily provider not configured' } },
    });
  });

  it('answers 400 for a malformed body', async () => {
    expect((await search({ deps: makeDeps(), body: { query: '   ' } })).status).toBe(400);
  });

  it("reports a provider failure through the host's reporter, with a request ID in the answer", async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream down')));
    const host = fakeDaemonRouteHost();
    const response = await serveRoutes({ routes: researchRoutes({ deps: makeDeps(), host }) })(jsonRequest({ path: '/api/research/search', method: 'POST' }, { body: { query: 'q' } }));
    expect([response.status, host.reports.map((report) => report.logSource), (await response.json() as { error: { requestId: string } }).error.requestId]).toEqual([500, ['research/search'], 'req-1']);
  });
});
