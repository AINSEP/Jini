/**
 * @file The counter arithmetic behind `scripts/verify-find-in-page.ts`'s live checks — parsing the
 * find bar's `"N of M"` counter and deciding which ordinal Enter / Shift+Enter / a raw follow-up
 * find must land on. Pure, so the expectations the live run asserts against are themselves tested
 * here; the live run (a real Electron app driven by Playwright) is opt-in and not part of `npm test`.
 */

/** The find bar's `"N of M"` counter, parsed. */
interface Count {
  ordinal: number;
  total: number;
}

/** `"3 of 17"` -> `{ ordinal: 3, total: 17 }`; anything else -> `null` (no result, or "No results"). */
export function parseCount({ text }: { text: string | null | undefined }, _optional = {}): Count | null {
  const match = /^(\d+) of (\d+)$/.exec((text ?? "").trim());
  return match ? { ordinal: Number(match[1]), total: Number(match[2]) } : null;
}

/** The ordinal one forward `find` should land on from `count`, wrapping `total -> 1`; `null` when
 *  there was no count to advance from. */
export function nextOrdinal({ count }: { count: Count | null }, _optional = {}): number | null {
  return count === null ? null : (count.ordinal % count.total) + 1;
}

/** The ordinal one backward (Shift+Enter) step should land on from `count`, wrapping `1 -> total`;
 *  `null` when there was no count to step back from. */
export function previousOrdinal({ count }: { count: Count | null }, _optional = {}): number | null {
  return count === null ? null : ((count.ordinal - 2 + count.total) % count.total) + 1;
}

/** Every step is `previous + 1`, wrapping `total -> 1`. */
export function advancesEveryStep({ start, steps, total }: { start: number; steps: readonly (Count | null)[]; total: number }, _optional = {}): boolean {
  let expected = start;
  return steps.every((step) => {
    expected = (expected % total) + 1;
    return step !== null && step.ordinal === expected && step.total === total;
  });
}

export type { Count };
