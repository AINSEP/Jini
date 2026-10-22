import { describe, expect, it } from 'vitest';
import { applyChartTheme, renderChartTable } from '../table.js';
import type { ChartSpec } from '../contract.js';

const base: ChartSpec = { kind: 'unsupported', data: [], series: [] };

describe('chart table characterization', () => {
  it('keeps ordered unique keys, first series labels, every row and escaped values', () => {
    const element = document.createElement('div');
    element.innerHTML = '<p>Previous content</p>';
    renderChartTable({ element, spec: {
      ...base, title: '<img src=x onerror=alert(1)>', categoryKey: 'category',
      series: [{ key: 'amount', label: 'Amount' }, { key: 'amount', label: 'Ignored' }, { key: 'empty', label: '' }],
      data: [
        { extra: { nested: '<script>bad</script>' }, amount: 0, category: '<b>January</b>', empty: null, flag: false, list: [1, null] },
        { category: 'February', amount: '2.5', extra: null, flag: true },
      ],
    } });
    expect(element.className).toBe('jini-data-table-frame');
    expect(element.dataset.tableProvider).toBe('native');
    expect(element.querySelector('p')).toBeNull();
    expect(element.querySelector('caption')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(Array.from(element.querySelectorAll('th'), (cell) => [cell.textContent, cell.scope, cell.dataset.numeric])).toEqual([
      ['category', 'col', 'false'], ['Amount', 'col', 'true'], ['', 'col', 'false'],
      ['extra', 'col', 'false'], ['flag', 'col', 'false'], ['list', 'col', 'false'],
    ]);
    expect(Array.from(element.querySelectorAll('tbody tr'), (row) => Array.from(row.children, (cell) => cell.textContent))).toEqual([
      ['<b>January</b>', '0', '', '{"nested":"<script>bad</script>"}', 'false', '[1,null]'],
      ['February', '2.5', '', '', 'true', ''],
    ]);
    expect(Array.from(element.querySelectorAll('tbody td'), (cell) => cell.getAttribute('data-numeric'))).toEqual([
      'false', 'true', 'false', 'false', 'false', 'false', 'false', 'true', 'false', 'false', 'false', 'false',
    ]);
    expect(element.querySelector('img, script, b')).toBeNull();
  });

  it.each([
    { categoryKey: undefined, series: [], expectedSpan: 1 },
    { categoryKey: '', series: [], expectedSpan: 1 },
    { categoryKey: 'category', series: [{ key: 'one' }, { key: 'two' }], expectedSpan: 3 },
  ])('renders the empty row with span $expectedSpan for category "$categoryKey"', ({ categoryKey, series, expectedSpan }) => {
    const element = document.createElement('div');
    renderChartTable({ element, spec: { ...base, categoryKey, series } });
    expect(element.querySelector('caption')?.textContent).toBe('Chart data');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(1);
    const cell = element.querySelector('tbody td');
    expect(cell?.textContent).toBe('No results.');
    expect(cell?.getAttribute('colspan')).toBe(String(expectedSpan));
    expect(cell?.className).toBe('jini-data-table-empty');
  });

  it('retains an empty title and a row with no columns instead of inserting an empty-state row', () => {
    const element = document.createElement('div');
    renderChartTable({ element, spec: { ...base, title: '', categoryKey: '', data: [{}] } });
    expect(element.querySelector('caption')?.textContent).toBe('');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(element.querySelectorAll('tbody td')).toHaveLength(0);
  });

  it('replaces only chart tokens, rejects foreign or malformed names and follows theme mode', () => {
    const element = document.createElement('div');
    element.className = 'host dark';
    element.style.setProperty('--jini-chart-old', 'red');
    element.style.setProperty('--host-color', 'blue');
    applyChartTheme({ element, theme: { mode: 'light', tokens: {
      '--jini-chart-accent': 'green', '--host-color': 'red', '--jini-chart-UPPER': 'red', '--jini-chart-': 'red',
    } } });
    expect(element.style.getPropertyValue('--jini-chart-old')).toBe('');
    expect(element.style.getPropertyValue('--jini-chart-accent')).toBe('green');
    expect(element.style.getPropertyValue('--host-color')).toBe('blue');
    expect(element.style.getPropertyValue('--jini-chart-UPPER')).toBe('');
    expect(element.style.getPropertyValue('--jini-chart-')).toBe('');
    expect(element.className).toBe('host');
    expect(element.dataset.chartTheme).toBe('light');
    applyChartTheme({ element, theme: { mode: 'dark' } });
    expect(element.style.getPropertyValue('--jini-chart-accent')).toBe('');
    expect(element.classList.contains('dark')).toBe(true);
    applyChartTheme({ element, theme: { mode: 'auto' } });
    expect(element.className).toBe('host');
    expect(element.dataset.chartTheme).toBe('auto');
  });
});
