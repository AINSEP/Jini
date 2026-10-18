import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentPluginUsage } from '../../components/AgentPluginUsage.js';
import { readAgentPluginChatState } from '../../../../../core/agent-plugin-chat-state.js';
import type { ChatMessage } from '../../../../../core/messages.js';
const messages: ChatMessage[] = [{ id: 'm', role: 'assistant', content: '', createdAt: 1,
  events: [{ kind: 'ext', name: 'agent_plugins', data: { conversationId: 'c', state: { decision: null, excluded: [] }, plugins: [{ id: 'theme', name: 'Tovu Theme' }, { id: 'design', name: 'UI/UX Design' }] } }] }];
describe('automatic plugin usage chip', () => {
  beforeEach(() => localStorage.clear());
  it('shows the delivered names and × persists an exclusion without removing other names', () => {
    render(<AgentPluginUsage conversationId="c" messages={messages} />);
    expect(screen.getByText('Using:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop using Tovu Theme' }));
    expect(screen.queryByText('Tovu Theme')).not.toBeInTheDocument();
    expect(screen.getByText('UI/UX Design')).toBeInTheDocument();
    expect(readAgentPluginChatState({ conversationId: 'c' }).excluded).toEqual(['theme']);
  });
  it('shows nothing for an Off event or a different conversation', () => {
    const { rerender } = render(<AgentPluginUsage conversationId="other" messages={messages} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<AgentPluginUsage conversationId="c" messages={[{ ...messages[0]!, events: [{ kind: 'ext', name: 'agent_plugins', data: { conversationId: 'c', plugins: [] } }] }]} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
