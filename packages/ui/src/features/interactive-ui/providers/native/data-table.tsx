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

export function DataTable({ columns, rows, onRowClick }: DataTableProps) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={index}
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            role={onRowClick ? 'button' : undefined}
          >
            {columns.map((column) => (
              <td key={column.key}>{String(row[column.key] ?? '')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
