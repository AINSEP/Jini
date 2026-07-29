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
export function rawInput(req: Request): RouteInputContext {
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
export function validationError(
  message: string,
  issues: Pick<ApiValidationIssue, 'path' | 'message'>[] = [],
): ApiError {
  if (issues.length === 0) {
    return createApiError('BAD_REQUEST', message);
  }
  return createApiError('BAD_REQUEST', message, {
    details: { kind: 'validation', issues } as unknown as NonNullable<ApiError['details']>,
  });
}
