// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chartSpecSchema, legacyChartSpec, chartWireManifests } from '../index.js';
import { InteractiveUiRegistry } from '../../interactive-ui/registry.js';
import { z } from 'zod';

describe('neutral chart contract', () => {
  it('converts all three existing wire shapes without losing row data', () => {
    const data = [{ month: 'Jan', revenue: 100, extra: { source: 'ledger' } }];
    for (const kind of ['bar', 'line'] as const) {
      expect(legacyChartSpec({ kind, props: { data, categoryKey: 'month', valueKey: 'revenue', color: '#f80', provider: 'plugin.other' } }))
        .toEqual({ kind, data, categoryKey: 'month', series: [{ key: 'revenue', color: '#f80' }], provider: 'plugin.other' });
    }
    expect(legacyChartSpec({ kind: 'pie', props: { data: [{ name: 'Draft', value: 2 }] } }))
      .toEqual({ kind: 'pie', data: [{ name: 'Draft', value: 2 }], categoryKey: 'name', series: [{ key: 'value' }] });
    expect(chartWireManifests.map(({ id }) => id)).toEqual(['recharts.bar-chart', 'recharts.line-chart', 'recharts.pie-chart']);
  });

  it('admits provider-defined kinds and refuses nonserializable data', () => {
    expect(chartSpecSchema.parse({ kind: 'calendar', data: [{ day: '2026-10-12', value: 1 }], series: [{ key: 'value' }] }).kind).toBe('calendar');
    for (const value of [NaN, Infinity, () => 1, undefined]) {
      expect(chartSpecSchema.safeParse({ kind: 'bar', data: [{ value }], series: [{ key: 'value' }] }).success).toBe(false);
    }
  });
});

it('retains empty-registry React registration and isolates the snapshot from array mutation', () => {
  const first = new InteractiveUiRegistry({ entries: [] });
  const entry = { id: 'fixture', provider: 'fixture', capabilities: ['fixture'], propsSchema: z.object({}), Component: () => null };
  expect(first.register({ entry }).resolveById({ id: 'fixture' })).toBe(entry);
  const entries = [entry]; const snapshot = new InteractiveUiRegistry({ entries }); entries.length = 0;
  expect(snapshot.list()).toEqual([entry]);
});
