/**
 * @file The reply envelope a JSON route's handler returns when the answer needs more than a JSON
 * body at the spec's `successStatus`: its own status (429), response headers (`Retry-After`, `ETag`),
 * or no body at all (a bare 204/304). Any other handler value keeps the ordinary JSON answer, so a
 * route opts in per answer by returning `routeReply(...)` instead of a plain value.
 */

// `Symbol.for`, not `Symbol()`: a host can load two copies of this module (a linked dist next to an
// installed one), and a per-copy symbol would make one copy's reply look like an ordinary value to the other.
const ROUTE_REPLY: unique symbol = Symbol.for('@jini-ai/core/contracts/server/route-reply');

/** A handler's explicit answer: status, optional headers, and a JSON body or none (`body` absent). */
export interface RouteReply<Body = unknown> {
  readonly [ROUTE_REPLY]: true;
  readonly status: number;
  readonly body?: Body;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Builds a frozen, branded reply. Omit `body` for an empty answer: the adapter then writes a bare
 * `send()` (no content type, no `null`), which is what a 204 or 304 must be.
 * @complexity O(1).
 */
export function routeReply<Body = never>({ status, body, headers }: { readonly status: number; readonly body?: Body; readonly headers?: Readonly<Record<string, string>> }, _optional: Record<string, never> = {}): RouteReply<Body> {
  const reply = { status, ...(body === undefined ? {} : { body }), ...(headers === undefined ? {} : { headers }) };
  // The brand is a non-enumerable symbol: it never reaches a JSON serialization or a structural `toEqual`.
  Object.defineProperty(reply, ROUTE_REPLY, { value: true });
  return Object.freeze(reply) as RouteReply<Body>;
}

/** True only for a value built by `routeReply`; a plain object shaped like one stays an ordinary value. */
export function isRouteReply(value: unknown, _optional: Record<string, never> = {}): value is RouteReply {
  return typeof value === 'object' && value !== null && (value as { readonly [ROUTE_REPLY]?: unknown })[ROUTE_REPLY] === true;
}
