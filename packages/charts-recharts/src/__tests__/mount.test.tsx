import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { mount, supportsRechartsSpec } from '../index.js';
import type { ChartSpec, ChartInstance } from '@jini-ai/ui/charts';

const spec: ChartSpec = { kind: 'bar', data: [{ month: 'Jan', revenue: 100 }, { month: 'Feb', revenue: 150 }], categoryKey: 'month', series: [{ key: 'revenue' }] };
describe('standalone Recharts vanilla lifecycle', () => {
  beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.id === 'recharts_measurement_span' ? (this.textContent ?? '').length * 7 : 600;
    return { width, height: 300, top: 0, left: 0, bottom: 300, right: width, x: 0, y: 0, toJSON: () => ({}) };
  }); });
  afterEach(() => vi.restoreAllMocks());

  it('draws real SVG, updates data and theme, and releases its separate root', async () => {
    const element = document.createElement('div'); document.body.append(element);
    let instance!: ChartInstance;
    act(() => { instance = mount({ element, spec, theme: { mode: 'light' } }); });
    await instance.ready;
    expect(element.querySelector('svg.recharts-surface')).not.toBeNull();
    expect(element.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
    let updated: void | Promise<void> = undefined;
    act(() => { updated = instance.update({ spec: { ...spec, data: [{ month: 'Mar', revenue: 90 }] }, theme: { mode: 'dark', tokens: { '--jini-chart-1': '#f80' } } }); });
    await updated!;
    expect(element.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(1);
    expect(element.dataset.chartTheme).toBe('dark');
    expect(element.style.getPropertyValue('--jini-chart-1')).toBe('#f80');
    act(() => instance.destroy({}));
    expect(element.children).toHaveLength(0);
    element.remove();
  });

  it('keeps roots independent and supports all three existing kinds', async () => {
    const elements = [document.createElement('div'), document.createElement('div')];
    elements.forEach((element) => document.body.append(element));
    const specs = [{ ...spec, kind: 'line' }, { kind: 'pie', data: [{ name: 'Draft', value: 2 }], categoryKey: 'name', series: [{ key: 'value' }] }];
    let instances!: ChartInstance[];
    act(() => { instances = elements.map((element, index) => mount({ element, spec: specs[index]!, theme: { mode: 'auto' } })); });
    await Promise.all(instances.map(({ ready }) => ready));
    expect(elements[0]!.querySelector('.recharts-line-curve')).not.toBeNull();
    expect(elements[1]!.querySelectorAll('.recharts-pie-sector')).toHaveLength(1);
    act(() => instances[0]!.destroy({}));
    expect(elements[1]!.querySelector('svg')).not.toBeNull();
    act(() => instances[1]!.destroy({})); elements.forEach((element) => element.remove());
  });

  it('refuses unsupported specs rather than dropping data or silently expanding the grammar', () => {
    expect(supportsRechartsSpec({ spec })).toBe(true);
    for (const candidate of [{ ...spec, kind: 'sankey' }, { ...spec, series: [...spec.series, { key: 'profit' }] }, { ...spec, format: { locale: 'fr-FR' } }]) {
      expect(supportsRechartsSpec({ spec: candidate })).toBe(false);
      expect(() => mount({ element: document.createElement('div'), spec: candidate, theme: { mode: 'light' } })).toThrow('Unsupported Recharts chart specification.');
    }
  });

  it('reports asynchronous render failures to the host through onError', async () => {
    const element = document.createElement('div'); document.body.append(element);
    // Invalid formatter input is not a module mock: the real render path reads this data getter.
    // Recharts reads row data after the provider's first commit, so `ready` may already have
    // settled; the post-mount onError path is what tells the host to fall back.
    const bad = { ...spec, data: [{ get month(): string { throw new Error('render data failed'); }, revenue: 1 }] };
    const errors: unknown[] = [];
    let instance!: ChartInstance;
    act(() => {
      instance = mount({ element, spec: bad, theme: { mode: 'light' } }, { onError: (error) => errors.push(error) });
    });
    await instance.ready!.catch(() => undefined);
    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toMatchObject({ message: 'render data failed' });
    act(() => instance.destroy({})); element.remove();
  });
});
