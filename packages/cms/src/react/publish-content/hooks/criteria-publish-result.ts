import { rowPublishesWithSelection, selectableRowKeys, type PublishReportRow } from "../../../publish/content/ui/report-rows.js";
import type { CriteriaSelection, PublishRequestResult } from "../../../publish/content/ui/criteria.js";

/**
 * A `skipped` row, named with its reason; `null` for any other row. `toPublishReportRows` gives every
 * skipped row a reason (its own MISSING_REASON fallback when the peer sent none), so a skipped row's
 * `reason` is never null here.
 */
function leftAloneEntry({ row }: { row: PublishReportRow }, _options: Record<string, never> = {}): { label: string; reason: string } | null {
  if (row.disposition !== "skipped") return null;
  if (row.reason === null || row.reason === undefined) throw new Error(`skipped publish item ${row.entityLabel} has no reason`);
  return { label: row.entityLabel, reason: row.reason };
}

/**
 * S2 — what `props.onPlanned` is called with: the SAME `rows`/`selection` the dialog itself renders
 * from, so a chat/WebMCP caller's report can never disagree with what the operator sees on screen.
 *
 * `willOverwrite` is a subset of `willPublish`, not a separate list: a `forced` row is also a row
 * that will be published (plan §2's own `PublishRequestResult` doc says as much — "what would be
 * published or overwritten"), it just publishes BY overwriting. `leftAlone` only ever names a
 * `skipped` row — an `unchanged` row isn't "left alone" by the criteria, it was already a no-op
 * before any criteria existed.
 *
 * @complexity O(rows).
 */
export function buildCriteriaPublishResult({ rows, selection, siteLabel, nextStep }: { rows: readonly PublishReportRow[]; selection: CriteriaSelection; siteLabel: string | null; nextStep: string }, _options: Record<string, never> = {}
): PublishRequestResult {
  const willPublish: string[] = [];
  const willOverwrite: string[] = [];
  const leftAlone: { label: string; reason: string }[] = [];
  const selected = new Set(selectableRowKeys({ rows }).filter((key) => !selection.deselectedKeys.has(key)));
  for (const row of rows) {
    // A carried-along media row publishes with the pages/posts that use it (`rowPublishesWithSelection`).
    if (rowPublishesWithSelection({ row, selected })) {
      willPublish.push(row.entityLabel);
      if (row.outcome === "forced") willOverwrite.push(row.entityLabel);
      continue;
    }
    const left = leftAloneEntry({ row });
    if (left) leftAlone.push(left);
  }
  return {
    opened: true,
    planned: true,
    site: siteLabel,
    willPublish,
    willOverwrite,
    leftAlone,
    unmatchedItems: selection.unmatchedItems,
    unknownTypes: selection.unknownTypes,
    nextStep,
  };
}
