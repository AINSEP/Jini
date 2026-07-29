/**
 * Same-origin security guard: wraps `isLocalSameOrigin` in the module's `Result` pipeline so
 * the Adapter can treat an origin failure the same as a parse/handle failure.
 */
import type { Request } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { isLocalSameOrigin } from './origin-validation.js';
import { err, ok, type Result } from './types.js';

/** The subset of server startup state `guardSameOrigin` needs: the resolved local port. */
export interface OriginContext {
  resolvedPortRef: { current: number };
}

/**
 * Wraps `isLocalSameOrigin` so the HTTP Adapter can fold the origin decision into the same
 * error-handling pipeline as parse/handle failures.
 */
export function guardSameOrigin(req: Request, origin: OriginContext): Result<void> {
  if (isLocalSameOrigin(req, origin.resolvedPortRef.current)) {
    return ok(undefined);
  }
  return err(createApiError('FORBIDDEN', 'cross-origin request rejected'));
}
