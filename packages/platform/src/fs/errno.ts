/** The string `code` of a Node system error (`ENOENT`, `EEXIST`, ...), or undefined for anything else.
 *  @complexity O(1). */
export function errorCodeOf({ error }: { error: unknown }, _optional: Record<string, never> = {}): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** Returns `fallback` when `matches(error)` and rethrows anything else, so an expected failure reads
 *  `catch (error) { return fallbackIf(error, isExpected, undefined); }`. @complexity O(matches). */
// With the (required, optional = {}) args shape that call is spelled
// `fallbackIf({ error, matches: isExpected, fallback: undefined })`.
export function fallbackIf<T>({ error, matches, fallback }: { error: unknown; matches: (error: unknown) => boolean; fallback: T }, _optional: Record<string, never> = {}): T {
  if (matches(error)) return fallback;
  throw error;
}

/** {@link fallbackIf} for a missing entry (ENOENT). @complexity O(1). */
export function fallbackIfMissing<T>({ error, fallback }: { error: unknown; fallback: T }, _optional: Record<string, never> = {}): T {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
  throw error;
}
