import { describe, expect, it } from 'vitest';
import { readAgentPluginChatState, writeAgentPluginChatState } from '../agent-plugin-chat-state.js';
describe('local per-conversation plugin state', () => {
  it('round-trips decisions, separates chats, and makes × win over late responses', () => {
    const rows = new Map<string, string>();
    const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
    writeAgentPluginChatState({ conversationId: 'a', state: { decision: { selected: ['theme'] }, excluded: [] } }, { storage });
    writeAgentPluginChatState({ conversationId: 'a', state: { decision: { selected: ['theme'] }, excluded: ['theme'] } }, { storage });
    writeAgentPluginChatState({ conversationId: 'a', state: { decision: { selected: ['theme'] }, excluded: [] } }, { storage });
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage })).toEqual({ decision: { selected: ['theme'] }, excluded: ['theme'] });
    expect(readAgentPluginChatState({ conversationId: 'b' }, { storage })).toEqual({ decision: null, excluded: [] });
    rows.clear();
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage }).decision).toBeNull();
  });
});
