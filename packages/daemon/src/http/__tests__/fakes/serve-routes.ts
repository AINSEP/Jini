/**
 * @file Sends requests to a route list without a socket. A test states the list and the request and
 * reads the answer; the exact-match rules of core's in-memory server apply (the Express spellings
 * are the Node bridge's job, pinned by the characterization tests). Not published.
 */
import type { ServerRoute } from '@jini-ai/core/contracts/server';
import { createInMemoryServer } from '@jini-ai/core/contracts/server/testing';

/** Mounts `routes` on an in-memory server and returns its `fetch`. */
export function serveRoutes({ routes }: { readonly routes: readonly ServerRoute[] }, _optional: Record<string, never> = {}): (request: Request) => Promise<Response> {
  const { server, fetch } = createInMemoryServer();
  for (const route of routes) server.route(route);
  return fetch;
}

/** A JSON request to `http://local<path>`. */
export function jsonRequest({ path, method = 'GET' }: { readonly path: string; readonly method?: string }, { body }: { readonly body?: unknown } = {}): Request {
  const init: RequestInit = { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) };
  return new Request(`http://local${path}`, init);
}
