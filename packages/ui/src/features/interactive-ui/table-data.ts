interface TableData {
  readonly columns: readonly { readonly key: string }[];
  readonly rows: readonly Record<string, unknown>[];
}

export interface TableSort {
  readonly key: string;
  readonly direction: 'ascending' | 'descending';
}

function isNumericValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    && Number.isFinite(Number(value));
}

/** Infer numeric columns once for both providers; empty cells do not turn a numeric column into text.
 * @complexity O(c × r), c columns and r rows; no per-cell rescans during rendering. */
export function getNumericColumnKeys({ columns, rows }: TableData, _options = {}): ReadonlySet<string> {
  return new Set(columns.filter(({ key }) => {
    const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined && value !== '');
    return values.length > 0 && values.every(isNumericValue);
  }).map(({ key }) => key));
}

/** Sort a copy while preserving source indexes for host actions; missing values stay last in both directions.
 * @complexity O(r log r) time and O(r) space for r rows; the caller memoizes the result. */
export function sortTableRows({ rows, sort, numericKeys }: {
  readonly rows: TableData['rows'];
  readonly sort: TableSort | null;
  readonly numericKeys: ReadonlySet<string>;
}, _options = {}): { row: Record<string, unknown>; index: number }[] {
  const indexed = rows.map((row, index) => ({ row, index }));
  if (!sort) return indexed;
  const { key, direction } = sort;
  const multiplier = direction === 'ascending' ? 1 : -1;
  return indexed.sort((a, b) => {
    const left = a.row[key];
    const right = b.row[key];
    const leftEmpty = left === null || left === undefined || left === '';
    const rightEmpty = right === null || right === undefined || right === '';
    if (leftEmpty || rightEmpty) return Number(leftEmpty) - Number(rightEmpty);
    const compared = numericKeys.has(key)
      ? Number(left) - Number(right)
      : String(left).localeCompare(String(right));
    return compared * multiplier;
  });
}
