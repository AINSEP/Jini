// @vitest-environment node
/**
 * The headless `./interactive-ui/manifests` entry point. Nothing imported it directly: a manifest
 * dropped from `ALL_MANIFESTS`, or an order that disagrees with the React registry's fallback order,
 * would make search/describe tooling rank or miss a component while every provider test stayed green.
 */
import { describe, expect, it } from 'vitest';
import * as manifests from '../manifests.js';

const EXPECTED_ORDER = [
  'shadcn.data-table', 'native.data-table', 'shadcn.button', 'shadcn.checkbox', 'shadcn.radio-group',
  'shadcn.text-input', 'shadcn.select', 'shadcn.card', 'recharts.bar-chart', 'recharts.line-chart', 'recharts.pie-chart',
];

describe('interactive-ui manifests entry point', () => {
  it('lists every manifest exactly once, shadcn data-table preferred over the native fallback', () => {
    expect(manifests.ALL_MANIFESTS.map((m) => m.id)).toEqual(EXPECTED_ORDER);
  });

  it('re-exports each manifest it lists, with its own props schema', () => {
    const exported = Object.entries(manifests).filter(([name]) => name.endsWith('Manifest')).map(([, value]) => value);
    expect(new Set(exported)).toEqual(new Set(manifests.ALL_MANIFESTS));
    const pairs: Array<[keyof typeof manifests, keyof typeof manifests]> = [
      ['nativeDataTableManifest', 'nativeDataTablePropsSchema'], ['shadcnDataTableManifest', 'shadcnDataTablePropsSchema'],
      ['shadcnButtonManifest', 'shadcnButtonPropsSchema'], ['shadcnCheckboxManifest', 'shadcnCheckboxPropsSchema'],
      ['shadcnRadioGroupManifest', 'shadcnRadioGroupPropsSchema'], ['shadcnTextInputManifest', 'shadcnTextInputPropsSchema'],
      ['shadcnSelectManifest', 'shadcnSelectPropsSchema'], ['shadcnCardManifest', 'shadcnCardPropsSchema'],
      ['rechartsBarChartManifest', 'rechartsBarChartPropsSchema'], ['rechartsLineChartManifest', 'rechartsLineChartPropsSchema'],
      ['rechartsPieChartManifest', 'rechartsPieChartPropsSchema'],
    ];
    for (const [manifest, schema] of pairs) {
      expect((manifests[manifest] as { propsSchema: unknown }).propsSchema, manifest).toBe(manifests[schema]);
    }
  });

  it('declares the same order as the React registry, so search rank and fallback order agree', async () => {
    const { DEFAULT_INTERACTIVE_UI_REGISTRY } = await import('../index.js');
    expect(DEFAULT_INTERACTIVE_UI_REGISTRY.list().map((entry) => entry.id)).toEqual(manifests.ALL_MANIFESTS.map((m) => m.id));
  });
});
