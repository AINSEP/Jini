import type { PublishReportRow } from "../../../publish/content/ui/index.js";
import type { Translate } from "@jini-ai/core/text";

/**
 * The overwrite checkbox's `title` — `plan-publish-repoint-menus-2026-09-24.md` §2.7/R6: when the
 * retired holder still feeds a live menu, the tooltip names it too, so an operator ticking
 * "overwrite" can see what else moves with it. `undefined` for a row with no `retires` target at all
 * (`PublishContentDialog.tsx` only renders this control for an offered row in the first place, but
 * the function stays defensive rather than assuming that holds).
 *
 * @complexity O(n) in `referencedByLabels.length` for the join; O(1) otherwise.
 */
export function overwriteTooltipFor(
  row: Pick<PublishReportRow, "retiresLabel" | "referencedByLabels">,
  t: Translate
): string | undefined {
  if (!row.retiresLabel) return undefined;
  const base = `${row.retiresLabel} ${t("moves to")} ${t("Trash")}`;
  if (row.referencedByLabels.length === 0) return base;
  return `${base}. ${t("Menu links follow:")} ${row.referencedByLabels.join(", ")}`;
}

/**
 * The line a row shows under its status (owner 2026-09-26: no mostly-empty "Why" column) — a
 * carried-along row's "Used by …" note, else the row's reason. `null` adds nothing under the pill.
 *
 * @complexity O(1).
 */
export function reportRowNote(row: Pick<PublishReportRow, "usedByNote" | "reason">, t: Translate): string | null {
  if (row.usedByNote) return t(row.usedByNote);
  return row.reason ? row.reason : null;
}

/** Maps a row's disposition to the `.status-*` pill `styles.css` already defines, so the table
 *  reads the same as every other status column in the app in both themes. */
const DISPOSITION_PILL_CLASS = {
  publish: "status status-active",
  unchanged: "status status-draft",
  skipped: "status status-warning",
} as const;

/**
 * The status pill's class: the disposition's, except an update that trashes the item on live
 * (2026-09-26), which takes the app's own Trash styling so it never reads as an ordinary publish.
 *
 * @complexity O(1).
 */
export function reportRowPillClass(row: Pick<PublishReportRow, "disposition" | "trashes">): string {
  return row.trashes ? "status status-trashed" : DISPOSITION_PILL_CLASS[row.disposition];
}

