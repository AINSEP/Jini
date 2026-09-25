import type { ReactNode } from 'react';

import type { DataTableSortDirection, DataTableSortState } from '../../core/data-table/types.js';

/**
 * @file The admin list table.
 *
 * ## Designed from the corpus, not from what a table component usually has
 *
 * This replaces 25 hand-rolled `<table>` blocks across one reference admin, every one of which had
 * the identical skeleton — a `.table-scroll` wrapper, a `.list-table`, a `<thead>` of plain `<th>`,
 * and a `<tbody>` mapping rows — wrapped in a ternary that rendered an empty state instead when
 * there was nothing to show. That ternary is the single most duplicated thing in the corpus, which
 * is why `empty` and `loading` are this component's concern rather than each caller's.
 *
 * What the corpus did **not** contain is just as load-bearing:
 *
 * - **No pagination.** Zero of 25.
 * - **No row selection.** Zero of 25 — the checkboxes that appear inside some of those tables are
 *   field controls belonging to the row's own data, not a selection model.
 *
 * Pagination and row selection stay cut for the same reason sorting originally was: nobody in the
 * corpus asked for either, and guessing at their shape (page-size defaults, single- vs. multi-select)
 * would be a compatibility obligation nobody has paid for yet.
 *
 * ## Sorting (added once two hosts needed it)
 *
 * Sorting **did** ship — this component's own history is the case study for the plan above. Posts
 * and Pages both hand-rolled an identical click-to-sort header (a button, a caret, an `aria-label`
 * carrying the accessible state) because this component had nowhere to put it, and more screens were
 * about to make it a third and fourth copy. The three guesses the original cut worried about each
 * resolved to something concrete once real callers existed:
 *
 * - **Comparator semantics** — a column that wants to sort supplies
 *   {@link DataTableColumnSort.compare}, an ascending-order comparator exactly like `Array#sort`'s
 *   own contract. `DataTable` negates it for `"desc"` rather than taking two functions — a column's
 *   ordering is one relation, not two.
 * - **Controlled vs. uncontrolled** — controlled, via {@link DataTableProps.sort} and
 *   {@link DataTableProps.onSortChange}. `DataTable` holds no sort state of its own: direction is
 *   transient view state the owning screen already held before this existed, and centralizing the
 *   comparator/caret/`aria-sort` plumbing does not change who owns that state.
 * - **Multi-column precedence** — not built. Exactly one column sorts at a time: activating a
 *   different sortable column's header replaces the active one outright; activating the same
 *   column's header again toggles its direction. Nobody asked for combined multi-column sort.
 *
 * A column that omits {@link DataTableColumn.sort} renders its `<th>` exactly as it always has — no
 * button, no caret, no `aria-sort` — so every existing caller that never mentions sorting sees no
 * change at all.
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
 * Unstyled, like everything in this layer: `.table-scroll` and `.list-table` are emitted for the
 * host stylesheet to define. The wrapper is not decorative — `overflow-x: auto` on it is what makes
 * a wide table scroll instead of breaking the page, and it is also why `RowMenu` portals its popup
 * out to `document.body` rather than positioning inside this box.
 */

// `DataTableSortDirection`/`DataTableSortState` are defined in `core/data-table/types.ts` (plain
// data, no React) and re-exported here so existing consumers of this file keep working unchanged.
export type { DataTableSortDirection, DataTableSortState };

/** Enables click-to-sort on one column (`DataTableColumn.sort`). Everything a host needs to decide
 *  is here; `DataTable` only wires the click, renders the caret, and sets `aria-sort`. */
export interface DataTableColumnSort<Row> {
  /** Ascending-order comparator, exactly like `Array#sort`'s own contract. `DataTable` negates its
   *  result when the active direction is `"desc"` rather than asking for a second function — a
   *  column's ordering is one relation, not two. Reach for `Date.parse` on an ISO-8601 **text**
   *  column (never a plain string compare — that breaks the moment a non-`Z` UTC-offset value shows
   *  up) and `localeCompare` for free text. */
  compare: (a: Row, b: Row) => number;
  /** Direction this column starts at the first time it becomes active — a click while a DIFFERENT
   *  column was active, or the first sort of a session. Defaults to `"asc"`; override for a column
   *  whose natural first read runs the other way, e.g. a date column's "newest first". Has no effect
   *  on the same column's own toggle, which always flips. */
  defaultDirection?: DataTableSortDirection;
  /** This column's accessible name for every sort state — `direction` is `null` when a different
   *  column is currently active. State the current state and what activating the control does next;
   *  `DataTable` does not synthesize this from `header`, since `header` may be arbitrary markup with
   *  no reliable plain-text form. */
  label: (direction: DataTableSortDirection | null) => string;
}

export interface DataTableColumn<Row> {
  /** Stable identity for this column. Not rendered — used as the React key, and as the `column`
   *  value in {@link DataTableSortState} when this column is sortable. */
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
  /** Makes this column's header clickable to sort. Omit for a column that never sorts — its `<th>`
   *  renders exactly as it always has, with no button, no caret, and no `aria-sort`. */
  sort?: DataTableColumnSort<Row>;
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
  /**
   * Controlled sort state: the active column's `key` plus direction, or `null`/`undefined` for "no
   * column is the active sort". `DataTable` never derives or persists this itself — sort direction
   * is transient view state the owning screen already held before this existed; centralizing the
   * comparator/caret/`aria-sort` plumbing here does not change who owns that state.
   */
  sort?: DataTableSortState | null;
  /**
   * Called with the state a header click produces. Activating a different sortable column's header
   * replaces `sort` outright (single active column — no multi-column precedence); activating the
   * already-active column's header toggles its direction. `DataTable` computes the next value; the
   * host only stores it and passes it back as `sort`.
   */
  onSortChange?: (next: DataTableSortState) => void;
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
 * `rows` in display order: unchanged when there is no active sort, or the active column declares no
 * `sort` of its own (defensive against a stale `sort.column` naming a column that no longer exists,
 * or never did). A fresh array is only allocated on the path that actually sorts, so the 20+ callers
 * with no `sort` prop at all pay nothing beyond the `Array#find`.
 *
 * @complexity O(columns) to find the active column, plus O(n log n) in `rows.length` when it has a
 * comparator; O(1)/no allocation otherwise.
 */
function sortedTableRows<Row>(
  rows: readonly Row[],
  columns: ReadonlyArray<DataTableColumn<Row>>,
  sort: DataTableSortState | null | undefined,
): readonly Row[] {
  const activeColumn = sort ? columns.find((column) => column.key === sort.column) : undefined;
  if (!sort || !activeColumn?.sort) return rows;
  const sign = sort.direction === 'asc' ? 1 : -1;
  const { compare } = activeColumn.sort;
  return [...rows].sort((a, b) => sign * compare(a, b));
}

/**
 * The sort state a click on `column`'s header produces: toggles direction when `column` is already
 * active, otherwise switches to it at its own {@link DataTableColumnSort.defaultDirection}.
 *
 * @complexity Time/space: O(1).
 */
function nextSortState<Row>(
  current: DataTableSortState | null | undefined,
  column: DataTableColumn<Row>,
): DataTableSortState {
  if (current?.column === column.key) {
    return { column: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { column: column.key, direction: column.sort?.defaultDirection ?? 'asc' };
}

/** The `aria-sort` value for a sortable `<th>` — the APG table-sorting pattern's `"none"` for a
 *  sortable-but-currently-inactive column, so assistive tech still discovers it is sortable. */
function ariaSortValue(direction: DataTableSortDirection | null): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending';
  if (direction === 'desc') return 'descending';
  return 'none';
}

/** The caret glyph for a sortable header. `"⇅"` — a neutral, always-visible both-direction glyph —
 *  when `direction` is `null` (not the active sort), so an unsorted column still visibly reads as
 *  clickable rather than only revealing that fact after the first click; `"▲"`/`"▼"` once it is.
 *  `aria-hidden` at the call site: the real accessible state is the button's `aria-label` plus the
 *  `<th>`'s own `aria-sort`, not this glyph. */
function sortCaretGlyph(direction: DataTableSortDirection | null): string {
  if (direction === null) return ' ⇅';
  return direction === 'asc' ? ' ▲' : ' ▼';
}

/**
 * @complexity O(rows × columns) per render for cell rendering, same as always; see
 * {@link sortedTableRows} for the one added cost, paid only when `sort` names an active column.
 */
export function DataTable<Row>(props: DataTableProps<Row>) {
  // Loading wins over empty deliberately: `rows` is legitimately `[]` during a first fetch, and
  // checking emptiness first is what makes a list screen flash its empty state before the data
  // lands.
  if (props.loading && props.loadingContent !== undefined) return <>{props.loadingContent}</>;
  if (!props.loading && props.rows.length === 0 && props.empty !== undefined) return <>{props.empty}</>;

  const rows = sortedTableRows(props.rows, props.columns, props.sort);

  return (
    <div className={['table-scroll', props.scrollClassName].filter(Boolean).join(' ')}>
      <table className={['list-table', props.className].filter(Boolean).join(' ')} aria-label={props.label}>
        {props.caption === undefined ? null : <caption>{props.caption}</caption>}
        <thead>
          <tr>
            {props.columns.map((column) => {
              if (!column.sort) {
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.headerClassName}
                    aria-label={column.header === undefined ? column.headerLabel : undefined}
                  >
                    {column.header}
                  </th>
                );
              }
              const direction = props.sort?.column === column.key ? props.sort.direction : null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={column.headerClassName}
                  aria-sort={ariaSortValue(direction)}
                >
                  <button
                    type="button"
                    className="sortable-column-header"
                    onClick={() => props.onSortChange?.(nextSortState(props.sort, column))}
                    aria-label={column.sort.label(direction)}
                  >
                    {column.header}
                    <span aria-hidden="true">{sortCaretGlyph(direction)}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
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
