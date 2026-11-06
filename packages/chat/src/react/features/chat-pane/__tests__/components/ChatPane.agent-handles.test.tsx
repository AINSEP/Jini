import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { ChatPane } from '../../components/ChatPane.js';

const agents = [{ id: 'local', name: 'Local runtime', available: true, models: [{ id: 'model', label: 'Model' }] }];

describe('ChatPane handle forwarding', () => {
  it('names the composer and runtime picker from one host base', () => {
    render(<ChatPane agentHandle="help-pane" transport={createFakeChatTransport()} agents={agents} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('data-agent-element', 'help-pane-composer-draft');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('data-agent-element', 'help-pane-composer-send');
    expect(screen.getByRole('button', { name: 'Choose AI runtime' })).toHaveAttribute('data-agent-element', 'help-pane-runtime-trigger');
  });

  it('keeps false through composer and opened runtime menus', () => {
    render(<ChatPane agentHandle={false} transport={createFakeChatTransport()} agents={agents} />);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('data-agent-element');
    expect(screen.getByRole('button', { name: 'Send' })).not.toHaveAttribute('data-agent-element');
    fireEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    expect(screen.getByRole('radio', { name: /Local runtime/ })).not.toHaveAttribute('data-agent-element');
    expect(document.querySelector('button[data-agent-element], input[data-agent-element], textarea[data-agent-element]')).toBeNull();
  });
});
