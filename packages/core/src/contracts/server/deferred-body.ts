/**
 * @file The deferred request body of a raw route: a handler that must refuse an unauthorized request
 * WITHOUT reading its body (an upload, a form post) asks for the body only after its own gates, through
 * `readBody`, instead of a host parser registered ahead of the mount reading it first. Neutral: the host
 * adapter backs the reader with its own parser; a route sees only these shapes.
 */
import type { RouteInputContext } from './json-route.js';

/**
 * What to read. `raw`: the bytes of a request whose media type matches `mediaType` (e.g. `application/zip`).
 * `urlencoded`: a flat form (`a=1&b=2`, no nested keys; a repeated key gives its values in order) of an
 * `application/x-www-form-urlencoded` request.
 * `limit` is the byte ceiling. A compressed body (`Content-Encoding` other than identity) is never unzipped:
 * it is refused as `unsupported-encoding`.
 */
export type RouteBodyReadOptions =
  | { readonly type: 'raw'; readonly mediaType: string; readonly limit: number }
  | { readonly type: 'urlencoded'; readonly limit: number };

/**
 * Why a body could not be read. `media-type`: the request has no body, or its media type is not the one
 * asked for (nothing was read). `too-large`: over `limit` (which it carries). `unsupported-encoding`: a
 * compressed body. `malformed`: the bytes did not parse. `aborted`: the client stopped sending.
 * `size-mismatch`: the body did not match its `Content-Length`. `unreadable`: any other read failure.
 * `incompatible-read`: the stream was already consumed by an earlier read of this request that asked
 * for different options (another parser, media type or limit), so this read cannot be answered; only
 * a call with the first call's exact options reuses its outcome.
 */
export type RouteBodyRefusal =
  | { readonly reason: 'too-large'; readonly limit: number }
  | { readonly reason: 'media-type' | 'unsupported-encoding' | 'malformed' | 'aborted' | 'size-mismatch' | 'unreadable' | 'incompatible-read' };

/** A flat urlencoded form: each field's value, or its values in order when the key repeats. */
export type RouteFormFields = Readonly<Record<string, string | readonly string[]>>;

/** A body read's outcome: the bytes (`raw`) or the flat form (`urlencoded`), or why it was refused. */
export type RouteBodyRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: RouteBodyRefusal };

/**
 * Reads the request body once, on demand. Method syntax keeps the overloads; the stream is consumed once,
 * so a later call with options identical to the first answers what the first read, and a later call with
 * different options is refused as `incompatible-read`.
 */
export interface RouteBodyReader {
  (options: Extract<RouteBodyReadOptions, { type: 'raw' }>): Promise<RouteBodyRead<Uint8Array>>;
  (options: Extract<RouteBodyReadOptions, { type: 'urlencoded' }>): Promise<RouteBodyRead<RouteFormFields>>;
}

/** A raw route's input: the parsed request context plus the deferred body reader. */
export interface RawRouteInputContext extends RouteInputContext {
  readonly readBody: RouteBodyReader;
}
