import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { A2uiSurfaceRenderer } from '../renderer.js';
import { buildA2uiCatalogFromRegistry } from '../catalog-from-registry.js';
import { createA2uiInterpreter, createLabCatalog } from '../protocol.js';
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '../../interactive-ui/index.js';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '../../interactive-ui/registry.js';

function fixture({ registry = DEFAULT_INTERACTIVE_UI_REGISTRY, component, props, action = true }: {
  registry?: InteractiveUiRegistry;
  component: string;
  props: Record<string, unknown>;
  action?: boolean;
}) {
  const catalog = buildA2uiCatalogFromRegistry({ registry, catalogId: 'actions' }, { base: createLabCatalog({}) });
  const interpreter = createA2uiInterpreter({ catalog, clock: { nowMs: () => 1_000 }, ids: { next: () => 'action-id' } });
  const applied = interpreter.applyAgentMessage({ raw: {
    version: 'v1.0',
    createSurface: { surfaceId: 'actions', catalogId: 'actions', components: [
      { id: 'root', component: 'Column', children: ['control'] },
      { id: 'control', component, ...props, ...(action ? { action: { event: { name: 'activated' } } } : {}) },
    ] },
  } });
  expect(applied.rendererMessages).toEqual([]);
  const buildAction = vi.spyOn(interpreter, 'buildAction');
  render(<A2uiSurfaceRenderer interpreter={interpreter} surfaceId="actions" registry={registry} />);
  return { buildAction };
}

function expectAction(buildAction: ReturnType<typeof fixture>['buildAction']) {
  expect(buildAction).toHaveBeenCalledTimes(1);
  expect(buildAction).toHaveBeenCalledWith({ surfaceId: 'actions', componentId: 'control' });
  expect(buildAction.mock.results[0]?.value).toMatchObject({
    ok: true, kind: 'agent', message: { action: { name: 'activated', sourceComponentId: 'control', surfaceId: 'actions' } },
  });
}

describe('registry provider action wiring', () => {
  it('dispatches a real button action through onPress', async () => {
    const { buildAction } = fixture({ component: 'shadcn.button', props: { label: 'Submit' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expectAction(buildAction);
  });

  it('dispatches a checkbox action through onCheckedChange', async () => {
    const { buildAction } = fixture({ component: 'shadcn.checkbox', props: { label: 'Accept' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Accept' }));
    expectAction(buildAction);
  });

  it('dispatches a radio action through onValueChange', async () => {
    const { buildAction } = fixture({ component: 'shadcn.radio-group', props: { options: [{ value: 'a', label: 'Option A' }] } });
    await userEvent.click(screen.getByRole('radio', { name: 'Option A' }));
    expectAction(buildAction);
  });

  it('dispatches a text input action through onValueChange', async () => {
    const { buildAction } = fixture({ component: 'shadcn.text-input', props: { placeholder: 'Name' } });
    await userEvent.type(screen.getByPlaceholderText('Name'), 'A');
    expectAction(buildAction);
  });

  it('dispatches a select action through onValueChange', async () => {
    const { buildAction } = fixture({ component: 'shadcn.select', props: { options: [{ value: 'a', label: 'Option A' }] } });
    // Keyboard interaction reaches Radix's real selection callback without pointer-only host APIs.
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(await screen.findByRole('option', { name: 'Option A' })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expectAction(buildAction);
  });

  it.each(['native.data-table', 'shadcn.data-table'])('retains onRowClick actions for %s', async component => {
    const { buildAction } = fixture({ component, props: { columns: [{ key: 'name', label: 'Name' }], rows: [{ name: 'Ada' }] } });
    await userEvent.click(screen.getByText('Ada'));
    expectAction(buildAction);
  });

  it.each([{ disabled: true, action: true }, { disabled: false, action: false }])('does not dispatch for disabled or actionless buttons: %j', async ({ disabled, action }) => {
    const { buildAction } = fixture({ component: 'shadcn.button', props: { label: 'Submit', disabled }, action });
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(buildAction).not.toHaveBeenCalled();
  });

  it('lets a custom provider declare its action callback without a renderer special case', async () => {
    function CustomControl({ onCommit }: { onCommit?: () => void }) {
      return <button onClick={onCommit}>Commit</button>;
    }
    const entry: InteractiveComponentEntry = {
      id: 'custom.control', provider: 'custom', capabilities: ['action'],
      propsSchema: z.object({}).passthrough(), actionProp: 'onCommit',
      Component: CustomControl as unknown as ComponentType<Record<string, unknown>>,
    };
    const { buildAction } = fixture({ registry: new InteractiveUiRegistry({ entries: [entry] }), component: entry.id, props: {} });
    await userEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expectAction(buildAction);
  });
});
