import { useEffect, useState } from 'react';
import type { ChatMessage } from '../../../../core/messages.js';
import { AGENT_PLUGIN_STATE_CHANGED, readAgentPluginChatState, writeAgentPluginChatState, type AgentPluginUsage as Usage } from '../../../../core/agent-plugin-chat-state.js';
import { useT } from '../../../hooks/context.js';

/** One per-chat usage strip; removing a name persists its exclusion for future turns. */
export function AgentPluginUsage({ conversationId, messages }: { conversationId?: string | null; messages: readonly ChatMessage[] }) {
  const t = useT();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(AGENT_PLUGIN_STATE_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(AGENT_PLUGIN_STATE_CHANGED, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  void revision;
  let latest: Usage | undefined;
  for (const message of messages) for (const event of message.events ?? []) {
    if (event.kind === 'ext' && event.name === 'agent_plugins') latest = event.data as Usage;
  }
  const id = conversationId ?? latest?.conversationId;
  if (!id || !latest || latest.conversationId !== id) return null;
  const state = readAgentPluginChatState({ conversationId: id });
  const plugins = latest.plugins.filter(plugin => !state.excluded.includes(plugin.id));
  if (!plugins.length) return null;
  return <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12 }}>
    <span>{t('Using:')}</span>
    {plugins.map(plugin => <span key={plugin.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid currentColor', borderRadius: 12, padding: '1px 7px' }}>
      {plugin.name}<button type="button" aria-label={`${t('Stop using')} ${plugin.name}`} title={t('Stops future use in this chat. Guidance already loaded stays in the current context.')}
        onClick={() => writeAgentPluginChatState({ conversationId: id, state: { ...state, excluded: [...state.excluded, plugin.id] } })}
        style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: '0 2px', fontSize: 16 }}>×</button>
    </span>)}
  </div>;
}
