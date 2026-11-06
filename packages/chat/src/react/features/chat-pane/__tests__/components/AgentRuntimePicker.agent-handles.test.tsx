import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDomPageDriver } from '@jini-ai/agentic/dom';
// Exercise the existing shared overlay context without adding a chat runtime dependency.
import { KitProvider } from '@jini-ai/ui-kit/react';
import { AgentRuntimePicker } from '../../components/AgentRuntimePicker.js';
import type { ChatPaneAgent } from '../../types.js';

const agents: ChatPaneAgent[] = [
  { id: 'runtime/a', name: 'First runtime', available: true, models: [{ id: 'model/a', label: 'Model A' }], reasoningOptions: [{ id: 'high', label: 'High' }] },
  { id: 'runtime-b', name: 'Second runtime', available: true },
];

describe('AgentRuntimePicker agent handles', () => {
  it('keeps portalled runtime rows in the provider overlay and preserves origin page identity for scoped driving', async () => {
    const root = document.createElement('main');
    const mount = document.createElement('section');
    mount.dataset.agentPage = 'settings';
    const overlay = document.createElement('div');
    root.append(mount, overlay);
    document.body.append(root);
    const onChange = vi.fn();
    const view = render(<KitProvider overlayContainer={overlay}>
      <AgentRuntimePicker agentHandle="runtime" agents={agents} value={{ agentId: 'runtime/a' }} onChange={onChange} />
    </KitProvider>, { container: mount });
    try {
      const driver = createDomPageDriver({ root, pages: { settings: { label: 'Settings', navigate: () => {} } } });
      await act(async () => { await driver.click({ handle: 'runtime-trigger' }); });
      const option = screen.getByRole('radio', { name: /Second runtime/ });
      expect(overlay).toContainElement(option);
      const handle = option.getAttribute('data-agent-element')!;
      expect(await driver.findElements({}, { query: handle })).toEqual([expect.objectContaining({ handle, page: 'settings' })]);
      const outside = createDomPageDriver({ root: document.createElement('main'), pages: {} });
      await expect(outside.click({ handle })).rejects.toThrow();
      expect(onChange).not.toHaveBeenCalled();
      await act(async () => { await driver.click({ handle }); });
      expect(onChange).toHaveBeenCalledWith({ agentId: 'runtime-b' });
    } finally { view.unmount(); root.remove(); }
  });

  it('retains native-dialog portal ownership ahead of a provider overlay outside that dialog', () => {
    const overlay = document.createElement('div');
    document.body.append(overlay);
    const view = render(<KitProvider overlayContainer={overlay}><dialog open data-agent-page="settings">
      <AgentRuntimePicker agentHandle="dialog-runtime" agents={agents} value={{ agentId: 'runtime/a' }} onChange={vi.fn()} />
    </dialog></KitProvider>);
    try {
      const trigger = screen.getByRole('button', { name: 'Choose AI runtime' });
      const dialog = trigger.closest('dialog');
      fireEvent.click(trigger);
      const row = screen.getByRole('radio', { name: /Second runtime/ });
      expect(dialog).toContainElement(row);
      expect(overlay).not.toContainElement(row);
      expect(row.closest('.jini-runtime-popover')).toHaveAttribute('data-agent-page', 'settings');
    } finally { view.unmount(); overlay.remove(); }
  });

  it('defaults separate picker instances to distinct handles', () => {
    render(<><AgentRuntimePicker agents={agents} value={{ agentId: 'runtime/a' }} onChange={vi.fn()} />
      <AgentRuntimePicker agents={agents} value={{ agentId: 'runtime/a' }} onChange={vi.fn()} /></>);
    const [first, second] = screen.getAllByRole('button', { name: 'Choose AI runtime' });
    expect(first).toHaveAttribute('data-agent-element');
    expect(first?.getAttribute('data-agent-element')).not.toBe(second?.getAttribute('data-agent-element'));
  });

  it('preserves explicit base and runtime identity across labels and inventory reorder', () => {
    const onChange = vi.fn();
    const view = (inventory: readonly ChatPaneAgent[]) => <AgentRuntimePicker agentHandle="runtime-picker" agents={inventory} value={{ agentId: 'runtime/a' }} onChange={onChange} onRescan={vi.fn()} apiModeAvailable />;
    const { rerender } = render(view(agents));
    expect(screen.getByRole('button', { name: 'Choose AI runtime' })).toHaveAttribute('data-agent-element', 'runtime-picker-trigger');
    fireEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    const first = screen.getByRole('radio', { name: /First runtime/ });
    const handle = first.getAttribute('data-agent-element');
    expect(handle).toMatch(/^runtime-picker-agent-[a-z0-9-]+$/);
    expect(screen.getByRole('button', { name: /Rescan PATH/ })).toHaveAttribute('data-agent-element', 'runtime-picker-rescan');
    rerender(view([{ ...agents[1]!, name: 'Other translated label' }, { ...agents[0]!, name: 'Renamed runtime' }]));
    expect(screen.getByRole('radio', { name: /Renamed runtime/ })).toHaveAttribute('data-agent-element', handle!);
    fireEvent.click(screen.getByRole('radio', { name: /Other translated label/ }));
    expect(onChange).toHaveBeenCalledWith({ agentId: 'runtime-b' });
  });

  it('tags model and reasoning triggers and item IDs without opt-out leaks', () => {
    const { rerender } = render(<AgentRuntimePicker agentHandle="choose" agents={agents} value={{ agentId: 'runtime/a' }} onChange={vi.fn()} />);
    const model = screen.getByRole('button', { name: /^Model:/ });
    expect(model).toHaveAttribute('data-agent-element', 'choose-model');
    fireEvent.click(model);
    expect(screen.getByRole('menuitemradio', { name: 'Model A' }).getAttribute('data-agent-element')).toMatch(/^choose-model-option-/);
    rerender(<AgentRuntimePicker agentHandle={false} agents={agents} value={{ agentId: 'runtime/a' }} onChange={vi.fn()} onRescan={vi.fn()} />);
    expect(document.querySelector('[data-agent-element]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    expect(screen.getByRole('radio', { name: /First runtime/ })).not.toHaveAttribute('data-agent-element');
    expect(document.querySelector('[data-agent-element]')).toBeNull();
  });
});
