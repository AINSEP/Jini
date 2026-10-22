/** Vanilla fallback using the existing native table classes and numeric-column decision owner. */
import { getNumericColumnKeys } from '../interactive-ui/table-data.js';
import type { ChartSpec, ChartTheme } from './contract.js';

/** Apply only chart tokens; a provider cannot use theme input to style unrelated host chrome. */
export function applyChartTheme(
  { element, theme }: { element: HTMLElement; theme: ChartTheme }, _options: Record<string, never> = {},
): void {
  for (const key of Array.from(element.style)) if (key.startsWith('--jini-chart-')) element.style.removeProperty(key);
  for (const [key, value] of Object.entries(theme.tokens ?? {})) {
    if (/^--jini-chart-[a-z0-9-]+$/.test(key)) element.style.setProperty(key, value);
  }
  element.dataset.chartTheme = theme.mode;
  element.classList.toggle('dark', theme.mode === 'dark');
}

/** Keep every row/key, including data from unsupported kinds. textContent supplies escaping;
 * never feed agent data to innerHTML. Shared table CSS is already loaded at the admin boundary.
 */
export function renderChartTable(
  { element, spec }: { element: HTMLElement; spec: ChartSpec }, _options: Record<string, never> = {},
): void {
  const doc = element.ownerDocument;
  const keys = [...new Set([
    ...(spec.categoryKey ? [spec.categoryKey] : []), ...spec.series.map(({ key }) => key), ...spec.data.flatMap(Object.keys),
  ])];
  const columns = keys.map((key) => ({ key, label: spec.series.find((series) => series.key === key)?.label ?? key }));
  const numeric = getNumericColumnKeys({ columns, rows: spec.data });
  const scroll = doc.createElement('div'); scroll.className = 'jini-data-table-scroll';
  const table = doc.createElement('table'); table.className = 'jini-data-table';
  const caption = table.createCaption(); caption.textContent = spec.title ?? 'Chart data';
  const header = table.createTHead().insertRow();
  for (const { key, label } of columns) {
    const cell = doc.createElement('th'); cell.scope = 'col'; cell.textContent = label;
    cell.dataset.numeric = String(numeric.has(key)); header.append(cell);
  }
  const body = table.createTBody();
  for (const row of spec.data) {
    const tr = body.insertRow();
    for (const { key } of columns) {
      const cell = tr.insertCell(); const value = row[key] ?? '';
      cell.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
      cell.dataset.numeric = String(numeric.has(key));
    }
  }
  if (spec.data.length === 0) {
    const cell = body.insertRow().insertCell(); cell.colSpan = Math.max(1, columns.length);
    cell.className = 'jini-data-table-empty'; cell.textContent = 'No results.';
  }
  scroll.append(table); element.className = 'jini-data-table-frame'; element.dataset.tableProvider = 'native';
  element.replaceChildren(scroll);
}
