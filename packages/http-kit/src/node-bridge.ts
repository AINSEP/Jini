/**
 * @file Serves a `Server` route table from Node's `http` request/response objects. This is the
 * only code a host adapter needs: plain `node:http` calls `handle` with no `next`; an Express (4 or
 * 5) host mounts `handle` as one middleware and passes `next`, so unmatched requests and handler
 * errors fall through to the host's own routes and error handler. Express's `req`/`res` ARE Node's
 * `IncomingMessage`/`ServerResponse`, which is why moving the host to Express 5 changes nothing here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { inspect } from 'node:util';
import { redactSecrets } from '@jini-ai/core';
import type { Server } from '@jini-ai/core/contracts/server';
import { createRouteTable } from './server-port.js';

/** Optional per-request hints from a host framework that already touched the request. */
export interface NodeDispatchOptions {
  /** Hand unmatched requests (`next()`) and handler failures (`next(error)`) to the host. */
  readonly next?: (error?: unknown) => void;
  /** `scheme://host` for `Request.url`; a host behind a trusted proxy passes its own view. Defaults to `http://<Host header>`. */
  readonly origin?: string;
  /**
   * The body an upstream parser already produced (Express: `req.body`). Used only when that
   * parser has consumed the stream: a `Buffer`/`Uint8Array` is passed on byte for byte, a string
   * as text, anything else as JSON. Without this, a converted route behind a blanket
   * `express.json()` would see an empty body.
   */
  readonly parsedBody?: unknown;
}

export interface NodeDispatcher {
  /** Register routes here; they are served by `handle`. */
  readonly server: Server;
  /** Serves one request. Never rejects: every failure is answered or handed to `next(error)`. */
  handle(requiredArgs: { readonly incoming: IncomingMessage; readonly out: ServerResponse }, optionalArgs?: NodeDispatchOptions): Promise<void>;
}

function consumedBody(parsedBody: unknown): Uint8Array | string | null {
  if (parsedBody === undefined || parsedBody === null) return null;
  if (parsedBody instanceof Uint8Array) return new Uint8Array(parsedBody);
  if (typeof parsedBody === 'string') return parsedBody;
  return JSON.stringify(parsedBody);
}

function toWebRequest({ incoming, url, signal, parsedBody }: { incoming: IncomingMessage; url: URL; signal: AbortSignal; parsedBody: unknown }): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    // Node gives a repeated header as an array; each value becomes its own entry.
    for (const item of [value].flat()) if (item !== undefined) headers.append(name, item);
  }
  const method = incoming.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers, signal });
  // An upstream parser has drained the socket; rebuild from what it produced, not from the empty stream.
  const body = incoming.readableEnded ? consumedBody(parsedBody) : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
  // `duplex` is required by Node's fetch for a stream body but missing from the DOM RequestInit type.
  const init: RequestInit & { duplex: 'half' } = { method, headers, signal, body, duplex: 'half' };
  return new Request(url, init);
}

async function writeWebResponse({ response, out, headOnly }: { response: Response; out: ServerResponse; headOnly: boolean }): Promise<void> {
  out.statusCode = response.status;
  // Set-Cookie cannot be comma-joined (cookie dates contain commas), so each one gets its own line.
  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') out.setHeader(name, value);
  });
  for (const cookie of cookies) out.appendHeader('set-cookie', cookie);
  if (!response.body || headOnly) {
    await response.body?.cancel();
    out.end();
    return;
  }
  // Headers first, so a streamed (SSE) response reaches the client before its first event.
  out.flushHeaders();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(value);
  }
  out.end();
}

function plainText({ status, text }: { status: number; text: string }, { headers = {} }: { headers?: Record<string, string> } = {}): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } });
}

// Exceptions can echo credentials; inspect keeps stack and code, then the shared redactor runs (as adapter.ts does).
function writeUnhandledToStderr(error: unknown): void {
  process.stderr.write(`[@jini-ai/http-kit] route handler failed: ${redactSecrets({ input: inspect(error) }, { redactPii: false })}\n`);
}

/**
 * Creates a dispatcher with an empty route table.
 * @param optional.onUnhandledError - Where a handler failure goes when no `next` was given (default: redacted, to stderr).
 */
export function createNodeDispatcher(
  _required: Record<string, never> = {},
  { onUnhandledError = writeUnhandledToStderr }: { readonly onUnhandledError?: (error: unknown) => void } = {},
): NodeDispatcher {
  const table = createRouteTable();
  return {
    server: { route: (route) => table.route(route) },
    async handle({ incoming, out }, { next, origin, parsedBody } = {}) {
      const url = new URL(incoming.url ?? '/', origin ?? `http://${incoming.headers.host ?? 'localhost'}`);
      const method = incoming.method ?? 'GET';
      const match = table.match({ method, pathname: url.pathname });
      if (match.kind !== 'route') {
        if (next) {
          next();
          return;
        }
        const response = match.kind === 'not-found'
          ? plainText({ status: 404, text: 'Not Found' })
          : plainText({ status: 405, text: 'Method Not Allowed' }, { headers: { allow: match.allow.join(', ') } });
        await writeWebResponse({ response, out, headOnly: method === 'HEAD' }).catch(() => { out.destroy(); });
        return;
      }
      // A client that hangs up aborts `request.signal`, which is how a handler or stream notices.
      const abort = new AbortController();
      const onClose = () => { if (!out.writableFinished) abort.abort(); };
      out.on('close', onClose);
      const address = incoming.socket?.remoteAddress;
      let response: Response;
      try {
        const request = toWebRequest({ incoming, url, signal: abort.signal, parsedBody });
        response = await match.route.handler({ request, params: match.params, locals: {}, ...(address ? { client: { address } } : {}) });
      } catch (error) {
        out.off('close', onClose);
        if (next) {
          next(error);
          return;
        }
        onUnhandledError(error);
        await writeWebResponse({ response: plainText({ status: 500, text: 'The server could not finish this request.' }), out, headOnly: false })
          .catch(() => { out.destroy(); });
        return;
      }
      try {
        await writeWebResponse({ response, out, headOnly: method === 'HEAD' });
      } catch (error) {
        // Headers are already on the wire, so no error page can follow: cut the connection so the
        // client sees a failed response instead of a silently truncated one.
        onUnhandledError(error);
        out.destroy();
      } finally {
        out.off('close', onClose);
      }
    },
  };
}
