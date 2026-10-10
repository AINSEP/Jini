import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '@jini-ai/ui/interactive-ui';
import { buildA2uiCatalogFromRegistry, createLabCatalog } from '@jini-ai/ui/a2ui';
import { CHART_MANIFESTS, registerChartProvider } from '../index.js';

describe('prototype chart provider', () => {
  beforeEach(() => {
    // Fake browser layout only; the provider, registry and Recharts all stay real.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 600, height: 300, top: 0, left: 0, bottom: 300, right: 600, x: 0, y: 0, toJSON: () => ({}),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('prefers the plugin for each chart capability and retains built-in fallback entries', () => {
    const original = DEFAULT_INTERACTIVE_UI_REGISTRY;
    const registry = registerChartProvider({ registry: original });
    for (const kind of ['bar-chart', 'line-chart', 'pie-chart']) {
      expect(registry.resolveByCapability({ capability: kind }).map(({ id }) => id))
        .toEqual([`plugin.recharts.${kind}`, `recharts.${kind}`]);
      expect(registry.resolveById({ id: `recharts.${kind}` }))
        .toBe(original.resolveById({ id: `recharts.${kind}` }));
      expect(original.resolveById({ id: `plugin.recharts.${kind}` })).toBeNull();
    }
    expect(registry.resolveByCapability({ capability: 'data-table' }))
      .toEqual(original.resolveByCapability({ capability: 'data-table' }));
    expect(registerChartProvider({ registry }).list().map(({ id }) => id))
      .toEqual(registry.list().map(({ id }) => id));
  });

  it.each(['bar-chart', 'line-chart', 'pie-chart'])('renders the copied %s with real data and its provider marker', async (kind) => {
    const registry = registerChartProvider({ registry: DEFAULT_INTERACTIVE_UI_REGISTRY });
    const entry = registry.resolveById({ id: `plugin.recharts.${kind}` })!;
    const Chart = entry.Component;
    const props = kind === 'pie-chart'
      ? { data: [{ name: 'Draft', value: 2 }, { name: 'Published', value: 5 }] }
      : { data: [{ status: 'Draft', count: 2 }, { status: 'Published', count: 5 }], categoryKey: 'status', valueKey: 'count' };
    expect(entry.provider).toBe('plugin.recharts');
    const { container } = render(<Chart {...entry.propsSchema.parse(props)} />);
    expect(container.querySelector('figure')).toHaveAttribute('data-chart-provider', 'plugin.recharts');
    expect(container.querySelector('svg.recharts-surface')).toBeInTheDocument();
    if (kind === 'bar-chart') {
      expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
      // Recharts portals tick text into its label layer, outside the axis chrome group.
      await waitFor(() => expect(container.querySelector('.recharts-xAxis-tick-labels')).toHaveTextContent('Published'));
    } else if (kind === 'line-chart') {
      expect(container.querySelector('.recharts-line-curve')).toHaveAttribute('stroke', 'var(--jini-chart-1, var(--jini-chart-default-1))');
      expect(container.querySelector('linearGradient')).toBeInTheDocument();
    } else {
      expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(2);
      expect(container.querySelector('.jini-chart-legend')).toHaveTextContent('Published5');
    }
  });

  it('adds every copied manifest to the real A2UI catalog while retaining every fallback schema', () => {
    const registry = registerChartProvider({ registry: DEFAULT_INTERACTIVE_UI_REGISTRY });
    const base = createLabCatalog({});
    const catalog = buildA2uiCatalogFromRegistry({ registry, catalogId: base.catalogId }, { base });
    expect(registry.list().filter(({ provider }) => provider === 'plugin.recharts').map(({ id }) => id))
      .toEqual(CHART_MANIFESTS.map(({ id }) => id));
    for (const manifest of CHART_MANIFESTS) {
      expect(catalog.components.get(manifest.id)?.propsSchema).toBe(manifest.propsSchema);
    }
    for (const entry of DEFAULT_INTERACTIVE_UI_REGISTRY.list()) {
      expect(catalog.components.get(entry.id)?.propsSchema).toBe(entry.propsSchema);
    }
    expect(catalog.components.get('Column')).toBe(base.components.get('Column'));
    expect(catalog.functions).toBe(base.functions);
  });
});
