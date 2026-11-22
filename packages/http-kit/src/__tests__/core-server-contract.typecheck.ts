/** Compile-time pins: core restates the wire error shape and the host context structurally, so
 * these must stay mutually assignable with their protocol-side twins. */
import type { ServerApiError, ServerValidationIssue, ReportRouteInternalError, RateLimiter } from '@jini-ai/core/contracts/server';
import type { ApiError, ApiValidationIssue } from '@jini-ai/protocol';
import { reportRouteInternalError } from '../internal-error.js';
import { createRateLimiter } from '../rate-limit.js';

export const apiErrorToCore: ServerApiError = {} as ApiError;
export const coreToApiError: ApiError = {} as ServerApiError;
export const reporterFits = reportRouteInternalError satisfies ReportRouteInternalError;
export const issueToCore: ServerValidationIssue = {} as Pick<ApiValidationIssue, 'path' | 'message'>;
export const coreToIssue: Pick<ApiValidationIssue, 'path' | 'message'> = {} as ServerValidationIssue;

/** The limiter interface moved to core; the shape callers rely on (checks consume budget, `size` is a diagnostic) is pinned structurally. */
interface PinnedRateLimiter {
  check(required: { key: string }): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
  size(required: Record<string, never>): Promise<number>;
}
export const limiterFromHttpKit = createRateLimiter satisfies (...args: never[]) => RateLimiter;
export const pinnedToCore: RateLimiter = {} as PinnedRateLimiter;
export const coreToPinned: PinnedRateLimiter = {} as RateLimiter;
