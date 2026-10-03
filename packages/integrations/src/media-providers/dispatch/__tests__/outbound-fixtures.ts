import type { HttpClientPort, HttpRequest } from '@jini-ai/core/primitives';
import type { createNodeGuardedHttpPorts } from '@jini-ai/platform/http/guarded';

export const testPinnedRequests: HttpRequest[] = [];

/** Existing wire/parser tests keep their fetch doubles beneath the real policy client.
 * This is a deterministic transport fixture, never a production egress implementation.
 */
export function testNodeGuardedHttpPorts(): ReturnType<typeof createNodeGuardedHttpPorts> {
  return {
    dns: { resolve: async () => ['93.184.216.34'] },
    clock: { nowMs: () => Date.now(), timeoutSignal: ({ timeoutMs }) => AbortSignal.timeout(timeoutMs) },
    transport: { requestPinned: async ({ request }) => {
      testPinnedRequests.push(request);
      const response = await globalThis.fetch(request.url, {
        method: request.method, headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        redirect: 'error',
      });
      const bodyBytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()),
        bodyText: Buffer.from(bodyBytes).toString('utf8'), bodyBytes };
    } },
  };
}

/** Raw fetch doubles in the persistence tests sit at the injected trusted port boundary. */
export function testHttpClient(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): HttpClientPort {
  return { send: async ({ request }, optional = {}) => {
    const response = await fetchImpl(request.url, {
      method: request.method, headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: request.signal ?? AbortSignal.timeout(request.totalDeadlineMs ?? request.timeoutMs ?? request.idleTimeoutMs!),
      redirect: optional.redirect ?? 'error',
    });
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()),
      bodyText: Buffer.from(bodyBytes).toString('utf8'), bodyBytes };
  } };
}
