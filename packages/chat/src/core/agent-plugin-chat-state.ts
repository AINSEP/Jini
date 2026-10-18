/** Browser-local per-chat decisions; the person's mode remains in the host's settings ledger. */
export interface AgentPluginChatState { decision: { selected: readonly string[]; asked?: boolean } | null; excluded: readonly string[] }
export interface AgentPluginUsage { conversationId: string; state: AgentPluginChatState; plugins: readonly { id: string; name: string }[] }
export interface ChatPluginStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const AGENT_PLUGIN_STATE_CHANGED = 'jini:agent-plugin-state';
const key = (conversationId: string) => `jini:chat-agent-plugins:${conversationId}`;
function browserStorage(): ChatPluginStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}
/** Corrupt/blocked storage permits a fresh question, as clearing localStorage does. */
export function readAgentPluginChatState(
  { conversationId }: { conversationId: string }, { storage = browserStorage() }: { storage?: ChatPluginStorage | undefined } = {},
): AgentPluginChatState {
  try {
    const value = JSON.parse(storage?.getItem(key(conversationId)) ?? 'null') as AgentPluginChatState | null;
    if (value && Array.isArray(value.excluded) && value.excluded.every(id => typeof id === 'string') &&
      (value.decision === null || (Array.isArray(value.decision?.selected) && value.decision.selected.every(id => typeof id === 'string')))) return value;
  } catch { /* Private browsing/corrupt rows behave as a new chat decision. */ }
  return { decision: null, excluded: [] };
}
/** Persist only decision/exclusions. Existing exclusions win over an in-flight server response. */
export function writeAgentPluginChatState(
  { conversationId, state }: { conversationId: string; state: AgentPluginChatState }, { storage = browserStorage() }: { storage?: ChatPluginStorage | undefined } = {},
): void {
  const current = readAgentPluginChatState({ conversationId }, { storage });
  const next = { decision: state.decision, excluded: [...new Set([...current.excluded, ...state.excluded])] };
  try { storage?.setItem(key(conversationId), JSON.stringify(next)); } catch { /* Session can continue without persistence. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AGENT_PLUGIN_STATE_CHANGED, { detail: { conversationId, state: next } }));
}
/** Called only for the protocol's structured plugin event, before delivering it to the transcript. */
export function captureAgentPluginUsage({ event }: { event: { kind: string; name?: string; data?: unknown } }, _options = {}): void {
  if (event.kind !== 'ext' || event.name !== 'agent_plugins') return;
  const usage = event.data as AgentPluginUsage;
  if (typeof usage?.conversationId !== 'string' || !usage.state || !Array.isArray(usage.state.excluded)) return;
  writeAgentPluginChatState({ conversationId: usage.conversationId, state: usage.state });
}
