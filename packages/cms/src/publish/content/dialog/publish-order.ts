import type { PublishReportRow, PublishRowDisposition } from "./report-rows.js";

/**
 * @file The one display order every list of publishable content uses (owner rule, 2026-09-26):
 * what WILL be published comes first, A–Z; then what can't be published yet, A–Z; then what is
 * already up to date, A–Z.
 *
 * Display only. Nothing here touches what a run writes, the plan it confirms, or the keys a
 * selection is sent back as — callers sort a copy of rows they already derived, never the report
 * the planner returned (which stays in `dependsOn` apply order, see `report-rows.ts`).
 *
 * "A–Z" is by the label the operator reads, compared case-insensitively and locale-aware
 * (`sensitivity: "base"`, `numeric: true`, so "Page 2" sorts before "Page 10").
 */

/** Which band an item sorts into. Lower sorts first. */
export type PublishOrderGroup = "publish" | "blocked" | "current";

const GROUP_RANK: Readonly<Record<PublishOrderGroup, number>> = { publish: 0, blocked: 1, current: 2 };

const GROUP_BY_DISPOSITION: Readonly<Record<PublishRowDisposition, PublishOrderGroup>> = {
  publish: "publish",
  skipped: "blocked",
  unchanged: "current",
};

/** What the comparator needs to know about one item. `tieBreak` only settles two items that read
 *  the same, so the order never depends on the input order. */
export interface PublishOrderKey {
  readonly group: PublishOrderGroup;
  readonly label: string;
  readonly tieBreak?: string;
}

/**
 * A collator for `locale`, falling back to the runtime default when the tag is malformed rather than
 * throwing a `RangeError` into a render.
 *
 * @complexity O(1).
 */
function collatorFor({ locale }: { locale: string | undefined }, _optional = {}): Intl.Collator {
  const options: Intl.CollatorOptions = { sensitivity: "base", numeric: true };
  try {
    return new Intl.Collator(locale, options);
  } catch {
    return new Intl.Collator(undefined, options);
  }
}

/**
 * The shared comparator: group first, then label A–Z, then `tieBreak`.
 *
 * @complexity O(1) per comparison (plus the label length).
 */
export function publishOrderComparator<T>({ locale, keyOf }: { locale: string | undefined; keyOf: (item: T) => PublishOrderKey }, _optional = {}): (a: T, b: T) => number {
  const collator = collatorFor({ locale });
  return (a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    const byGroup = GROUP_RANK[ka.group] - GROUP_RANK[kb.group];
    if (byGroup !== 0) return byGroup;
    const byLabel = collator.compare(ka.label, kb.label);
    if (byLabel !== 0) return byLabel;
    const ta = ka.tieBreak ?? "";
    const tb = kb.tieBreak ?? "";
    if (ta < tb) return -1;
    return ta > tb ? 1 : 0;
  };
}

/**
 * The report rows in display order — a sorted copy; `rows` is left as it was.
 *
 * @complexity O(n log n).
 */
export function sortPublishReportRows({ rows, locale }: { rows: readonly PublishReportRow[]; locale: string | undefined }, _optional = {}): readonly PublishReportRow[] {
  return [...rows].sort(
    publishOrderComparator<PublishReportRow>({ locale, keyOf: (row) => ({
      group: GROUP_BY_DISPOSITION[row.disposition],
      label: row.entityLabel,
      tieBreak: `${row.entityTypeLabel}\u0000${row.key}`,
    }) })
  );
}
