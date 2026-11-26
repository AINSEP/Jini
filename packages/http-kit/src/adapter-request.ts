import type { Request, Response } from 'express';
import { payloadTooLargeError, statusForError, type RouteInputContext, type ServerApiError } from '@jini-ai/core/contracts/server';
import { rawInput } from './request.js';
import { sendApiError } from './response.js';
import type { JsonRoutePorts, JsonRouteSpec, RouteMountOptions, RouteRequestOptIns } from './types.js';

/**
 * A spec that opts into request facts needs the host's resolver: refusing at mount means a missing
 * port is a boot failure, never a route that silently runs without the client address.
 * @throws When `spec.requestFacts` is set and `spec.ports.requestFacts` is not.
 */
export function assertRequestFactsPort({ spec }: { readonly spec: Pick<RouteRequestOptIns, 'requestFacts'> & { readonly path: string; readonly ports?: { readonly requestFacts?: unknown } | undefined } }, _optional: Record<string, never> = {}): void {
  if (spec.requestFacts && !spec.ports?.requestFacts) throw new Error(`route ${spec.path} opts into requestFacts but no requestFacts port is mounted`);
}

/**
 * The deps one request runs with: the host's `requestDeps` binding (`RouteMountOptions`) evaluated for
 * this request, or the mounted deps unchanged when the mount declared none.
 * @complexity O(1) plus the host binding.
 */
export function requestScopedDeps<Deps>({ req, res, deps }: { readonly req: Request; readonly res: Response; readonly deps: Deps }, { requestDeps }: Pick<RouteMountOptions<Deps>, 'requestDeps'> = {}): Deps {
  return requestDeps ? requestDeps({ req, res, deps }) : deps;
}

/**
 * The spec's `admittedResponseHeaders` for this request, called right after the workspace port: only an
 * admitted request carries them, so the workspace refusal (a throw from that port) never does.
 * Synchronous, so a mount without a workspace port keeps its tick order (adapter-pins.test.ts).
 * @complexity O(h) in the header count.
 */
export function applyAdmittedResponseHeaders({ res, raw, spec }: {
  readonly res: Response; readonly raw: RouteInputContext; readonly spec: Pick<RouteRequestOptIns, 'admittedResponseHeaders'>;
}, _optional: Record<string, never> = {}): void {
  if (spec.admittedResponseHeaders) applyResponseHeaders({ res, headers: spec.admittedResponseHeaders(raw) });
}

/** Sets static or reply headers; a no-op without any, so a route that declares none writes nothing extra.
 *  `Vary` is appended (Express `res.vary`), never overwritten: a host middleware may already vary the
 *  answer (dev CORS adds `Origin`), and replacing it would let a cache serve one origin's answer to another. */
export function applyResponseHeaders({ res, headers }: { readonly res: Response; readonly headers: Readonly<Record<string, string>> | undefined }, _optional: Record<string, never> = {}): void {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'vary') res.vary(value);
    else res.setHeader(name, value);
  }
}

/**
 * The route's `RouteInputContext` with only the opt-ins its spec declared: `raw.headers` for
 * `readHeaders`, `raw.facts` (resolved by the host port, with `req` and `deps`) for `requestFacts`.
 * Synchronous, so the gates after it keep their tick order.
 */
export function routeRequestInput<Deps, Context>({ req, spec, deps }: {
  readonly req: Request;
  readonly spec: Pick<RouteRequestOptIns, 'readHeaders' | 'requestFacts'> & { readonly ports?: JsonRoutePorts<Deps, Context> | undefined };
  readonly deps: Deps;
}, _optional: Record<string, never> = {}): RouteInputContext {
  const facts = spec.requestFacts ? spec.ports?.requestFacts?.({ req, deps }) : undefined;
  return rawInput({ req }, { ...(spec.readHeaders === undefined ? {} : { headers: spec.readHeaders }), ...(facts === undefined ? {} : { facts }) });
}

/** UTF-8 size of a body the host's parser already read: the bytes themselves, or its JSON re-serialization. */
function parsedBodyBytes(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (body instanceof Uint8Array) return body.byteLength;
  return new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).byteLength;
}

/**
 * Enforces the spec's `maxBodyBytes`, answering 413 with core's plain-words refusal when exceeded.
 * Why here and not in the parser: the host's `express.json()` already read the body with its own,
 * usually larger, limit, and a second parser skips a parsed body — so without this check the
 * route's declared ceiling was silently lost. The body is measured re-serialized, the same bytes
 * core's `jsonRoute` limits when mounted behind `node-bridge`, so both mount paths agree. A spec
 * cap above the host parser's limit is effectively clamped to it: the parser refuses first.
 * GET/HEAD are exempt, as in core.
 * The host's `ports.payloadTooLarge`, when mounted, writes the 413 instead of core's envelope.
 * @returns `false` when the refusal was written and the route must stop.
 * @complexity O(n) in the body size for the re-serialization; only when a cap is declared.
 */
export function allowRouteBody({ req, res, spec }: {
  readonly req: Request;
  readonly res: Response;
  readonly spec: Pick<JsonRouteSpec<unknown, unknown, unknown>, 'maxBodyBytes'> & { readonly ports?: { readonly payloadTooLarge?: JsonRoutePorts<unknown>['payloadTooLarge'] } | undefined };
}, _optional: Record<string, never> = {}): boolean {
  const refusal = routeBodyRefusal({ req, spec });
  if (!refusal) return true;
  writeBodyRefusal({ res, spec, refusal });
  return false;
}

/** A body over the spec's cap: the ceiling it broke and core's refusal for it. */
interface BodyRefusal { readonly maxBytes: number; readonly error: ServerApiError }

/** The body-cap decision of {@link allowRouteBody} without the write, so reporter mode can end the
 *  operation before the 413 goes out. `undefined` admits the request. */
export function routeBodyRefusal({ req, spec }: { readonly req: Request; readonly spec: Pick<JsonRouteSpec<unknown, unknown, unknown>, 'maxBodyBytes'> }): BodyRefusal | undefined {
  const maxBytes = spec.maxBodyBytes;
  if (maxBytes === undefined || req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (parsedBodyBytes(req.body) <= maxBytes) return undefined;
  return { maxBytes, error: payloadTooLargeError({ maxBytes }) };
}

/** Writes a body-cap refusal: the host's own 413 body when `ports.payloadTooLarge` is mounted (its
 *  admin client reads it); absent, core's envelope is unchanged. */
export function writeBodyRefusal({ res, spec, refusal }: {
  readonly res: Response;
  readonly spec: { readonly ports?: { readonly payloadTooLarge?: JsonRoutePorts<unknown>['payloadTooLarge'] } | undefined };
  readonly refusal: BodyRefusal;
}): void {
  // The host's own 413 body (its admin client reads it); absent, core's envelope below is unchanged.
  if (spec.ports?.payloadTooLarge) {
    spec.ports.payloadTooLarge({ res, maxBytes: refusal.maxBytes });
    return;
  }
  sendApiError({ res, status: statusForError({ error: refusal.error }), error: refusal.error });
}

