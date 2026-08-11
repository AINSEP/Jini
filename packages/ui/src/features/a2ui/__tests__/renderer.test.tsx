import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { A2uiSurfaceRenderer } from '../renderer.js';
import { buildA2uiCatalogFromRegistry } from '../catalog-from-registry.js';
import { createA2uiInterpreter, createLabCatalog } from '../protocol.js';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '../../interactive-ui/registry.js';

function DummyTable({ rows, onRowClick }: { rows: readonly { name: string }[]; onRowClick?: () => void }) {
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.name} onClick={onRowClick}>
          {row.name}
        </li>
      ))}
    </ul>
  );
}

function makeRegistry(): InteractiveUiRegistry {
  const entry: InteractiveComponentEntry = {
    id: 'native.data-table',
    provider: 'test',
    capabilities: ['data-table'],
    // `.passthrough()`, not the default strip-unknown-keys behavior: the interpreter stores zod's
    // *parsed output* as `component.props` (`applyComponentsList`'s `parsed.data`), so a schema
    // that doesn't declare `rows`/`action` would silently strip both before this test ever sees
    // them — a real trap a manifest author needs to know about, not a test-only concern.
    propsSchema: z.object({}).passthrough(),
    // Same variance cast as `interactive-ui/index.ts`'s `DEFAULT_INTERACTIVE_UI_REGISTRY` — see
    // that file's comment for why.
    Component: DummyTable as unknown as ComponentType<Record<string, unknown>>,
  };
  return new InteractiveUiRegistry([entry]);
}

const SURFACE_ID = 's1';

function setUpSurface(registry: InteractiveUiRegistry, components: unknown[]) {
  const catalog = buildA2uiCatalogFromRegistry(registry, 'merged', { base: createLabCatalog() });
  const interpreter = createA2uiInterpreter(catalog);
  interpreter.applyAgentMessage({
    version: 'v1.0',
    createSurface: { surfaceId: SURFACE_ID, catalogId: 'merged', components },
  });
  return interpreter;
}

describe('A2uiSurfaceRenderer', () => {
  it('renders nothing (or the fallback) when the surface has no root yet', () => {
    const interpreter = createA2uiInterpreter(buildA2uiCatalogFromRegistry(makeRegistry(), 'merged', { base: createLabCatalog() }));
    const { container } = render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="no-such-surface" registry={makeRegistry()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a basic Text root', () => {
    const registry = makeRegistry();
    const interpreter = setUpSurface(registry, [{ id: 'root', component: 'Text', text: 'hello' }]);
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={registry} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('walks a Column\'s children, mixing a basic Text with a registry-resolved component', () => {
    const registry = makeRegistry();
    const interpreter = setUpSurface(registry, [
      { id: 'root', component: 'Column', children: ['title', 'table'] },
      { id: 'title', component: 'Text', text: 'Campaigns' },
      { id: 'table', component: 'native.data-table', rows: [{ name: 'Ada' }] },
    ]);
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={registry} />);
    expect(screen.getByText('Campaigns')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('renders a placeholder for a catalog type with no basic case and no registry match', () => {
    const registry = new InteractiveUiRegistry([]);
    // Icon is a real basic-catalog type this renderer has no case for (see module doc).
    const interpreter = setUpSurface(registry, [{ id: 'root', component: 'Icon', name: 'search' }]);
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={registry} />);
    expect(screen.getByText(/no renderer yet for component type "Icon"/)).toBeInTheDocument();
  });

  it('dispatches interpreter.buildAction when a Button with an action prop is clicked', async () => {
    const registry = makeRegistry();
    const interpreter = setUpSurface(registry, [
      { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'clicked' } } },
      { id: 'label', component: 'Text', text: 'Go' },
    ]);
    const buildActionSpy = vi.spyOn(interpreter, 'buildAction');
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={registry} />);
    await userEvent.click(screen.getByText('Go'));
    expect(buildActionSpy).toHaveBeenCalledWith(SURFACE_ID, 'root');
  });

  it('dispatches interpreter.buildAction when a registry component inside a Column fires its callback, and it has an action prop', async () => {
    const registry = makeRegistry();
    const interpreter = setUpSurface(registry, [
      { id: 'root', component: 'Column', children: ['table'] },
      { id: 'table', component: 'native.data-table', rows: [{ name: 'Ada' }], action: { event: { name: 'rowClicked' } } },
    ]);
    const buildActionSpy = vi.spyOn(interpreter, 'buildAction');
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId={SURFACE_ID} registry={registry} />);
    await userEvent.click(screen.getByText('Ada'));
    expect(buildActionSpy).toHaveBeenCalledWith(SURFACE_ID, 'table');
  });
});
