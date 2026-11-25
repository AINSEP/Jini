import { getNumericColumnKeys } from '../../table-data.js';
import { clickableRowProps, type DataTableRowClick } from '../../table-row-activation.js';

export interface DataTableColumn {
  readonly key: string;
  readonly label: string;
}

export interface DataTableProps {
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /** Host-wired, not part of the agent-facing wire schema — see data-table.manifest.ts. */
  readonly onRowClick?: DataTableRowClick;
}

export function DataTable({ columns, rows, onRowClick }: DataTableProps) {
  const numericKeys = getNumericColumnKeys({ columns, rows });
  return (
    <div className="jini-ui-data-table-frame" data-table-provider="native">
      <div className="jini-ui-data-table-scroll">
        <table className="jini-ui-data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" data-numeric={numericKeys.has(column.key)}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td className="jini-ui-data-table-empty" colSpan={columns.length}>No results.</td></tr>}
            {rows.map((row, index) => (
              <tr
                key={index}
                {...clickableRowProps({ row, index }, { onRowClick })}
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
