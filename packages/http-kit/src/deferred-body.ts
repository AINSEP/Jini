/**
 * @file The Express side of a raw route's deferred body (`raw.readBody`, `@jini-ai/core/contracts/server`
 * `RouteBodyReader`): the host's own `express.raw` / `express.urlencoded` parser, run only when the
 * handler asks — after the route's gates — so no unauthorized request gets its body read. The parser is
 * Express's, so its limit, 413 and encoding refusal are exactly what a parser registered ahead of the
 * route answered; only the moment of reading moves.
 */
import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { RouteBodyRead, RouteBodyReader, RouteBodyReadOptions, RouteBodyRefusal } from '@jini-ai/core/contracts/server';

const URLENCODED = 'application/x-www-form-urlencoded';

/** body-parser's error `type` -> the neutral refusal; any other failure is `unreadable`. */
const REFUSAL_BY_PARSER_TYPE: Readonly<Record<string, RouteBodyRefusal['reason']>> = {
  'encoding.unsupported': 'unsupported-encoding',
  'entity.parse.failed': 'malformed',
  'request.aborted': 'aborted',
  'request.size.invalid': 'size-mismatch',
};

/** The neutral refusal for a parser error; `too-large` carries the parser's own byte limit. @complexity O(1). */
function refusalFor({ error, limit }: { readonly error: unknown; readonly limit: number }): RouteBodyRefusal {
  const { type, limit: parserLimit } = (error ?? {}) as { type?: unknown; limit?: unknown };
  if (type === 'entity.too.large') return { reason: 'too-large', limit: typeof parserLimit === 'number' ? parserLimit : limit };
  return { reason: (typeof type === 'string' ? REFUSAL_BY_PARSER_TYPE[type] : undefined) ?? 'unreadable' };
}

/**
 * The parser for one read. Never inflates: a compressed body is refused (`unsupported-encoding`), the
 * owner's 2026-11-14 rule for every body this package reads. A form is flat (`extended: false`).
 * @complexity O(1).
 */
function parserFor(options: RouteBodyReadOptions): RequestHandler {
  if (options.type === 'raw') return express.raw({ type: options.mediaType, limit: options.limit, inflate: false });
  return express.urlencoded({ type: URLENCODED, extended: false, limit: options.limit, inflate: false });
}

/** Whether the parsed `req.body` is the kind the read asked for. @complexity O(1). */
function isReadValue({ options, body }: { readonly options: RouteBodyReadOptions; readonly body: unknown }): boolean {
  if (options.type === 'raw') return Buffer.isBuffer(body);
  return typeof body === 'object' && body !== null && !Buffer.isBuffer(body);
}

/**
 * One read: the media-type check (`req.is`, the same test the parser applies, which also answers no body
 * as a mismatch), then the parser. A body a parser registered ahead of the route already read is left as
 * that parser left it — the read only reports it.
 * @complexity O(n) in the body bytes, bounded by `limit`.
 */
async function readOnce({ req, res, options }: { readonly req: Request; readonly res: Response; readonly options: RouteBodyReadOptions }): Promise<RouteBodyRead<unknown>> {
  if (!req.is(options.type === 'raw' ? options.mediaType : URLENCODED)) return { ok: false, refusal: { reason: 'media-type' } };
  const parse = parserFor(options);
  const error = await new Promise<unknown>((resolve) => parse(req, res, (failure?: unknown) => resolve(failure)));
  if (error) return { ok: false, refusal: refusalFor({ error, limit: options.limit }) };
  const body: unknown = req.body;
  if (!isReadValue({ options, body })) return { ok: false, refusal: { reason: 'media-type' } };
  return { ok: true, value: body };
}

/**
 * The `readBody` a raw route's handler receives. Nothing is read until it is called; the request stream
 * is consumed once, so a later call answers the first call's outcome whatever options it passes.
 * @complexity O(1) to build; each request at most one parse.
 */
export function deferredBodyReader({ req, res }: { readonly req: Request; readonly res: Response }, _optional: Record<string, never> = {}): RouteBodyReader {
  let first: Promise<RouteBodyRead<unknown>> | undefined;
  const read = (options: RouteBodyReadOptions) => (first ??= readOnce({ req, res, options }));
  return read as RouteBodyReader;
}
