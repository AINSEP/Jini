/**
 * @module @jini-ai/mcp/server/loopback-fetch
 * A `fetch`-shaped client for the loopback daemon over `node:http`, with no timeout of its own.
 * Global `fetch` (undici) gives up when response headers take over 300 000 ms, which ends a tool call
 * that waits on a person. Here only the caller's `AbortSignal` ends a request. Any other URL goes to
 * `fallback` (default: the global `fetch`, read per call). No new dependency.
 */
import { request } from 'node:http';
import { Readable } from 'node:stream';
import { isLoopbackHostname } from '@jini-ai/core/net';

/** A response with one of these statuses has no body; `Response` refuses to be built with one. */
const hasNoBody = ({ status }: { status: number }): boolean => [101, 204, 205, 304].includes(status);

function toUrl({ input }: { input: Parameters<typeof fetch>[0] }): URL {
  return new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
}

function sendOverHttp({ url, init }: { url: URL; init: RequestInit }): Promise<Response> {
  const { signal } = init;
  if (typeof init.body !== 'string' && init.body != null) throw new TypeError('loopback fetch sends only string bodies');
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const outgoing = request(url, { method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), ...(signal ? { signal } : {}) }, incoming => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) for (const item of [value ?? []].flat()) headers.append(name, item);
      const status = incoming.statusCode ?? 502;
      const body = hasNoBody({ status }) ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
      resolve(new Response(body, { status, statusText: incoming.statusMessage ?? '', headers }));
    });
    // Same rejections as `fetch`: the signal's reason on abort, else 'fetch failed' carrying the socket error as its cause.
    outgoing.on('error', error => reject(signal?.aborted ? signal.reason : new TypeError('fetch failed', { cause: error })));
    outgoing.end(init.body ?? undefined);
  });
}

/** @returns A fetch that reaches an `http:` loopback URL without a header wait and hands every other URL to `fallback`. */
export function createLoopbackFetch(_required: Record<string, never> = {}, { fallback }: { fallback?: typeof fetch } = {}): typeof fetch {
  return (input, init = {}) => {
    const url = toUrl({ input });
    if (url.protocol !== 'http:' || !isLoopbackHostname({ hostname: url.hostname })) return (fallback ?? fetch)(input, init);
    return sendOverHttp({ url, init });
  };
}
