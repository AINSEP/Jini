import './dom-setup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInstanceByDom } from 'echarts/core';
import type { ChartInstance, ChartSpec } from '@jini-ai/ui/charts';
import { mount, UnsupportedChartSpecError } from '../client/provider.js';

const sales: ChartSpec = {
  kind: 'stacked-bar', categoryKey: 'month', series: [{ key: 'revenue' }, { key: 'cost' }, { key: 'tax' }],
  data: [{ month: 'Jan', revenue: 100, cost: 60, tax: 5 }, { month: 'Feb', revenue: 150, cost: 70, tax: 8 }],
};
const SPECS: Record<string, ChartSpec> = {
  bar: { ...sales, kind: 'bar' }, 'stacked-bar': sales, line: { ...sales, kind: 'line' }, area: { ...sales, kind: 'area' },
  pie: { kind: 'pie', categoryKey: 'status', series: [{ key: 'count' }], data: [{ status: 'Draft', count: 2 }, { status: 'Published', count: 5 }] },
  donut: { kind: 'donut', categoryKey: 'status', series: [{ key: 'count' }], data: [{ status: 'Draft', count: 2 }, { status: 'Published', count: 5 }] },
  scatter: { kind: 'scatter', categoryKey: 'height', series: [{ key: 'weight' }], data: [{ height: 170, weight: 65 }, { height: 182, weight: 80 }] },
};
const SERIES_TYPE: Record<string, string> = { bar: 'bar', 'stacked-bar': 'bar', line: 'line', area: 'line', pie: 'pie', donut: 'pie', scatter: 'scatter' };

function host(): HTMLElement {
  const element = document.createElement('div'); document.body.append(element); return element;
}
const surfaceOf = (element: HTMLElement): HTMLElement => element.querySelector<HTMLElement>('.jini-chart-surface')!;
/** What ECharts itself holds after the provider's setOption calls. */
function optionOf(element: HTMLElement): { series: { type: string; name: string }[]; xAxis?: unknown[] } {
  return getInstanceByDom(surfaceOf(element))!.getOption() as unknown as { series: { type: string; name: string }[]; xAxis?: unknown[] };
}

describe('ECharts vanilla lifecycle', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each(Object.keys(SPECS))('draws %s as SVG (never canvas) inside a labelled figure', async (kind) => {
    const element = host();
    const instance = mount({ element, spec: SPECS[kind]!, theme: { mode: 'light' } });
    await instance.ready;
    const figure = element.querySelector('figure')!;
    expect(figure.dataset.chartProvider).toBe('plugin.echarts');
    expect(element.querySelector('svg')).not.toBeNull();
    expect(element.querySelector('canvas')).toBeNull();
    expect(element.querySelectorAll('svg path').length).toBeGreaterThan(0);
    expect(optionOf(element).series.map(({ type }) => type)).toEqual(SPECS[kind]!.series.map(() => SERIES_TYPE[kind]));
    // ECharts' aria component describes the data on its own root.
    expect(surfaceOf(element).getAttribute('role')).toBe('img');
    expect(surfaceOf(element).getAttribute('aria-label')).toBeTruthy();
    instance.destroy({});
  });

  it('puts the title and description in the hidden caption as text, never as markup', () => {
    const element = host();
    const instance = mount({ element, spec: { ...SPECS.bar!, title: '<img src=x onerror=alert(1)>', description: 'Monthly revenue' }, theme: { mode: 'light' } });
    const figure = element.querySelector('figure')!;
    expect(figure.getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>');
    expect(element.querySelector('img')).toBeNull();
    const description = document.getElementById(figure.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('Monthly revenue');
    expect(surfaceOf(element).getAttribute('aria-label')).toContain('<img src=x onerror=alert(1)>');
    instance.update({ spec: SPECS.bar!, theme: { mode: 'light' } });
    expect(figure.getAttribute('aria-label')).toBe('revenue, cost, tax by month');
    expect(figure.hasAttribute('aria-describedby')).toBe(false);
    instance.destroy({});
  });

  it('replaces series on update, so dropped series and a former kind\'s axes are gone', () => {
    const element = host();
    const instance = mount({ element, spec: sales, theme: { mode: 'light' } });
    expect(optionOf(element).series.map(({ name }) => name)).toEqual(['revenue', 'cost', 'tax']);
    instance.update({ spec: { ...sales, series: [{ key: 'cost', label: 'Cost' }] }, theme: { mode: 'light' } });
    expect(optionOf(element).series.map(({ name }) => name)).toEqual(['Cost']);
    instance.update({ spec: SPECS.pie!, theme: { mode: 'light' } });
    expect(optionOf(element).series.map(({ type }) => type)).toEqual(['pie']);
    expect(optionOf(element).xAxis ?? []).toEqual([]);
    instance.destroy({});
  });

  it('applies the ChartTheme mode and chart tokens to its element on mount and update', () => {
    const element = host();
    const instance = mount({ element, spec: SPECS.line!, theme: { mode: 'light', tokens: { '--jini-chart-1': '#f80' } } });
    expect(element.dataset.chartTheme).toBe('light');
    expect(element.style.getPropertyValue('--jini-chart-1')).toBe('#f80');
    instance.update({ spec: SPECS.line!, theme: { mode: 'dark' } });
    expect(element.dataset.chartTheme).toBe('dark');
    expect(element.style.getPropertyValue('--jini-chart-1')).toBe('');
    instance.destroy({});
  });

  it('shares category colors and one legend across rings, and identifies the hovered ring, category and formatted value', async () => {
    const element = host();
    const spec: ChartSpec = { ...sales, kind: 'pie', series: [{ key: 'revenue', label: 'Revenue' }, { key: 'cost', label: 'Costs' }],
      data: [{ month: 'Jan', revenue: 100, cost: 1234.5 }, { month: 'Feb', revenue: 150, cost: 70 }], format: { locale: 'de-DE' } };
    const instance = mount({ element, spec, theme: { mode: 'light' } });
    await instance.ready;
    expect(optionOf(element).series.map(({ type, name }) => ({ type, name }))).toEqual([
      { type: 'pie', name: 'Revenue' }, { type: 'pie', name: 'Costs' },
    ]);
    const labels = Array.from(element.querySelectorAll('svg text'), (text) => text.textContent);
    expect(labels.filter((label) => label === 'Jan')).toHaveLength(1);
    expect(labels.filter((label) => label === 'Feb')).toHaveLength(1);
    const chart = getInstanceByDom(surfaceOf(element))!;
    for (const seriesIndex of [0, 1]) {
      expect(chart.getVisual({ seriesIndex, dataIndex: 0 }, 'color')).toBe('var(--jini-chart-1, var(--jini-chart-default-1))');
      expect(chart.getVisual({ seriesIndex, dataIndex: 1 }, 'color')).toBe('var(--jini-chart-2, var(--jini-chart-default-2))');
    }
    chart.dispatchAction({ type: 'showTip', seriesIndex: 1, dataIndex: 0 });
    await vi.waitFor(() => {
      const tooltip = element.querySelector('.jini-chart-tooltip');
      expect(tooltip?.textContent).toContain('Costs');
      expect(tooltip?.textContent).toContain('Jan');
      expect(tooltip?.textContent).toContain('1.234,5');
    });
    instance.update({ spec: SPECS.pie!, theme: { mode: 'light' } });
    expect(optionOf(element).series.map(({ name }) => name)).toEqual(['count']);
    instance.destroy({});
  });

  it('refuses an unsupported spec at mount (leaving nothing behind) and at update (keeping the chart)', () => {
    const element = host();
    const mismatchedPie = { ...SPECS.pie!, series: [{ key: 'count' }, { key: 'other' }] };
    expect(() => mount({ element, spec: mismatchedPie, theme: { mode: 'light' } })).toThrow(UnsupportedChartSpecError);
    expect(element.children).toHaveLength(0);
    const instance = mount({ element, spec: SPECS.bar!, theme: { mode: 'light' } });
    expect(() => instance.update({ spec: { ...SPECS.bar!, kind: 'sankey' }, theme: { mode: 'light' } })).toThrow('Unsupported ECharts chart specification.');
    expect(optionOf(element).series.map(({ type }) => type)).toEqual(['bar', 'bar', 'bar']);
    instance.destroy({});
  });

  it('disposes ECharts on destroy, empties its element, is idempotent and ignores later updates', async () => {
    const element = host();
    const instance: ChartInstance = mount({ element, spec: SPECS.bar!, theme: { mode: 'light' } });
    const surface = surfaceOf(element);
    instance.destroy({});
    instance.destroy({});
    expect(getInstanceByDom(surface)).toBeUndefined();
    expect(element.children).toHaveLength(0);
    await expect(Promise.resolve(instance.update({ spec: SPECS.pie!, theme: { mode: 'dark' } }))).resolves.toBeUndefined();
    expect(element.children).toHaveLength(0);
    expect(element.dataset.chartTheme).toBe('light');
  });

  it('resizes with its frame and stops observing once destroyed', () => {
    const observers: { callback: ResizeObserverCallback; observed: Element[]; disconnected: boolean }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      private readonly record: { callback: ResizeObserverCallback; observed: Element[]; disconnected: boolean };
      constructor(callback: ResizeObserverCallback) { this.record = { callback, observed: [], disconnected: false }; observers.push(this.record); }
      observe(target: Element) { this.record.observed.push(target); }
      unobserve() {}
      disconnect() { this.record.disconnected = true; }
    });
    const element = host();
    const instance = mount({ element, spec: SPECS.bar!, theme: { mode: 'light' } });
    const surface = surfaceOf(element);
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observed).toEqual([surface]);
    const chart = getInstanceByDom(surface)!;
    const before = chart.getWidth();
    surface.style.width = `${before + 250}px`;
    observers[0]!.callback([], {} as ResizeObserver);
    expect(chart.getWidth()).toBe(before + 250);
    instance.destroy({});
    expect(observers[0]!.disconnected).toBe(true);
    // A callback already queued by the browser after destroy must not touch the disposed chart.
    expect(() => observers[0]!.callback([], {} as ResizeObserver)).not.toThrow();
  });
});
