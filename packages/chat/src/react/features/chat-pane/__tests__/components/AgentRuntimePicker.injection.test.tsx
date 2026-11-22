import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithChatSurfaces } from '../../../../__tests__/fake-chat-surfaces.js';
import { AgentRuntimePicker } from '../../components/AgentRuntimePicker.js';
import { useAgentRuntimePicker } from '../../hooks/useAgentRuntimePicker.hooks.js';

it('uses injected picker state, translated policy copy, handle and overlay placement', () => {
  const overlay = document.createElement('div');
  document.body.append(overlay);
  const useAgentRuntimePickerHook: typeof useAgentRuntimePicker = (required) => ({
    ...useAgentRuntimePicker(required), open: true, position: { position: 'fixed', left: 10, top: 20 }, originTheme: 'dark',
  });
  try {
    const view = renderWithChatSurfaces(<AgentRuntimePicker agents={[
      { id: 'cli', name: 'Fixture CLI', available: true, fullCliAccessNote: 'Fixture policy copy' },
    ]} value={{ agentId: 'cli' }} onChange={vi.fn()} useAgentHandleHook={() => 'injected-runtime'}
      useTHook={() => (key) => `injected:${key}`} useAgentRuntimePickerHook={useAgentRuntimePickerHook}
      useOverlayContainerHook={() => overlay} />);
    expect(screen.getByRole('button', { name: 'injected:Choose AI runtime' })).toHaveAttribute('data-agent-element', 'injected-runtime-trigger');
    expect(within(overlay).getByRole('dialog', { name: 'injected:Choose AI runtime' })).toHaveAttribute('data-theme', 'dark');
    expect(view.container.querySelector('.jini-runtime-access-note')).toHaveTextContent('injected:Fixture policy copy');
    view.unmount();
  } finally { overlay.remove(); }
});

it('keeps an enclosing native dialog ahead of the injected overlay', () => {
  const overlay = document.createElement('div');
  document.body.append(overlay);
  const useAgentRuntimePickerHook: typeof useAgentRuntimePicker = (required) => ({
    ...useAgentRuntimePicker(required), open: true, position: { left: 10, top: 20 },
  });
  try {
    const view = renderWithChatSurfaces(<dialog open><AgentRuntimePicker agents={[]} value={{ agentId: '' }} onChange={vi.fn()}
      useAgentRuntimePickerHook={useAgentRuntimePickerHook} useOverlayContainerHook={() => overlay} /></dialog>);
    // The first render attaches the trigger; a normal rerender resolves its enclosing dialog.
    view.rerender(<dialog open><AgentRuntimePicker agents={[]} value={{ agentId: '' }} onChange={vi.fn()}
      useAgentRuntimePickerHook={useAgentRuntimePickerHook} useOverlayContainerHook={() => overlay} /></dialog>);
    expect(view.container.querySelector('dialog > .jini-runtime-popover')).not.toBeNull();
    expect(overlay.querySelector('.jini-runtime-popover')).toBeNull();
    view.unmount();
  } finally { overlay.remove(); }
});
