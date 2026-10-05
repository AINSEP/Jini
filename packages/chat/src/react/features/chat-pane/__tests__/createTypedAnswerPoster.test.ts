/**
 * `createTypedAnswerPoster` maps the typed-answer route's three outcomes onto
 * {@link TypedAnswerDelivery}. A hand-written fetch fake records each request; no module mocking.
 */
import { describe, expect, it } from 'vitest';
import { createTypedAnswerPoster } from '../create-typed-answer-poster.js';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(respond: (request: RecordedRequest) => Promise<Response>): {
  fetch: typeof globalThis.fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: String(input), init };
    requests.push(request);
    return respond(request);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const status = (code: number, body: unknown = {}): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status: code }));

describe('createTypedAnswerPoster', () => {
  it('posts the text under the typed-answer param for the named tool, and reports 202 as delivered', async () => {
    const fake = fakeFetch(() => status(202, { delivered: true }));
    const post = createTypedAnswerPoster(
      { baseUrl: 'https://admin.example/', fetch: fake.fetch, toolName: 'assistant_ask_choice' },
      { path: '/api/admin/v1/mcp-ui/tool-calls', headers: { 'x-csrf': 'tok' } },
    );

    await expect(post({ text: 'deploy it' })).resolves.toBe('delivered');

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.url).toBe('https://admin.example/api/admin/v1/mcp-ui/tool-calls');
    expect(fake.requests[0]?.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf': 'tok', 'content-type': 'application/json' },
      body: JSON.stringify({ toolName: 'assistant_ask_choice', params: { __typedAnswer: 'deploy it' } }),
    });
  });

  it('defaults to the bare-daemon MCP-UI path', async () => {
    const fake = fakeFetch(() => status(202));
    await createTypedAnswerPoster({ baseUrl: '', fetch: fake.fetch, toolName: 'ask' })({ text: 'yes' });
    expect(fake.requests[0]?.url).toBe('/api/mcp-ui/tool-calls');
  });

  it('reports 409 (nothing is waiting: consumed, expired or never open) as not-pending', async () => {
    const fake = fakeFetch(() => status(409, { code: 'SURFACE_NOT_PENDING' }));
    const post = createTypedAnswerPoster({ baseUrl: '', fetch: fake.fetch, toolName: 'ask' });
    await expect(post({ text: 'yes' })).resolves.toBe('not-pending');
  });

  it('reports any other status as failed — a 200 is not a delivery', async () => {
    for (const code of [200, 403, 500]) {
      const fake = fakeFetch(() => status(code));
      const post = createTypedAnswerPoster({ baseUrl: '', fetch: fake.fetch, toolName: 'ask' });
      await expect(post({ text: 'yes' })).resolves.toBe('failed');
    }
  });

  it('reports a network error as failed instead of throwing', async () => {
    const fake = fakeFetch(() => Promise.reject(new TypeError('offline')));
    const post = createTypedAnswerPoster({ baseUrl: '', fetch: fake.fetch, toolName: 'ask' });
    await expect(post({ text: 'yes' })).resolves.toBe('failed');
  });

  it('aborts a hung request after timeoutMs and reports it as failed', async () => {
    const fake = fakeFetch(({ init }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const post = createTypedAnswerPoster({ baseUrl: '', fetch: fake.fetch, toolName: 'ask' }, { timeoutMs: 5 });
    await expect(post({ text: 'yes' })).resolves.toBe('failed');
    expect(fake.requests[0]?.init?.signal?.aborted).toBe(true);
  });
});
