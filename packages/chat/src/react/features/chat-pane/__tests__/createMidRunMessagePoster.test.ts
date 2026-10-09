/**
 * `createMidRunMessagePoster` maps the run-messages route's outcomes onto
 * {@link MidRunMessageDelivery}. A hand-written fetch fake records each request; no module mocking.
 */
import { describe, expect, it } from 'vitest';
import { createMidRunMessagePoster } from '../create-mid-run-message-poster.js';

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

const conflict = (delivery: string): Promise<Response> =>
  status(409, { error: { code: 'CONFLICT', message: 'not delivered', details: { delivery } } });

describe('createMidRunMessagePoster', () => {
  it('posts the text to the run\'s messages route and reports 202 as delivered', async () => {
    const fake = fakeFetch(() => status(202, { delivery: 'delivered' }));
    const post = createMidRunMessagePoster(
      { baseUrl: 'https://admin.example/', fetch: fake.fetch },
      { headers: { 'x-csrf': 'tok' } },
    );

    await expect(post({ runId: 'run 1', text: 'also fix the footer' })).resolves.toBe('delivered');

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.url).toBe('https://admin.example/api/runs/run%201/messages');
    expect(fake.requests[0]?.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf': 'tok', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'also fix the footer' }),
    });
  });

  it('redacts a pasted secret before it leaves the browser', async () => {
    const fake = fakeFetch(() => status(202));
    const counts: number[] = [];
    const post = createMidRunMessagePoster({ baseUrl: '', fetch: fake.fetch }, {
      redactUserText: () => ({ text: '[redacted]', secretRedacted: true, count: 1 }),
      onSecretRedacted: ({ count }) => counts.push(count),
    });

    await post({ runId: 'r', text: 'sk-live-secret' });

    expect(fake.requests[0]?.init?.body).toBe(JSON.stringify({ text: '[redacted]' }));
    expect(counts).toEqual([1]);
  });

  it('reports a 409 whose run has no live process as not-running', async () => {
    const fake = fakeFetch(() => conflict('not-running'));
    const post = createMidRunMessagePoster({ baseUrl: '', fetch: fake.fetch });
    await expect(post({ runId: 'r', text: 'x' })).resolves.toBe('not-running');
  });

  it('reports any other 409, or a run the daemon does not know (404), as unsupported', async () => {
    for (const respond of [() => conflict('unsupported'), () => status(409), () => status(404)]) {
      const fake = fakeFetch(respond);
      const post = createMidRunMessagePoster({ baseUrl: '', fetch: fake.fetch });
      await expect(post({ runId: 'r', text: 'x' })).resolves.toBe('unsupported');
    }
  });

  it('reports any other status, or a network error, as failed instead of throwing', async () => {
    for (const respond of [() => status(200), () => status(500), () => Promise.reject(new TypeError('offline'))]) {
      const fake = fakeFetch(respond);
      const post = createMidRunMessagePoster({ baseUrl: '', fetch: fake.fetch });
      await expect(post({ runId: 'r', text: 'x' })).resolves.toBe('failed');
    }
  });

  it('aborts a hung request after timeoutMs and reports it as failed', async () => {
    const fake = fakeFetch(({ init }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const post = createMidRunMessagePoster({ baseUrl: '', fetch: fake.fetch }, { timeoutMs: 5 });
    await expect(post({ runId: 'r', text: 'x' })).resolves.toBe('failed');
    expect(fake.requests[0]?.init?.signal?.aborted).toBe(true);
  });
});
