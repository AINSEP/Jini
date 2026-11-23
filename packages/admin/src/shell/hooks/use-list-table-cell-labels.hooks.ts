import { useEffect } from "react";

const DATA_LABEL = "data-label";

/**
 * @file Column labels for `.list-table` body cells, so the phone card layout can name each value
 * (mobile catalog P-4, 2026-10-06). On narrow screens `styles.css` turns every `.list-table` row
 * into a stacked card and hides the header row, which leaves bare values like "3" or "0" with
 * nothing saying they are "Fields" or "Hits". About fifteen screens render `.list-table` by hand
 * (there is no shared table component), so instead of threading a `data-label` through each one,
 * the admin shell copies every header cell's text onto its column's body cells as `data-label`,
 * and the card CSS prints it with `attr(data-label)`. Desktop ignores the attribute entirely.
 */

/** Sort glyphs the sortable headers append to their text — not part of the column's name. */
const SORT_GLYPHS = /[⇅▲▼↑↓]/g;

function headerLabels(table: HTMLTableElement): string[] {
  const row = table.tHead?.rows[0];
  if (!row) return [];
  const labels: string[] = [];
  for (const th of Array.from(row.cells)) {
    // Tooltip descriptions and icons are help, not the column title printed on cards.
    const title = th.cloneNode(true) as HTMLTableCellElement;
    title.querySelectorAll('.info-tip, [role="tooltip"], [hidden], [aria-hidden="true"]')
      .forEach((help) => help.remove());
    // An element's `textContent` is never null (only a document's or doctype's is), so no "" fallback.
    const text = (th.getAttribute(DATA_LABEL) ?? title.textContent).replace(SORT_GLYPHS, "").trim();
    for (let i = 0; i < th.colSpan; i += 1) labels.push(text);
  }
  return labels;
}

function labelRow(row: HTMLTableRowElement, labels: readonly string[]): void {
  let column = 0;
  for (const cell of Array.from(row.cells)) {
    // A spanning cell (an empty-state or inline detail row) belongs to no single column.
    const label = cell.colSpan === 1 ? (labels[column] ?? "") : "";
    if (label && cell.getAttribute(DATA_LABEL) !== label) cell.setAttribute(DATA_LABEL, label);
    if (!label && cell.hasAttribute(DATA_LABEL)) cell.removeAttribute(DATA_LABEL);
    column += cell.colSpan;
  }
}

/**
 * Labels every `.list-table` body cell under `root` with its column header's text.
 *
 * @complexity O(cells) under `root`.
 */
export function labelListTableCells({ root, tableSelector }: { root: ParentNode; tableSelector: string }, _options: Record<string, never> = {}): void {
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>(tableSelector))) {
    const labels = headerLabels(table);
    if (labels.length === 0) continue;
    for (const body of Array.from(table.tBodies)) {
      for (const row of Array.from(body.rows)) labelRow(row, labels);
    }
  }
}

/**
 * Keeps {@link labelListTableCells} current for everything rendered inside `root` (the admin's
 * `<main>`). Watches child-list/text changes only — the attribute writes it makes itself are not
 * observed, so it cannot loop. MutationObserver already delivers one batched callback per
 * microtask checkpoint, so a burst (typing in an editor) costs one pass, not one per node; no
 * `requestAnimationFrame` on top, because rAF never fires in a background tab and the labels
 * would silently stop updating there.
 */
export function useListTableCellLabels(
  { root, tableSelector }: { root: HTMLElement | null; /** The host's list-table selector (its markup). */ tableSelector: string },
  _options = {},
): void {
  useEffect(() => {
    if (!root) return undefined;
    labelListTableCells({ root, tableSelector });
    const observer = new MutationObserver(() => labelListTableCells({ root, tableSelector }));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [root, tableSelector]);
}
