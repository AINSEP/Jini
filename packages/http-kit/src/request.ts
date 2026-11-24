/**
 * Request-side normalization: turns a raw Express `Request` into the framework-independent
 * `RouteInputContext` the rest of the module operates on.
 */
import type { Request } from 'express';
import type { RouteInputContext, RouteRequestFacts } from '@jini-ai/core/contracts/server';

/**
 * Extracts `body`/`query`/`params` from an Express `Request` into a `RouteInputContext`, so a
 * route's `parse` function can be unit-tested without constructing a real `Request`. `headers` names
 * the request headers to hand over (`raw.headers`, lower-cased keys, absent ones left out) and `facts`
 * the host-resolved request facts (`raw.facts`); without them neither key exists.
 */
export function rawInput({ req }: { readonly req: Request }, { headers, facts }: { readonly headers?: readonly string[]; readonly facts?: RouteRequestFacts } = {}): RouteInputContext {
  return {
    body: req.body,
    query: (req.query ?? {}) as Record<string, unknown>,
    params: (req.params ?? {}) as Record<string, string>,
    ...(headers === undefined ? {} : { headers: pickHeaders({ req, names: headers }) }),
    ...(facts === undefined ? {} : { facts }),
  };
}

/** The named request headers, keyed lower-case; a repeated header is comma-joined as HTTP folds it. */
function pickHeaders({ req, names }: { readonly req: Pick<Request, 'headers'>; readonly names: readonly string[] }): Readonly<Record<string, string>> {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const key = name.toLowerCase();
    const value = req.headers?.[key];
    if (value !== undefined) picked[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return picked;
}
