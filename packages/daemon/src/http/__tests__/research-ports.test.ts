import { expect, it } from 'vitest';
import { createResearchSearchRoute, researchSearchRoute, type ResearchProvider } from '../research.js';
import { createTavilyResearchProvider } from '../research-tavily.adapter.js';

// hwb #6: a provider supplied by the host owns its identity and transport. Tavily credentials never reach it by default.
it('routes an injected provider through its own validation, credential resolver and search port', async () => {
  const calls: unknown[] = [];
  const provider: ResearchProvider = { id: 'host-research', search: async input => { calls.push(input.request); return { answer: 'host answer', sources: [{ title: 'Source', url: 'https://example.test', snippet: 'Evidence', provider: 'host-research' }] }; } };
  const route = createResearchSearchRoute({ provider });
  const parsed = route.parse({ body: { query: '  question  ', providers: ['host-research'] }, params: {}, query: {} });
  expect(parsed).toEqual({ ok: true, value: { query: 'question' } });
  expect(researchSearchRoute.parse({ body: { query: 'question', providers: ['host-research'] }, params: {}, query: {} }).ok).toBe(false);
  const result = await route.handle({ input: { query: 'question' }, deps: { resolveCredentials: async ({ providerId }) => { expect(providerId).toBe('host-research'); return { apiKey: 'fixture-key' }; } } });
  expect(result).toMatchObject({ ok: true, value: { provider: 'host-research', summary: 'host answer', depth: 'shallow' } });
  expect(calls).toEqual([{ query: 'question' }]);
  expect(await route.handle({ input: { query: 'question' }, deps: { env: { TAVILY_API_KEY: 'fixture-key' } } })).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'host-research provider not configured' } });
});

it('the default Tavily adapter uses injected fetch/env and preserves normalization and redaction', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetchPort: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ answer: 'answer', results: [{ title: ' Title ', url: 'https://example.test', content: ' Snippet ' }] }));
  };
  const result = await researchSearchRoute.handle({ input: { query: 'question', maxSources: 2.7 }, deps: { env: { TAVILY_API_KEY: 'fixture-key' }, fetch: fetchPort } });
  expect(result).toMatchObject({ ok: true, value: { summary: 'answer', provider: 'tavily', sources: [{ title: 'Title', snippet: 'Snippet' }] } });
  expect(calls).toEqual([{ url: 'https://api.tavily.com/search', body: { query: 'question', search_depth: 'basic', max_results: 2, include_answer: true, include_raw_content: false } }]);
  const provider = createTavilyResearchProvider({}, { fetch: async () => new Response('fixture-key', { status: 429 }) });
  let failure: unknown;
  try { await provider.search({ apiKey: 'fixture-key', credentials: {}, request: { query: 'q' } }, {}); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).not.toContain('fixture-key');
});

it('redacts the resolved key from injected provider failures before calling the error sink', async () => {
  const failure = new TypeError('upstream rejected fixture-key');
  failure.stack = 'TypeError: upstream rejected fixture-key\n    at hostSearch (provider.ts:42:7)';
  const provider: ResearchProvider = { id: 'host-research', search: async () => { throw failure; } };
  const errors: unknown[] = [];
  const result = await createResearchSearchRoute({ provider }).handle({ input: { query: 'q' }, deps: { resolveCredentials: async () => ({ apiKey: 'fixture-key' }), onInternalError: ({ error }) => { errors.push(error); } } });
  expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' } });
  expect(errors).toHaveLength(1);
  expect((errors[0] as Error).message).toBe('upstream rejected [REDACTED:exact_secret]');
  expect((errors[0] as Error).name).toBe('TypeError');
  expect((errors[0] as Error).stack).toBe('TypeError: upstream rejected [REDACTED:exact_secret]\n    at hostSearch (provider.ts:42:7)');
});
