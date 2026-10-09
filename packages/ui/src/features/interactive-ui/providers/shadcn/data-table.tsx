import { useMemo, useState } from 'react';
import { getNumericColumnKeys, sortTableRows, type TableSort } from '../../table-data.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.js';

export interface DataTableColumn {
  readonly key: string;
  readonly label: string;
}

export interface DataTableProps {
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /** Local header sorting; defaults to true. Initial row order is always preserved. */
  readonly sortable?: boolean;
  /** Opt-in local paging; omitted means all rows, preserving existing callers. */
  readonly pageSize?: number;
  /** Host-wired, not part of the agent-facing wire schema — see data-table.manifest.ts. */
  readonly onRowClick?: (row: Record<string, unknown>, index: number) => void;
}

/** Composes shadcn's real `table.tsx` primitives into the same `columns`/`rows`/`onRowClick` contract `native.data-table` exposes. */
export function DataTable({ columns, rows, onRowClick, sortable = true, pageSize }: DataTableProps) {
  const [sort, setSort] = useState<TableSort | null>(null);
  const [requestedPage, setPage] = useState(0);
  const numericKeys = useMemo(() => getNumericColumnKeys({ columns, rows }), [columns, rows]);
  const activeSort = sortable && columns.some((column) => column.key === sort?.key) ? sort : null;
  const sortedRows = useMemo(() => sortTableRows({ rows, sort: activeSort, numericKeys }), [rows, activeSort, numericKeys]);
  const requestedSize = pageSize !== undefined && Number.isInteger(pageSize) && pageSize > 0 ? pageSize : null;
  const paging = requestedSize !== null;
  const size = requestedSize ?? Math.max(rows.length, 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  // Clamp during render so a smaller result set never shows a stale, empty page.
  const page = paging ? Math.min(requestedPage, pageCount - 1) : 0;
  const start = page * size;
  const visibleRows = sortedRows.slice(start, start + size);

  return (
    <div className="jini-data-table-frame" data-table-provider="shadcn">
      <Table className="jini-data-table">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} scope="col" data-numeric={numericKeys.has(column.key)}
                aria-sort={sortable ? (activeSort?.key === column.key ? activeSort.direction : 'none') : undefined}>
                {sortable ? (
                  <button type="button" className="jini-data-table-sort" onClick={() => {
                    setSort({ key: column.key, direction: activeSort?.key === column.key && activeSort.direction === 'ascending'
                      ? 'descending' : 'ascending' });
                    setPage(0);
                  }}>
                    <span>{column.label}</span>
                    <span aria-hidden="true">{activeSort?.key === column.key ? (activeSort.direction === 'ascending' ? '↑' : '↓') : '↕'}</span>
                  </button>
                ) : column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell className="jini-data-table-empty" colSpan={columns.length}>No results.</TableCell></TableRow>}
          {visibleRows.map(({ row, index }) => (
            <TableRow
              key={index}
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (event) => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onRowClick(row, index);
                }
              } : undefined}
            >
              {columns.map((column) => (
                <TableCell key={column.key} data-numeric={numericKeys.has(column.key)}>{String(row[column.key] ?? '')}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {paging && (
        <div className="jini-data-table-pagination">
          <span aria-live="polite">{rows.length === 0 ? 0 : start + 1}–{Math.min(start + size, rows.length)} of {rows.length} rows</span>
          <div className="jini-data-table-pagination-controls">
            <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <button type="button" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
