const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from `now` until `until`, floored at 0.
 *
 * Floored rather than allowed to go negative because the list already excludes expired rows: a
 * negative number could only come from clock skew, and "-3 days left" reads as a bug rather than as
 * "this is overdue".
 *
 * @complexity O(1).
 */
export function daysRemaining({ now, until }: { now: string; until: string }, _optional: Record<string, never> = {}): number {
  const ms = new Date(until).getTime() - new Date(now).getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

