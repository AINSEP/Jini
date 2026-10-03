/**
 * Request-side normalization: turns a raw Express `Request` into the framework-independent
 * `RouteInputContext` the rest of the module operates on, and builds a standard `BAD_REQUEST`
 * `ApiError` for validation failures.
 */
import type { Request } from 'express';
import { createApiError, type ApiError, type ApiValidationIssue } from '@jini-ai/protocol';
import type { RouteInputContext } from './types.js';

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

/**
 * Builds a `BAD_REQUEST` `ApiError` for a failed parse. When `issues` is non-empty, attaches
 * them as structured validation details so clients can render per-field errors.
 */
export function validationError({ message }: { readonly message: string }, { issues = [] }: { readonly issues?: Pick<ApiValidationIssue, 'path' | 'message'>[] | undefined } = {}
): ApiError {
  if (issues.length === 0) {
    return createApiError({ code: 'BAD_REQUEST', message: message });
  }
  return createApiError({ code: 'BAD_REQUEST', message: message }, {
    details: { kind: 'validation', issues } as unknown as NonNullable<ApiError['details']>,
  });
}
