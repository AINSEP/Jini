// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ALL_MANIFESTS } from '@jini-ai/ui/interactive-ui/manifests';
import { CHART_MANIFESTS, RECHARTS_WIRE_IDS } from '../manifests.js';

it('provides a Node-safe manifest entry point in the published package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(pkg.exports['./manifests']).toEqual({
    types: './dist/manifests.d.ts', import: './dist/manifests.js', default: './dist/manifests.js',
  });
  expect(pkg.jini.entries['./manifests']).toBe('universal');
});

it('copies every ui chart catalog entry and maps every legacy wire ID', () => {
  const originals = ALL_MANIFESTS.filter(({ capabilities }) => capabilities.includes('chart'));
  expect(originals.map(({ id }) => id)).toEqual(['recharts.bar-chart', 'recharts.line-chart', 'recharts.pie-chart']);
  expect(CHART_MANIFESTS.map(({ id }) => id)).toEqual([
    'plugin.recharts.bar-chart', 'plugin.recharts.line-chart', 'plugin.recharts.pie-chart',
  ]);
  expect([...RECHARTS_WIRE_IDS.keys()]).toEqual(originals.map(({ id }) => id));
  for (const original of originals) {
    const copy = CHART_MANIFESTS.find(({ id }) => id === RECHARTS_WIRE_IDS.get(original.id))!;
    expect(copy.provider).toBe('plugin.recharts');
    expect(copy.capabilities).toEqual(original.capabilities);
    expect(copy.description).toBe(original.description);
    const valid = original.id === 'recharts.pie-chart'
      ? { data: [{ name: 'Draft', value: 0, extra: 'retained' }], color: 'var(--brand)', extra: 'retained' }
      : { data: [{ status: 'Draft', count: 0, extra: 'retained' }], categoryKey: 'status', valueKey: 'count', color: 'var(--brand)', extra: 'retained' };
    expect(copy.propsSchema.parse(valid)).toEqual(original.propsSchema.parse(valid));
    for (const invalid of [{}, { ...valid, data: [] }, { ...valid, data: 'invalid' }, { ...valid, color: 10 }]) {
      expect(original.propsSchema.safeParse(invalid).success).toBe(false);
      expect(copy.propsSchema.safeParse(invalid).success).toBe(false);
    }
  }
});
