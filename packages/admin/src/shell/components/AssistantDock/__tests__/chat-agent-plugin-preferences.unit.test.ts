import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CHAT_AGENT_PLUGINS, loadChatAgentPlugins, saveChatAgentPlugins, readChatAgentPlugins } from '../chat-agent-plugin-preferences.js';

describe('person-scoped agent plugin preference', () => {
  it('defaults to Auto and validates stored modes', () => {
    expect(DEFAULT_CHAT_AGENT_PLUGINS).toBe('auto');
    expect(readChatAgentPlugins({ values: new Map() })).toBe('auto');
    expect(readChatAgentPlugins({ values: new Map([['chatAgentPlugins', 'surprise']]) })).toBe('auto');
    for (const mode of ['auto', 'ask', 'off']) expect(readChatAgentPlugins({ values: new Map([['chatAgentPlugins', mode]]) })).toBe(mode);
  });
  it('reads the shared ledger and writes only the changed user preference', async () => {
    const port = { load: vi.fn(async () => new Map<string, unknown>([['chatAgentPlugins', 'ask']])), save: vi.fn(async () => {}) };
    expect(await loadChatAgentPlugins({ port, namespace: 'core.interface' }, {})).toBe('ask');
    expect(port.load).toHaveBeenCalledWith({ namespace: 'core.interface' }, {});
    await saveChatAgentPlugins({ port, namespace: 'core.interface', next: 'off', previous: 'ask' }, {});
    expect(port.save).toHaveBeenCalledWith({ namespace: 'core.interface', scope: 'user', candidates: [{ key: 'chatAgentPlugins', valueJson: 'off', changed: true }] }, {});
  });
});
