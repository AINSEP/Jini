import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  createResearchSearchRoute,
  registerResearchRoutes,
  researchSearchRoute,
  type ResearchHttpDeps,
  type ResearchInternalErrorContext,
  type ResearchProvider,
  type ResearchSource,
} from '../research.js';

vi.mock('@jini-ai/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@jini-ai/core')>(),
  isLocalSameOrigin: vi.fn(() => true),
}));

/**
 * Pins `createResearchSearchRoute`'s `handle` — provider precedence, default credential resolution,
 * and the redacted error-sink copy — so the handler can be split without changing any outcome.
 */

const KEY = 'fixture-key';
const SOURCE: ResearchSource = { title: 'T', url: 'https://example.test/a', snippet: 'snippet', provider: 'p' };

function provider(id: string, search: ResearchProvider['search'] = async () => ({ answer: `${id} answer`, sources: [SOURCE] })): ResearchProvider {
  return { id, search };
}

function sinkDeps(overrides: Partial<ResearchHttpDeps> = {}) {
  const errors: ResearchInternalErrorContext[] = [];
  const deps: ResearchHttpDeps = { resolveCredentials: async () => ({ apiKey: KEY }), onInternalError: (context) => { errors.push(context); }, ...overrides };
  return { deps, errors };
}

describe('research handle: provider selection', () => {
  it('a factory-bound provider wins over deps.provider', async () => {
    const route = createResearchSearchRoute({ provider: provider('bound') });
    const result = await route.handle({ input: { query: 'q' }, deps: sinkDeps({ provider: provider('from-deps') }).deps });
    expect(result).toMatchObject({ ok: true, value: { provider: 'bound', summary: 'bound answer' } });
  });

  it('deps.provider is used when the route has no bound provider', async () => {
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: sinkDeps({ provider: provider('from-deps') }).deps });
    expect(result).toMatchObject({ ok: true, value: { provider: 'from-deps', summary: 'from-deps answer' } });
  });

  it('a non-tavily provider without resolveCredentials gets no credentials even when TAVILY_API_KEY is set', async () => {
    const search = vi.fn<ResearchProvider['search']>();
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps: { provider: provider('other', search), env: { TAVILY_API_KEY: KEY } } });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'other provider not configured' } });
    expect(search).not.toHaveBeenCalled();
  });

  it('a deps.provider whose id is "tavily" reads TAVILY_API_KEY from deps.env by default', async () => {
    const search = vi.fn<ResearchProvider['search']>(async () => ({ answer: 'a', sources: [SOURCE] }));
    await researchSearchRoute.handle({ input: { query: 'q' }, deps: { provider: provider('tavily', search), env: { TAVILY_API_KEY: ` ${KEY} ` } } });
    expect(search).toHaveBeenCalledWith({ apiKey: KEY, credentials: { apiKey: KEY }, request: { query: 'q' } }, {});
  });

  it('passes the selected provider id to resolveCredentials', async () => {
    const resolveCredentials = vi.fn(async () => ({ apiKey: KEY }));
    await createResearchSearchRoute({ provider: provider('bound') }).handle({ input: { query: 'q' }, deps: { resolveCredentials } });
    expect(resolveCredentials).toHaveBeenCalledWith({ providerId: 'bound' });
  });
});

describe('research handle: outcomes', () => {
  it('an empty answer string falls back to the synthesized summary', async () => {
    const route = createResearchSearchRoute({ provider: provider('p', async () => ({ answer: '', sources: [SOURCE] })) });
    const result = await route.handle({ input: { query: 'q' }, deps: sinkDeps().deps });
    expect(result).toMatchObject({ ok: true, value: { summary: '(No provider summary; top snippets follow.)\n- [1] T: snippet' } });
  });

  it('a throwing resolveCredentials reports the raw error with the response requestId as correlationId', async () => {
    const failure = new Error('vault down');
    const { deps, errors } = sinkDeps({ resolveCredentials: async () => { throw failure; } });
    const result = await researchSearchRoute.handle({ input: { query: 'q' }, deps });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' } });
    expect(errors).toEqual([{ correlationId: result.ok ? '' : result.error.requestId, error: failure }]);
  });

  it('a non-Error thrown by the provider is reported as a plain Error carrying the redacted text', async () => {
    const route = createResearchSearchRoute({ provider: provider('p', async () => { throw `upstream said ${KEY}`; }) });
    const { deps, errors } = sinkDeps();
    const result = await route.handle({ input: { query: 'q' }, deps });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' } });
    expect(errors).toHaveLength(1);
    const reported = errors[0]!.error as Error;
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe('upstream said [REDACTED:exact_secret]');
    expect(reported.name).toBe('Error');
    expect(errors[0]!.correlationId).toBe(result.ok ? '' : result.error.requestId);
  });

  it('a provider Error without a stack is reported with no stack property at all', async () => {
    const failure = new Error(`bad ${KEY}`);
    delete failure.stack;
    const route = createResearchSearchRoute({ provider: provider('p', async () => { throw failure; }) });
    const { deps, errors } = sinkDeps();
    await route.handle({ input: { query: 'q' }, deps });
    const reported = errors[0]!.error as Error;
    expect(reported.message).toBe('bad [REDACTED:exact_secret]');
    expect('stack' in reported).toBe(false);
  });

  it('a provider Error whose name embeds the key has the name redacted', async () => {
    const failure = new Error('x');
    failure.name = `Err-${KEY}`;
    const route = createResearchSearchRoute({ provider: provider('p', async () => { throw failure; }) });
    const { deps, errors } = sinkDeps();
    await route.handle({ input: { query: 'q' }, deps });
    expect((errors[0]!.error as Error).name).toBe('Err-[REDACTED:exact_secret]');
  });
});

describe('registerResearchRoutes with deps.provider', () => {
  it("mounts a route whose parse accepts the provider's own id", async () => {
    // A real Express app; the spy captures the handler `mountJsonRoute` registers so it can be driven directly.
    const app = express();
    const post = vi.spyOn(app, 'post');
    registerResearchRoutes({ app, deps: { provider: provider('host'), resolveCredentials: async () => ({ apiKey: KEY }) }, adapter: { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST', env: {}, resolvedPortRef: { current: 7456 } } });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    expect(post.mock.calls.map((call) => call[0])).toEqual(['/api/research/search']);
    const handler = post.mock.calls[0]!.at(-1) as (req: unknown, res: unknown) => Promise<void>;
    await handler({ body: { query: 'q', providers: ['host'] }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0]![0]).toMatchObject({ provider: 'host', summary: 'host answer' });
  });
});
