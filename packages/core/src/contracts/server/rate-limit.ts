/**
 * @file The request rate-limiting port a route consumer calls. The fixed-window implementation
 * (clock, counter store, eviction) stays in `@jini-ai/http-kit/rate-limit`; only the interface a
 * caller depends on lives here, so packages that merely *check* a budget (comments, forms) need no
 * dependency on the HTTP toolkit.
 */

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

// Each allowed check consumes its budget immediately; there is no separate commit step.
// size is an eviction diagnostic, not a capability a request consumer needs.
export interface RateLimiter {
  /** Resolves the budget decision; rejects missing, non-string or empty keys with TypeError. */
  check(required: { key: string }): Promise<RateLimitResult>;
  size(required: Record<string, never>): Promise<number>;
}
