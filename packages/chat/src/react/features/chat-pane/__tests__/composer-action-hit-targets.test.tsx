import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Composer } from '../../../components/Composer.js';
import { useComposer } from '../../../hooks/useComposer.js';
import { AgentRuntimePicker } from '../components/AgentRuntimePicker.js';
import { CHAT_PANE_STYLES } from '../styles.js';

afterEach(cleanup);

it.each([['Send', false], ['Stop run', true]] as const)('%s remains clickable beside the effort selector at dock width', (_label, running) => {
  const send = vi.fn();
  const stop = vi.fn();
  function Harness() {
    const composer = useComposer({ initialDraft: 'Create a new theme' });
    return <div className="jini-chat-pane" style={{ width: 320 }}>
      <style>{CHAT_PANE_STYLES}</style>
      <Composer composer={composer} onSend={send} running={running} onCancel={stop} slots={{
        footerLeadingAccessory: <button type="button">Choose folder</button>,
        footerAccessories: <AgentRuntimePicker agents={[{
          id: 'agent', name: 'Agent', available: true,
          models: [{ id: 'long', label: 'A long discovered model name' }],
          reasoningOptions: [{ id: 'default', label: 'Default' }, { id: 'high', label: 'High' }],
        }]} value={{ agentId: 'agent', model: 'long' }} onChange={() => {}} />,
      }} />
    </div>;
  }
  render(<Harness />);
  const effort = screen.getByRole('button', { name: 'Reasoning: Default' });
  const accessories = effort.closest('.jini-composer-footer-accessories')!;
  // jsdom has no hit testing or flex geometry. Protect the intrinsic floor that stops the
  // fixed effort control overflowing this wrapper across the adjacent Send/Stop hit targets.
  expect(getComputedStyle(accessories).minWidth).toBe('min-content');
  expect(getComputedStyle(accessories.closest('.jini-composer-footer')!).flexWrap).toBe('wrap');
  const action = screen.getByRole('button', { name: running ? 'Stop run' : 'Send' });
  expect(action.closest('.jini-composer-send-group')?.previousElementSibling).toBe(accessories);
  fireEvent.click(action);
  expect(running ? stop : send).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu', { name: 'Reasoning' })).toBeNull();
  expect(effort).toHaveAttribute('aria-expanded', 'false');
});
