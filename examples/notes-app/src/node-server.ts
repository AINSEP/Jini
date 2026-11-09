/**
 * @file Plain Node `http` adapter for `@jini-ai/core/contracts/server`'s `Server` contract.
 *
 * Jini ships the contract as types only; path matching and dispatch are server code, so they are
 * the host's and live here. A Jini package never names a concrete server, so this adapter stays
 * host code rather than a Jini gap.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Server, ServerHandler, ServerMethod } from '@jini-ai/core/contracts/server';

interface Route {
  readonly method: ServerMethod;
  readonly path: string;
  readonly handler: ServerHandler;
}

/**
 * Matches a registered `pattern` (e.g. `/notes/:id`) against a URL `pathname`, with the path
 * syntax the `Server` contract defines. Returns the decoded `:name` params on a match, or `null`.
 * Segment counts must be equal; a trailing slash is not ignored. Literal segments compare against
 * the pathname as given (still percent-encoded). A param segment never matches an empty segment,
 * and one whose percent-encoding is malformed does not match.
 */
export function matchServerPath(
  { pattern, pathname }: { readonly pattern: string; readonly pathname: string },
  _optional: Record<string, never> = {},
): Record<string, string> | null {
  const expected = pattern.split('/');
  const actual = pathname.split('/');
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index] ?? '';
    const got = actual[index] ?? '';
    if (want.startsWith(':')) {
      if (got === '') return null;
      try {
        params[want.slice(1)] = decodeURIComponent(got);
      } catch {
        return null;
      }
    } else if (want !== got) {
      return null;
    }
  }
  return params;
}

export interface NodeServer extends Server {
  listen(required: { port: number; host?: string }): Promise<{ port: number }>;
  close(): Promise<void>;
}

function toRequest(
  { incoming, origin, signal }: { incoming: IncomingMessage; origin: string; signal: AbortSignal },
  _optional: Record<string, never> = {},
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = incoming.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(new URL(incoming.url ?? '/', origin), {
    method,
    headers,
    signal,
    ...(hasBody ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
  } as RequestInit);
}

async function writeResponse({ response, out }: { response: Response; out: ServerResponse }, _optional: Record<string, never> = {}): Promise<void> {
  out.statusCode = response.status;
  response.headers.forEach((value, name) => out.setHeader(name, value));
  if (!response.body) {
    out.end();
    return;
  }
  out.flushHeaders();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) out.write(chunk);
  out.end();
}

function plain({ status, text }: { status: number; text: string }, { headers = {} }: { headers?: Record<string, string> } = {}): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } });
}

export function createNodeServer(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): NodeServer {
  const routes: Route[] = [];
  let http: HttpServer | undefined;

  async function dispatch(incoming: IncomingMessage, out: ServerResponse): Promise<void> {
    const abort = new AbortController();
    out.on('close', () => { if (!out.writableFinished) abort.abort(); });
    const request = toRequest({ incoming, origin: `http://${incoming.headers.host ?? 'localhost'}`, signal: abort.signal });
    const pathname = new URL(request.url).pathname;
    // One scan: every route whose path matches, kept for both the method pick and the 405's Allow.
    const matched: { route: Route; params: Record<string, string> }[] = [];
    for (const route of routes) {
      const params = matchServerPath({ pattern: route.path, pathname });
      if (params) matched.push({ route, params });
    }
    if (matched.length === 0) {
      await writeResponse({ response: plain({ status: 404, text: 'Not Found' }), out });
      return;
    }
    const isHead = request.method === 'HEAD';
    // A HEAD with no HEAD route is answered by the GET route, per the contract's ServerMethod note.
    const hit = matched.find((m) => m.route.method === request.method)
      ?? (isHead ? matched.find((m) => m.route.method === 'GET') : undefined);
    if (!hit) {
      const allow = new Set(matched.map((m) => m.route.method));
      if (allow.has('GET')) allow.add('HEAD');
      await writeResponse({ response: plain({ status: 405, text: 'Method Not Allowed' }, { headers: { allow: [...allow].join(', ') } }), out });
      return;
    }
    const address = incoming.socket.remoteAddress;
    const response = await hit.route.handler({ request, params: hit.params, ...(address ? { client: { address } } : {}) });
    if (isHead) await response.body?.cancel();
    await writeResponse({ response: isHead ? new Response(null, { status: response.status, headers: response.headers }) : response, out });
  }

  return {
    route({ method, path, handler }) {
      if (routes.some((r) => r.method === method && r.path === path)) {
        throw new Error(`node-server: route ${method} ${path} is already registered`);
      }
      routes.push({ method, path, handler });
    },
    listen({ port, host = '127.0.0.1' }) {
      http = createServer((incoming, out) => {
        dispatch(incoming, out).catch((error: unknown) => {
          console.error('node-server: handler failed', error);
          if (!out.headersSent) writeResponse({ response: plain({ status: 500, text: 'Internal Server Error' }), out }).catch(() => out.destroy());
          else out.destroy();
        });
      });
      const server = http;
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolve({ port: typeof address === 'object' && address ? address.port : port });
        });
      });
    },
    close() {
      const server = http;
      if (!server) return Promise.resolve();
      return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
