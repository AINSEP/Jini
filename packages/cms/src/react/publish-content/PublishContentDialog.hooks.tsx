import type { PublishReportRow } from "../../publish/content/ui/index.js";

import { overwriteTooltipFor, reportRowNote, reportRowPillClass } from "./hooks/publish-content-confirm.rules.js";

import { type Translate } from '@jini-ai/core/text';
type PublishContentConfirmView = {
  showOverwriteColumn: boolean;
  selectedKeys: ReadonlySet<string>;
  selectionEnabled: boolean;
  onToggleRow: (required: { key: string }) => void;
  carriedAlongKeys: ReadonlySet<string>;
  overwriteOfferKeys: ReadonlySet<string>;
  overwriteKeys: ReadonlySet<string>;
  onToggleOverwrite: (key: string) => void;
};

/** Render one report row in either the visible or up-to-date list. */
export function PublishContentReportRow({ row, view, t }: { row: PublishReportRow; view: PublishContentConfirmView; t: Translate }, _optional = {}) {
  const { showOverwriteColumn } = view;
  // One report row. Up-to-date rows fold behind one "N already up to date" row (owner 2026-09-26),
  // so this renders both halves of the list the hook splits.
  return (
    <tr data-entity-id={row.entityId} data-publish-disposition={row.disposition}>
      <td className="publish-content-select">
        {/* A row the run would not write carries NO control at all, not a disabled
            one: plan §4 task 11's property is that nothing in this dialog can move a
            skipped row into the set that gets published. */}
        {row.selectable && (
          <input
            type="checkbox"
            checked={view.selectedKeys.has(row.key)}
            disabled={!view.selectionEnabled}
            onChange={() => view.onToggleRow({ key: row.key })}
            // No `agentHandle` here: a handle must be lowercase words joined by
            // hyphens, and a row key is an entity id. The row's own
            // `data-entity-id` is the stable address instead — an agent (or a test)
            // finds the row, then the one checkbox inside it.
            data-publish-row-select=""
            aria-label={`${t("Publish")} ${row.entityType} ${row.entityLabel}`}
          />
        )}
        {/* Owner decision 2026-09-25 — media carried along with the pages/posts
            that use it: shown ticked while one of them is, and never clickable
            itself (it follows those rows, not the operator). */}
        {row.includedFor.length > 0 && (
          <input
            type="checkbox"
            checked={view.carriedAlongKeys.has(row.key)}
            disabled
            readOnly
            data-publish-row-carried=""
            aria-label={`${t("Publish")} ${row.entityType} ${row.entityLabel}`}
          />
        )}
      </td>
      <td>{t(row.entityTypeLabel)}</td>
      {/* A long label is cut off with an ellipsis (publish-content.css), so the
          hover shows the same label in full. The id stays on the row's
          `data-entity-id`, never in the tooltip (owner report 2026-09-26). */}
      <td title={row.entityLabel}>{row.entityLabel}</td>
      <td>
        <span className={reportRowPillClass(row)}>{t(row.dispositionLabel)}</span>
        {/* The reason sits under the status it explains — most rows have none, so a
            column of its own was mostly empty (owner 2026-09-26). */}
        {reportRowNote(row, t) && <span className="publish-content-reason">{reportRowNote(row, t)}</span>}
      </td>
      {showOverwriteColumn && (
        <td className="publish-content-overwrite">
          {/* Only an offered row (overwritable, or already ticked) carries this
              control — same "no affordance at all on a row it doesn't apply to" rule
              the select column follows above. */}
          {view.overwriteOfferKeys.has(row.key) && (
            <input
              type="checkbox"
              checked={view.overwriteKeys.has(row.key)}
              disabled={!view.selectionEnabled}
              onChange={() => view.onToggleOverwrite(row.key)}
              data-publish-row-overwrite=""
              aria-label={row.retiresLabel ? `${t("Overwrite on live")}: ${row.retiresLabel}` : t("Overwrite on live")}
              // R6 (`plan-publish-repoint-menus-2026-09-24.md` §2.7) — when the
              // retired holder still feeds a live menu, the tooltip names it too, so
              // an operator ticking "overwrite" can see what else moves with it. The
              // copy itself is built in the hooks file, not here — see
              // `overwriteTooltipFor`'s own doc.
              title={overwriteTooltipFor(row, t)}
            />
          )}
        </td>
      )}
    </tr>
  );

}
