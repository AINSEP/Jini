import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { A2uiSurfaceRenderer } from '../renderer.js';
import { buildA2uiCatalogFromRegistry } from '../catalog-from-registry.js';
import { createA2uiInterpreter, createLabCatalog } from '../protocol.js';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '../../interactive-ui/registry.js';

function surface({ registry, components }: {
  registry: InteractiveUiRegistry;
  components: readonly unknown[];
}, _options: Record<string, never> = {}) {
  const catalog = buildA2uiCatalogFromRegistry({ registry, catalogId: 'pins' }, { base: createLabCatalog({}) });
  const interpreter = createA2uiInterpreter({
    catalog, clock: { nowMs: () => 1000 }, ids: { next: () => 'pin-action' },
  });
  const applied = interpreter.applyAgentMessage({ raw: {
    version: 'v1.0', createSurface: { surfaceId: 'pins', catalogId: 'pins', components },
  } });
  expect(applied).toEqual({ rendererMessages: [] });
  return interpreter;
}

describe('A2UI renderer characterization', () => {
  it.each([
    { id: 'native.data-table', callback: 'onRowClick' },
    { id: 'shadcn.data-table', callback: 'onRowClick' },
    { id: 'shadcn.button', callback: 'onPress' },
    { id: 'shadcn.checkbox', callback: 'onCheckedChange' },
    { id: 'shadcn.radio-group', callback: 'onValueChange' },
    { id: 'shadcn.text-input', callback: 'onValueChange' },
    { id: 'shadcn.select', callback: 'onValueChange' },
    { id: 'custom.control', callback: 'onRowClick' },
    { id: 'custom.control', callback: 'onCommit', actionProp: 'onCommit' },
    { id: 'shadcn.button', callback: 'onCommit', actionProp: 'onCommit' },
    { id: 'custom.control', callback: '', actionProp: '' },
  ])('wires $id through "$callback", respecting explicit actionProp=$actionProp', async ({ id, callback, ...metadata }) => {
    const suppliedCallback = vi.fn();
    const entry: InteractiveComponentEntry = {
      id, provider: 'pin', capabilities: ['action'], propsSchema: z.object({}).passthrough(),
      ...metadata,
      Component: (props: Record<string, unknown>) => (
        <button onClick={() => {
          const handle = props[callback];
          if (typeof handle === 'function') handle({ ignoredPayload: true });
        }}>{String(props.label)}</button>
      ),
    };
    const registry = new InteractiveUiRegistry({ entries: [entry] });
    const interpreter = surface({ registry, components: [{
      id: 'root', component: id, label: 'Activate', [callback]: suppliedCallback,
      action: { event: { name: 'activated' } },
    }] });
    const buildAction = vi.spyOn(interpreter, 'buildAction');
    render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="pins" registry={registry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(suppliedCallback).not.toHaveBeenCalled();
    expect(buildAction).toHaveBeenCalledTimes(1);
    expect(buildAction).toHaveBeenCalledWith({ surfaceId: 'pins', componentId: 'root' });
    expect(buildAction.mock.results[0]?.value).toMatchObject({
      ok: true, kind: 'agent', message: { action: { name: 'activated', sourceComponentId: 'root' } },
    });
  });

  it('keeps the component id and type on the unrenderable placeholder', () => {
    const registry = new InteractiveUiRegistry({ entries: [] });
    const interpreter = surface({ registry, components: [{ id: 'root', component: 'Icon', name: 'search' }] });
    const { container } = render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="pins" registry={registry} />);
    const placeholder = container.querySelector('[data-a2ui-status="unrenderable-type"]');
    expect(placeholder).toHaveAttribute('data-a2ui-component-id', 'root');
    expect(placeholder).toHaveTextContent('⚠ no renderer yet for component type "Icon"');
  });

  it.each(['Column', 'Row'])('preserves %s order and permits repeated siblings while guarding cycles and missing children', (component) => {
    const registry = new InteractiveUiRegistry({ entries: [] });
    const interpreter = surface({ registry, components: [
      { id: 'root', component, children: ['text', 'text', 'root', 'absent'] },
      { id: 'text', component: 'Text', text: 'Repeated' },
    ] });
    const { container } = render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="pins" registry={registry} />);
    expect(container.firstElementChild).toHaveClass(`a2ui-${component.toLowerCase()}`);
    expect(screen.getAllByText('Repeated')).toHaveLength(2);
    expect(container.querySelector('[data-a2ui-status="cycle"]')).toHaveTextContent('⟲ circular reference at "root"');
    expect(container.querySelector('[data-a2ui-status="missing"]')).toHaveTextContent('⚠ missing component "absent"');
    expect(Array.from(container.firstElementChild!.children, child => child.getAttribute('data-a2ui-component-id')))
      .toEqual(['text', 'text', 'root', 'absent']);
  });

  it('keeps template child lists as an explicit unimplemented placeholder', () => {
    const registry = new InteractiveUiRegistry({ entries: [] });
    const interpreter = surface({ registry, components: [
      { id: 'root', component: 'Column', children: { componentId: 'item', path: '/items' } },
    ] });
    const { container } = render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="pins" registry={registry} />);
    expect(container.querySelector('[data-a2ui-status="unimplemented-template-list"]'))
      .toHaveTextContent('⚠ dynamic (template) child lists are not implemented by this port');
  });

  it('renders a Card child and dispatches its Button action', async () => {
    const registry = new InteractiveUiRegistry({ entries: [] });
    const interpreter = surface({ registry, components: [
      { id: 'root', component: 'Card', child: 'button' },
      { id: 'button', component: 'Button', child: 'label', action: { event: { name: 'pressed' } } },
      { id: 'label', component: 'Text', text: 'Press' },
    ] });
    const buildAction = vi.spyOn(interpreter, 'buildAction');
    const { container } = render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="pins" registry={registry} />);
    expect(container.firstElementChild).toHaveClass('a2ui-card');
    await userEvent.click(screen.getByRole('button', { name: 'Press' }));
    expect(buildAction).toHaveBeenCalledTimes(1);
    expect(buildAction).toHaveBeenCalledWith({ surfaceId: 'pins', componentId: 'button' });
  });
});
