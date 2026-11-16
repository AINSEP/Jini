/**
 * @file In-memory `Server` for tests: routes registered on it are dispatched with a web `Request`,
 * no socket involved.
 */
import type { Server } from '../server.js';
import { createRouteTable } from './route-table.js';

/** An in-memory server and the way to send it a request. */
export interface InMemoryServer {
  readonly server: Server;
  fetch(request: Request, optional?: { client?: { readonly address: string }; locals?: Record<string, unknown> }): Promise<Response>;
}

const plain = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify({ error: { code: status === 404 ? 'NOT_FOUND' : 'METHOD_NOT_ALLOWED', message: status === 404 ? 'No route matches this address.' : 'This address does not accept this method.' } }), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

/** Creates an empty in-memory server. Unmatched requests answer 404, or 405 with `allow` when only the method differs. */
export function createInMemoryServer(_required = {}, _optional: Record<string, never> = {}): InMemoryServer {
  const table = createRouteTable();
  return {
    server: table,
    async fetch(request, { client, locals } = {}) {
      const found = table.match({ method: request.method, pathname: new URL(request.url).pathname });
      if (found.kind === 'not-found') return plain(404);
      if (found.kind === 'method-not-allowed') return plain(405, { allow: found.allow.join(', ') });
      const response = await found.route.handler({ request, params: found.params, ...(client ? { client } : {}), ...(locals ? { locals } : {}) });
      return request.method === 'HEAD' ? headResponse(response) : response;
    },
  };
}

/** HEAD drops the GET body; cancelling it stops its producer (an SSE stream's keepalive and subscription). */
async function headResponse(response: Response): Promise<Response> {
  await response.body?.cancel();
  return new Response(null, { status: response.status, headers: response.headers });
}
