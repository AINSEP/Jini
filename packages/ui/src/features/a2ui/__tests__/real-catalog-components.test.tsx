import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { A2uiSurfaceRenderer } from '../renderer.js';
import { buildA2uiCatalogFromRegistry } from '../catalog-from-registry.js';
import { createA2uiInterpreter, createLabCatalog } from '../protocol.js';
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '../../interactive-ui/index.js';

/**
 * End-to-end proof that the shadcn providers and neutral chart hosts are reachable through the real
 * production path — the actual `DEFAULT_INTERACTIVE_UI_REGISTRY` (not a test double), through
 * `buildA2uiCatalogFromRegistry`, an agent message applied to a real interpreter, and rendered by
 * `A2uiSurfaceRenderer`. Complements the provider and neutral-host tests: this file is the one place that proves an A2UI wire
 * message naming `"shadcn.button"`/`"recharts.bar-chart"` actually resolves to them.
 */
const SURFACE_ID = 's1';

function setUpSurface(components: unknown[]) {
  const catalog = buildA2uiCatalogFromRegistry({ registry: DEFAULT_INTERACTIVE_UI_REGISTRY, catalogId: 'merged' }, { base: createLabCatalog({}) });
  const interpreter = createA2uiInterpreter({ catalog, clock: { nowMs: () => 1_000 }, ids: { next: () => "fixture-action" } });
  interpreter.applyAgentMessage({ raw: {
    version: 'v1.0',
    createSurface: { surfaceId: SURFACE_ID, catalogId: 'merged', components },
  } });
  return interpreter;
}

describe('real catalog: shadcn.button', () => {
  it('resolves an A2UI message naming "shadcn.button" to the real shadcn ActionButton and renders it', () => {
    const interpreter = setUpSurface([{ id: 'root', component: 'shadcn.button', label: 'Submit' }]);
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={DEFAULT_INTERACTIVE_UI_REGISTRY} />);
    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeInTheDocument();
    // `bg-primary` only exists on the real shadcn `buttonVariants()` output, not a placeholder.
    expect(button.className).toContain('bg-primary');
  });
});

describe('real catalog: shadcn.checkbox / shadcn.select / shadcn.card', () => {
  it('resolves "shadcn.checkbox" to a real, checkable shadcn Checkbox', () => {
    const interpreter = setUpSurface([{ id: 'root', component: 'shadcn.checkbox', label: 'Accept' }]);
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={DEFAULT_INTERACTIVE_UI_REGISTRY} />);
    expect(screen.getByRole('checkbox', { name: 'Accept' })).toBeInTheDocument();
  });

  it('resolves "shadcn.card" to the real shadcn Card, title, and content', () => {
    const interpreter = setUpSurface([{ id: 'root', component: 'shadcn.card', title: 'Plan', content: '$10/mo' }]);
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={DEFAULT_INTERACTIVE_UI_REGISTRY} />);
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('$10/mo')).toBeInTheDocument();
  });
});

describe('real catalog: recharts.bar-chart', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves an A2UI message naming "recharts.bar-chart" to a styled table when no provider is admitted', () => {
    const interpreter = setUpSurface([
      {
        id: 'root',
        component: 'recharts.bar-chart',
        data: [
          { month: 'Jan', revenue: 100 },
          { month: 'Feb', revenue: 150 },
        ],
        categoryKey: 'month',
        valueKey: 'revenue',
      },
    ]);
    const { container } = render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={DEFAULT_INTERACTIVE_UI_REGISTRY} />);
    expect(container.querySelector('table.jini-data-table')).toHaveTextContent('Jan100Feb150');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('mixes a basic Column, a Text title, and a registry-resolved chart in one surface', () => {
    const interpreter = setUpSurface([
      { id: 'root', component: 'Column', children: ['title', 'chart'] },
      { id: 'title', component: 'Text', text: 'Revenue' },
      { id: 'chart', component: 'recharts.bar-chart', data: [{ month: 'Jan', revenue: 100 }], categoryKey: 'month', valueKey: 'revenue' },
    ]);
    const { container } = render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={DEFAULT_INTERACTIVE_UI_REGISTRY} />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(container.querySelector('table.jini-data-table')).toHaveTextContent('Jan100');
  });
});

describe('real catalog: DEFAULT_INTERACTIVE_UI_REGISTRY coverage', () => {
  it('includes shadcn components and every retained chart wire id', () => {
    const ids = DEFAULT_INTERACTIVE_UI_REGISTRY.list().map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'shadcn.data-table',
        'native.data-table',
        'shadcn.button',
        'shadcn.checkbox',
        'shadcn.radio-group',
        'shadcn.text-input',
        'shadcn.select',
        'shadcn.card',
        'recharts.bar-chart',
        'recharts.line-chart',
        'recharts.pie-chart',
      ]),
    );
  });

  it('resolves by capability, e.g. every "chart" provider', () => {
    const chartEntries = DEFAULT_INTERACTIVE_UI_REGISTRY.resolveByCapability({ capability: 'chart' });
    expect(chartEntries.map((entry) => entry.id)).toEqual(['recharts.bar-chart', 'recharts.line-chart', 'recharts.pie-chart']);
  });
});
