/**
 * @file The kit's own assertion: the conformance kit must run under any test runner (vitest,
 * node:test, jest), so it cannot import one runner's `expect`. A thrown Error fails a test in all.
 */

export class SearchConformanceError extends Error {
  constructor(message: string) {
    super(`search conformance: ${message}`);
    this.name = 'SearchConformanceError';
  }
}

/**
 * Positional rather than the house `(required, optional)` object: a TypeScript `asserts` predicate
 * can only name a parameter, and narrowing after a check is what keeps the kit's cases readable.
 * @throws {SearchConformanceError} with `message` when `condition` is falsy.
 */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SearchConformanceError(message);
}
