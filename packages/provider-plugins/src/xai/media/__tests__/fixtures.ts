import type { HttpClientPort } from '@jini-ai/core/primitives';

/** A trusted-port double: the wire request goes to `fetchImpl`, bypassing DNS and sockets (tests never dial out). */
export function testHttpClient(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): HttpClientPort {
  return { send: async ({ request }, optional = {}) => {
    const response = await fetchImpl(request.url, {
      method: request.method, headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body as BodyInit }),
      signal: request.signal ?? AbortSignal.timeout(request.totalDeadlineMs ?? request.timeoutMs ?? request.idleTimeoutMs!),
      redirect: optional.redirect ?? 'error',
    });
    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()),
      bodyText: Buffer.from(bodyBytes).toString('utf8'), bodyBytes };
  } };
}
