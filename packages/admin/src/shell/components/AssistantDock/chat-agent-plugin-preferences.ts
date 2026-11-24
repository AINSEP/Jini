/** Personal Agent plugins setting; the UI binds these accessors through the existing ledger. */
import type { LedgerCandidate } from '../../../core/ledger-slice.js';

/** Structural slice of the host's chat-display ledger port: the shared per-person ledger's reads and diff writes. */
export interface ChatAgentPluginsLedgerPort {
  load(input: { namespace: string }, options?: Record<string, never>): Promise<Map<string, unknown>>;
  save(input: { namespace: string; scope: 'user'; candidates: readonly LedgerCandidate[] }, options?: Record<string, never>): Promise<void>;
}

export type ChatAgentPlugins = 'auto' | 'ask' | 'off';
export const DEFAULT_CHAT_AGENT_PLUGINS: ChatAgentPlugins = 'auto';
export const CHAT_AGENT_PLUGINS_KEY = 'chatAgentPlugins';
/** The gear menu's Agent plugins choices, in display order; labels are English i18n keys. */
export const CHAT_AGENT_PLUGIN_OPTIONS: readonly { value: ChatAgentPlugins; label: string }[] = [
  { value: 'auto', label: 'Auto' }, { value: 'ask', label: 'Ask first' }, { value: 'off', label: 'Off' },
];

/** Unknown stored values use the owner-approved default. @complexity O(1). */
export function readChatAgentPlugins({ values }: { values: Map<string, unknown> }, _options = {}): ChatAgentPlugins {
  const value = values.get(CHAT_AGENT_PLUGINS_KEY);
  return value === 'ask' || value === 'off' ? value : DEFAULT_CHAT_AGENT_PLUGINS;
}
/**
 * Read the current person's effective preference; ledger failures propagate.
 * `namespace` is the host's chat-display settings namespace, the same one its display choices use.
 */
export async function loadChatAgentPlugins(
  { port, namespace }: { port: ChatAgentPluginsLedgerPort; namespace: string }, _options = {},
): Promise<ChatAgentPlugins> {
  return readChatAgentPlugins({ values: await port.load({ namespace }, {}) });
}
/** Save one diff at user scope, preserving the person's display preferences. */
export async function saveChatAgentPlugins(
  { port, namespace, next, previous }: { port: ChatAgentPluginsLedgerPort; namespace: string; next: ChatAgentPlugins; previous: ChatAgentPlugins },
  _options = {},
): Promise<void> {
  await port.save({ namespace, scope: 'user', candidates: [{ key: CHAT_AGENT_PLUGINS_KEY, valueJson: next, changed: next !== previous }] }, {});
}
