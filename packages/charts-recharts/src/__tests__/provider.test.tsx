import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '@jini-ai/ui/interactive-ui';
import { buildA2uiCatalogFromRegistry, createLabCatalog } from '@jini-ai/ui/a2ui';
import { createChartProviderRegistry, chartWireManifests } from '@jini-ai/ui/charts';
import { createChartInteractiveRegistry } from '@jini-ai/ui/charts/react';
import { mount, supportsRechartsSpec, RECHARTS_PROVIDER_ID, RECHARTS_KINDS } from '../index.js';

function registry() {
  const providers = createChartProviderRegistry({ providers: [{ id: RECHARTS_PROVIDER_ID, kinds: RECHARTS_KINDS, enabled: true, supports: supportsRechartsSpec, load: async () => ({ mount }) }] });
  return createChartInteractiveRegistry({ registry: DEFAULT_INTERACTIVE_UI_REGISTRY, providers });
}
describe('Recharts artifact through the neutral UI host and A2UI catalog', () => {
  beforeEach(() => {
    // Fake browser layout only; the host, provider, registry and Recharts all stay real.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.id === 'recharts_measurement_span' ? (this.textContent ?? '').length * 7 : 600;
      return { width, height: 300, top: 0, left: 0, bottom: 300, right: width, x: 0, y: 0, toJSON: () => ({}) };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['bar-chart', 'line-chart', 'pie-chart'])('preserves the %s wire alias while drawing real SVG', async (kind) => {
    const snapshot = registry();
    const entry = snapshot.resolveById({ id: `recharts.${kind}` })!;
    const selected = snapshot.resolveByCapability({ capability: kind })[0]!;
    expect(entry.provider).toBe('plugin.recharts');
    expect(entry.Component).toBe(selected.Component);
    expect(entry.propsSchema).toBe(selected.propsSchema);
    const props = kind === 'pie-chart' ? { data: [{ name: 'Draft', value: 2 }, { name: 'Published', value: 5 }] }
      : { data: [{ status: 'Draft', count: 2 }, { status: 'Published', count: 5 }], categoryKey: 'status', valueKey: 'count' };
    const Chart = entry.Component;
    const { container } = render(<Chart {...entry.propsSchema.parse(props)} />);
    await waitFor(() => expect(container.querySelector('svg.recharts-surface')).not.toBeNull());
    expect(container.querySelector('figure')).toHaveAttribute('data-chart-provider', 'plugin.recharts');
    if (kind === 'bar-chart') expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
    else if (kind === 'line-chart') expect(container.querySelector('.recharts-line-curve')).toHaveAttribute('stroke', 'var(--jini-chart-1, var(--jini-chart-default-1))');
    else expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(2);
  });

  it('uses core schemas in the real A2UI catalog and retains non-chart components', () => {
    const snapshot = registry(); const base = createLabCatalog({});
    const catalog = buildA2uiCatalogFromRegistry({ registry: snapshot, catalogId: base.catalogId }, { base });
    for (const wire of chartWireManifests) expect(catalog.components.get(wire.id)?.propsSchema).toBe(wire.propsSchema);
    expect(catalog.components.get('Column')).toBe(base.components.get('Column'));
    expect(catalog.functions).toBe(base.functions);
    expect(snapshot.resolveByCapability({ capability: 'data-table' })).toEqual(DEFAULT_INTERACTIVE_UI_REGISTRY.resolveByCapability({ capability: 'data-table' }));
  });
});
