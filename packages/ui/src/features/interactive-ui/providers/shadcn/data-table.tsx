import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.js';

export interface DataTableColumn {
  readonly key: string;
  readonly label: string;
}

export interface DataTableProps {
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /** Host-wired, not part of the agent-facing wire schema — see data-table.manifest.ts. */
  readonly onRowClick?: (row: Record<string, unknown>, index: number) => void;
}

/** Composes shadcn's real `table.tsx` primitives into the same `columns`/`rows`/`onRowClick` contract `native.data-table` exposes. */
export function DataTable({ columns, rows, onRowClick }: DataTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key}>{column.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow
            key={index}
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            role={onRowClick ? 'button' : undefined}
          >
            {columns.map((column) => (
              <TableCell key={column.key}>{String(row[column.key] ?? '')}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
