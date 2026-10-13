import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ChartHost, createChartInteractiveRegistry } from '../react.js';
import { createChartProviderRegistry, type ChartSpec } from '../index.js';
import { InteractiveUiRegistry } from '../../interactive-ui/registry.js';

const spec: ChartSpec = { kind: 'bar', data: [{ name: 'Jan', value: 2 }], categoryKey: 'name', series: [{ key: 'value' }] };
describe('single React chart host', () => {
  it('updates the vanilla instance and destroys it on unmount', async () => {
    const events: string[] = [];
    const registry = createChartProviderRegistry({ providers: [{ id: 'test', kinds: ['bar'], enabled: true, load: async () => ({ mount: ({ element }) => {
      element.textContent = 'Mounted'; events.push('mount');
      return { update({ spec: next }) { events.push(`update:${next.data.length}`); }, destroy() { events.push('destroy'); } };
    } }) }] });
    const view = render(<ChartHost spec={spec} registry={registry} />);
    await waitFor(() => expect(events).toEqual(['mount']));
    view.rerender(<ChartHost spec={{ ...spec, data: [] }} registry={registry} />);
    await waitFor(() => expect(events).toEqual(['mount', 'update:0']));
    view.unmount();
    expect(events).toEqual(['mount', 'update:0', 'destroy']);
  });

  it('uses the selected specific capability for alias schemas and components', () => {
    const providers = createChartProviderRegistry({ providers: [{ id: 'echarts', kinds: ['line', 'calendar'], enabled: true, load: async () => ({ mount: () => ({ update() {}, destroy() {} }) }) }] });
    const registry = createChartInteractiveRegistry({ registry: new InteractiveUiRegistry({ entries: [] }), providers });
    expect(registry.resolveById({ id: 'recharts.bar-chart' })?.provider).toBe('core.table');
    const alias = registry.resolveById({ id: 'recharts.line-chart' })!;
    const selected = registry.resolveByCapability({ capability: 'line-chart' })[0]!;
    expect(alias.provider).toBe('echarts');
    expect(alias.propsSchema).toBe(selected.propsSchema);
    expect(alias.Component).toBe(selected.Component);
    expect(registry.resolveById({ id: 'echarts.calendar-chart' })?.capabilities).toContain('calendar-chart');
  });
});

it('replaces chart snapshots without keeping disabled provider entries', () => {
  const enabled = createChartProviderRegistry({ providers: [{ id: 'test', kinds: ['bar'], enabled: true, load: async () => ({ mount: () => ({ update() {}, destroy() {} }) }) }] });
  const first = createChartInteractiveRegistry({ registry: new InteractiveUiRegistry({ entries: [] }), providers: enabled });
  const next = createChartInteractiveRegistry({ registry: first, providers: createChartProviderRegistry({ providers: [] }) });
  expect(next.resolveById({ id: 'test.bar-chart' })).toBeNull();
  expect(next.resolveById({ id: 'recharts.bar-chart' })?.provider).toBe('core.table');
});
