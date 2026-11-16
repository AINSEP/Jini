/**
 * @file In-memory `Server` for tests: routes registered on it are dispatched with a web `Request`,
 * no socket involved.
 */
import type { RequestWithOriginHeaders } from '../../origin-validation.js';
import type { TimingSafeByteComparison } from '../../token.js';
import type { Server } from '../server.js';
import type { RouteHostContext } from './json-route.js';
import type { SameOriginPolicyPort } from './origin.js';
import { createRouteTable } from './route-table.js';

/** Every request passes. For route tests whose subject is not origin policy. */
export const allowAllOrigins: SameOriginPolicyPort = Object.freeze({ isSameOrigin: () => true });

/** Every request is refused, so a route's 403 path runs with core's real FORBIDDEN answer. */
export const denyAllOrigins: SameOriginPolicyPort = Object.freeze({ isSameOrigin: () => false });

/** An origin policy whose verdict a test can flip, recording each request it was asked about. */
export interface RecordingOriginPolicy extends SameOriginPolicyPort {
  readonly calls: RequestWithOriginHeaders[];
  set(required: { readonly allow: boolean }, optional?: Record<string, never>): void;
}

/** Creates a recording origin policy. It allows every request until `set({ allow: false })`. */
export function createRecordingOriginPolicy(_required = {}, optional: { readonly allow?: boolean } = {}): RecordingOriginPolicy {
  let allow = optional.allow ?? true;
  const calls: RequestWithOriginHeaders[] = [];
  return {
    calls,
    set: ({ allow: next }) => { allow = next; },
    isSameOrigin: ({ req }) => { calls.push(req); return allow; },
  };
}

/** A constant-time comparison port that records every pair it was asked to compare. */
export interface RecordingTimingSafeEqual extends TimingSafeByteComparison {
  readonly calls: ReadonlyArray<{ readonly left: Uint8Array; readonly right: Uint8Array }>;
}

/**
 * A byte-by-byte equality that records its calls. A gate that replaces the injected comparison with
 * `===` never calls it, so a test asserting `calls` fails; one that calls it with unequal lengths
 * breaks the real `timingSafeEqual` contract, which this fake also refuses by throwing like Node does.
 */
export function fakeTimingSafeEqual(_required = {}, _optional: Record<string, never> = {}): RecordingTimingSafeEqual {
  const calls: Array<{ left: Uint8Array; right: Uint8Array }> = [];
  const compare: TimingSafeByteComparison = ({ left, right }) => {
    calls.push({ left, right });
    if (left.length !== right.length) throw new RangeError('Input buffers must have the same byte length');
    return left.every((byte, index) => byte === right[index]);
  };
  return Object.assign(compare, { calls });
}

/** A RouteHostContext for tests. It allows every origin unless a policy is passed. */
export function createTestRouteHost(_required = {}, optional: { readonly originPolicy?: SameOriginPolicyPort; readonly onInternalError?: RouteHostContext['onInternalError'] } = {}): RouteHostContext {
  const { originPolicy = allowAllOrigins, onInternalError } = optional;
  return onInternalError ? { originPolicy, onInternalError } : { originPolicy };
}

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
