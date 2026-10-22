import { expect, it } from 'vitest';
import { createHttpTransport, type AdminFetch } from '../transport/http.js';

/** Boundary cases for fetch-failure translation and error-envelope classification. */

const rejecting = (cause: unknown): AdminFetch => async () => {
  throw cause;
};
const failureOf = (fetch: AdminFetch, options: { isPageUnloading?: () => boolean } = {}) =>
  createHttpTransport({ baseUrl: '/api', fetch }, options)
    .request({ path: '/x' })
    .catch((error: unknown) => error);

it('rethrows a null rejection unchanged', async () => {
  expect(await failureOf(rejecting(null))).toBeNull();
});

it('rethrows a nameless object rejection unchanged', async () => {
  const cause = { reason: 'odd adapter' };
  expect(await failureOf(rejecting(cause))).toBe(cause);
});

it('reports a timeout Error with its message as the cause and the full guidance', async () => {
  const cause = Object.assign(new Error('deadline'), { name: 'TimeoutError' });
  const error = await failureOf(rejecting(cause));
  expect(error).toMatchObject({
    status: 0,
    code: 'REQUEST_TIMEOUT',
    body: { cause: 'deadline' },
    message:
      'the API did not respond within 60s — the browser may be out of free connections for this origin (try closing other admin tabs) or the server is unresponsive',
  });
});

it('reports a network failure as unreachable while the page is not unloading', async () => {
  const error = await failureOf(rejecting(new TypeError('Failed to fetch')), {
    isPageUnloading: () => false,
  });
  expect(error).toMatchObject({ status: 0, code: 'API_UNREACHABLE' });
});

it('names the unload cancellation in its message', async () => {
  const error = await failureOf(rejecting(new TypeError('Failed to fetch')), {
    isPageUnloading: () => true,
  });
  expect(error).toMatchObject({
    name: 'AbortError',
    message: 'request cancelled: the page is unloading',
  });
});

it('does not classify an unparseable 499 as unreachable', async () => {
  const error = await failureOf(async () => new Response('<html>', { status: 499 }));
  expect(error).toMatchObject({ status: 499, code: undefined, message: 'request failed (499)' });
});

it('prefers a parsed 5xx error string and drops a non-string code', async () => {
  const body = { error: 'down for maintenance', code: 7 };
  const error = await failureOf(async () => new Response(JSON.stringify(body), { status: 500 }));
  expect(error).toMatchObject({ status: 500, code: undefined, message: 'down for maintenance', body });
});
