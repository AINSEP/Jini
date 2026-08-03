import type { ReactNode } from 'react';

/**
 * @file The generic list table.
 *
 * ## Designed from the corpus, not from what a table component usually has
 *
 * This replaces 25 hand-rolled `<table>` blocks across one reference host, every one of which had
 * the identical skeleton — a `.table-scroll` wrapper, a `.list-table`, a `<thead>` of plain `<th>`,
 * and a `<tbody>` mapping rows — wrapped in a ternary that rendered an empty state instead when
 * there was nothing to show. That ternary is the single most duplicated thing in the corpus, which
 * is why `empty` and `loading` are this component's concern rather than each caller's.
 *
 * What the corpus did **not** contain is just as load-bearing:
 *
 * - **No sorting.** Zero of 25.
 * - **No pagination.** Zero of 25.
 * - **No row selection.** Zero of 25 — the checkboxes that appear inside some of those tables are
 *   field controls belonging to the row's own data, not a selection model.
 *
 * None of the three is implemented here. A table component that ships sorting nobody asked for has
 * to guess at comparator semantics, controlled-vs-uncontrolled state, and multi-column precedence,
 * and every one of those guesses becomes a compatibility obligation the moment it ships. When a
 * host needs sorting, it will arrive with a real requirement attached and can be added then —
 * additively, since `columns` is already a descriptor list with somewhere to put it.
 *
 * `<tfoot>` appeared exactly once, so it is an optional prop rather than part of the core shape.
 *
 * ## Row actions are not a feature
 *
 * An overflow menu in the last column is just a column whose `cell` renders one. There is no
 * `actions` prop, because there is nothing a dedicated one would do that a `cell` does not already
 * do — and having one would force a second, worse decision about where actions may appear.
 *
 * Three of the 25 gave that column an empty `<th>` carrying only an `aria-label`, which is the
 * right shape: a visible "More" heading is noise, and a nameless column header is a gap for anyone
 * navigating by column. `header` is therefore optional, and `headerLabel` names a headerless one.
 *
 * ## Styling contract
 *
 * Unstyled, like the rest of this flat-component set: `.table-scroll` and `.list-table` are
 * emitted for the host stylesheet to define. The wrapper is not decorative — `overflow-x: auto` on
 * it is what makes a wide table scroll instead of breaking the page, and it is also why `RowMenu`
 * portals its popup out to `document.body` rather than positioning inside this box.
 */

export interface DataTableColumn<Row> {
  /** Stable identity for this column. Not rendered — used as the React key. */
  key: string;
  /** Header content. Omit for a column that carries no visible heading (a row-actions column);
   *  supply {@link headerLabel} when you do, so the column is still named for assistive tech. */
  header?: ReactNode;
  /** Accessible name for a column whose `header` is omitted or purely visual. */
  headerLabel?: string;
  /** Renders one cell. Receives the row and its index. */
  cell: (row: Row, index: number) => ReactNode;
  /** Class on this column's `<th>`. */
  headerClassName?: string;
  /** Class on this column's `<td>`. A function receives the row, for per-row variation. */
  cellClassName?: string | ((row: Row, index: number) => string | undefined);
}

export interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: ReadonlyArray<DataTableColumn<Row>>;
  /** Stable React key per row. Required rather than defaulting to the index — an index key on a
   *  list that can reorder or delete is a well-known source of state landing on the wrong row, and
   *  every table in the corpus had a real id to hand. */
  rowKey: (row: Row, index: number) => string;
  /**
   * Rendered **instead of the table** when there are no rows and `loading` is false. Pass the
   * host's own empty-state markup. Omit it to render an empty `<tbody>` — appropriate when the
   * table is one part of a larger screen that explains the emptiness itself.
   */
  empty?: ReactNode;
  /** While true, `loadingContent` is rendered instead of the table (or an empty `<tbody>` if none
   *  is given). Takes precedence over `empty`, so a slow first fetch never flashes "nothing here"
   *  before the rows arrive — the bug that pattern produces in every list screen that gets it
   *  backwards. */
  loading?: boolean;
  loadingContent?: ReactNode;
  /** `<tfoot>` content. Rendered as-is: supply your own `<tr>`/`<td>`. */
  footer?: ReactNode;
  /** Accessible name for the table itself. Worth setting when a screen has more than one. */
  label?: string;
  /** `<caption>`. Visible unless the host's CSS hides it; prefer {@link label} for a name that
   *  should not paint. */
  caption?: ReactNode;
  /** Class per row, e.g. to mark a disabled or newly-created record. */
  rowClassName?: (row: Row, index: number) => string | undefined;
  /** Appended to `.list-table`. */
  className?: string;
  /** Appended to `.table-scroll`. */
  scrollClassName?: string;
}

function resolveCellClassName<Row>(
  column: DataTableColumn<Row>,
  row: Row,
  index: number,
): string | undefined {
  return typeof column.cellClassName === 'function'
    ? column.cellClassName(row, index)
    : column.cellClassName;
}

/**
 * @complexity O(rows × columns) per render — one pass, no sorting or grouping work.
 */
export function DataTable<Row>(props: DataTableProps<Row>) {
  // Loading wins over empty deliberately: `rows` is legitimately `[]` during a first fetch, and
  // checking emptiness first is what makes a list screen flash its empty state before the data
  // lands.
  if (props.loading && props.loadingContent !== undefined) return <>{props.loadingContent}</>;
  if (!props.loading && props.rows.length === 0 && props.empty !== undefined) return <>{props.empty}</>;

  return (
    <div className={['table-scroll', props.scrollClassName].filter(Boolean).join(' ')}>
      <table className={['list-table', props.className].filter(Boolean).join(' ')} aria-label={props.label}>
        {props.caption === undefined ? null : <caption>{props.caption}</caption>}
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.headerClassName}
                aria-label={column.header === undefined ? column.headerLabel : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={props.rowKey(row, index)} className={props.rowClassName?.(row, index)}>
              {props.columns.map((column) => (
                <td key={column.key} className={resolveCellClassName(column, row, index)}>
                  {column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {props.footer === undefined ? null : <tfoot>{props.footer}</tfoot>}
      </table>
    </div>
  );
}
