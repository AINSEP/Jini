/**
 * @file The rule orderings both `RedirectRepoPort` adapters apply (`repo.ts` on SQL, `repo.memory.ts`
 * in memory). One module so the two adapters cannot drift: the shared contract suite
 * (`repo.contract.test.ts`) only checks the cases it seeds, while every comparator arm is pinned
 * here directly (`order.test.ts`).
 */
import type { RedirectRecord } from "./types.js";

/**
 * Shared tie-break between rules that match equally well: higher `priority` first, then the more
 * recent `updatedAt` (falling back to `createdAt` when `updatedAt` is empty), then `id` ascending.
 * Returns 0 only for the same id, as a sort comparator must.
 */
export function compareTieBreak({ a, b }: { a: RedirectRecord; b: RedirectRecord }, _optional: Record<string, never> = {}): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const aRecency = a.updatedAt || a.createdAt;
  const bRecency = b.updatedAt || b.createdAt;
  if (aRecency !== bRecency) return aRecency > bRecency ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Longest pattern first, then the shared tie-break (`lookupLongestPrefix`, `listDynamic`). */
export function compareLongestFirst({ a, b }: { a: RedirectRecord; b: RedirectRecord }, _optional: Record<string, never> = {}): number {
  return b.fromPattern.length - a.fromPattern.length || compareTieBreak({ a, b }, {});
}

/**
 * `findByFromPattern`'s order among active rules sharing one `fromPattern`: an `exact` rule before
 * any other match type, then `id` ascending.
 */
export function compareSamePatternExactFirst({ a, b }: { a: RedirectRecord; b: RedirectRecord }, _optional: Record<string, never> = {}): number {
  return (a.matchType === "exact" ? 0 : 1) - (b.matchType === "exact" ? 0 : 1) || (a.id < b.id ? -1 : 1);
}
