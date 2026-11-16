/**
 * Request-side normalization: turns a raw Express `Request` into the framework-independent
 * `RouteInputContext` the rest of the module operates on.
 */
import type { Request } from 'express';
import type { RouteInputContext } from '@jini-ai/core/contracts/server';

/**
 * Extracts `body`/`query`/`params` from an Express `Request` into a `RouteInputContext`, so a
 * route's `parse` function can be unit-tested without constructing a real `Request`.
 */
export function rawInput({ req }: { readonly req: Request }, _optional: Record<string, never> = {}): RouteInputContext {
  return {
    body: req.body,
    query: (req.query ?? {}) as Record<string, unknown>,
    params: (req.params ?? {}) as Record<string, string>,
  };
}
