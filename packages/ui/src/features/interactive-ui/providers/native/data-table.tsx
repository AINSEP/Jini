import { getNumericColumnKeys } from '../../table-data.js';

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
  const numericKeys = getNumericColumnKeys({ columns, rows });
  return (
    <div className="jini-data-table-frame" data-table-provider="native">
      <div className="jini-data-table-scroll">
        <table className="jini-data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" data-numeric={numericKeys.has(column.key)}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td className="jini-data-table-empty" colSpan={columns.length}>No results.</td></tr>}
            {rows.map((row, index) => (
              <tr
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
                  <td key={column.key} data-numeric={numericKeys.has(column.key)}>{String(row[column.key] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
