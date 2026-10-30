/** The string `code` of a Node system error (`ENOENT`, `EEXIST`, ...), or undefined for anything else.
 *  @complexity O(1). */
export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** Returns `fallback` when `matches(error)` and rethrows anything else, so an expected failure reads
 *  `catch (error) { return fallbackIf(error, isExpected, undefined); }`. @complexity O(matches). */
export function fallbackIf<T>(error: unknown, matches: (error: unknown) => boolean, fallback: T): T {
  if (matches(error)) return fallback;
  throw error;
}

/** {@link fallbackIf} for a missing entry (ENOENT). @complexity O(1). */
export function fallbackIfMissing<T>(error: unknown, fallback: T): T {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
  throw error;
}
