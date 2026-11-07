/**
 * @file Plain Node `http` adapter for `@jini-ai/core/server`'s `Server` contract.
 *
 * Jini ships the contract and the path matcher, not an adapter, so this file is the app's own.
 * GAP: a neutral Node `http` adapter (IncomingMessage -> Request, Response -> ServerResponse)
 * is generic code every Node host will write again; it belongs next to the contract.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { matchServerPath, type Server, type ServerHandler, type ServerMethod } from '@jini-ai/core/server';

interface Route {
  readonly method: ServerMethod;
  readonly path: string;
  readonly handler: ServerHandler;
}

export interface NodeServer extends Server {
  listen(required: { port: number; host?: string }): Promise<{ port: number }>;
  close(): Promise<void>;
}

function toRequest(incoming: IncomingMessage, origin: string, signal: AbortSignal): Request {
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

async function writeResponse(response: Response, out: ServerResponse): Promise<void> {
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

function plain(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } });
}

export function createNodeServer(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): NodeServer {
  const routes: Route[] = [];
  let http: HttpServer | undefined;

  async function dispatch(incoming: IncomingMessage, out: ServerResponse): Promise<void> {
    const abort = new AbortController();
    out.on('close', () => { if (!out.writableFinished) abort.abort(); });
    const request = toRequest(incoming, `http://${incoming.headers.host ?? 'localhost'}`, abort.signal);
    const pathname = new URL(request.url).pathname;
    let pathMatched = false;
    for (const route of routes) {
      const params = matchServerPath({ pattern: route.path, pathname });
      if (!params) continue;
      pathMatched = true;
      if (route.method !== request.method) continue;
      await writeResponse(await route.handler({ request, params }), out);
      return;
    }
    if (pathMatched) {
      const allow = routes.filter((r) => matchServerPath({ pattern: r.path, pathname })).map((r) => r.method).join(', ');
      await writeResponse(plain(405, 'Method Not Allowed', { allow }), out);
      return;
    }
    await writeResponse(plain(404, 'Not Found'), out);
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
          if (!out.headersSent) writeResponse(plain(500, 'Internal Server Error'), out).catch(() => out.destroy());
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
