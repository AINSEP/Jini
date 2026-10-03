import type { RequestHandler } from 'express';

/** Host response wording and envelope, evaluated only for an oversized body. */
export type ErrorResponseFactory = (required: { maxBytes: number; bodyBytes: number }) => unknown;

export interface BodySizeLimitRequired {
  readonly maxBytes: number;
  readonly errorResponseFactory: ErrorResponseFactory;
}

export type BodySizeLimitOptional = Record<string, never>;

// A second express.json({ limit }) silently skips a body already parsed upstream, so it cannot
// tighten a route's limit. Re-measure the serialized bytes here; the upstream parser must still
// bound initial allocation. Reject before next() so an oversized body never reaches a write.
/**
 * Enforces a route-specific UTF-8 byte ceiling on already-parsed JSON.
 * Mount after the host JSON parser, whose allocation ceiling remains necessary.
 * Null and undefined preserve the original empty-object serialization fallback.
 * @param required - Byte ceiling and required host error-response wording.
 * @returns Express middleware; oversized requests receive 413 without next().
 */
export function rejectOversizedJsonBody(
  { maxBytes, errorResponseFactory }: BodySizeLimitRequired,
  _optional: BodySizeLimitOptional = {},
): RequestHandler {
  return (req, res, next) => {
    const bodyBytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8');
    if (bodyBytes > maxBytes) {
      res.status(413).json(errorResponseFactory({ maxBytes, bodyBytes }));
      return;
    }
    next();
  };
}
