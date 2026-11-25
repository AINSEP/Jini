/** Personal assistant runtime preferences in `core.interface`; mirrors the website's
 *  `@jini-ai/cms/settings/site/admin-interface` keys and defaults. Non-UI: a later toggle only renders. */
import type { ChatDisplayLedgerPort } from './chat-display-preferences.js';
import { CHAT_DISPLAY_NAMESPACE } from './chat-display-preferences.js';

export const PREFER_SUBAGENTS_KEY = 'preferSubagents';
export const REPLY_LENGTH_KEY = 'replyLength';
export const USE_CLAUDE_IN_CHROME_KEY = 'useClaudeInChrome';

export type ReplyLength = 'short' | 'normal' | 'detailed';

/** The gear's segmented reply-length choices, using dock dictionary keys. */
export const REPLY_LENGTH_OPTIONS: readonly { value: ReplyLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'normal', label: 'Normal' },
  { value: 'detailed', label: 'Detailed' },
];

export interface AssistantRuntimePreferences {
  /** Delegate multi-step or output-heavy work to a subagent when the runtime supports one. */
  preferSubagents: boolean;
  /** Let Claude Code use Claude in Chrome (the person's real, logged-in Chrome). Default off (OD-4; owner-only, probe-gated server-side). */
  useClaudeInChrome: boolean;
  /** How much the assistant writes; Normal preserves the existing prompt. */
  replyLength: ReplyLength;
}

export const DEFAULT_ASSISTANT_RUNTIME_PREFERENCES: Readonly<AssistantRuntimePreferences> = Object.freeze({
  preferSubagents: true,
  useClaudeInChrome: false,
  replyLength: 'normal',
});

const KEYS: Readonly<Record<keyof AssistantRuntimePreferences, string>> = {
  preferSubagents: PREFER_SUBAGENTS_KEY,
  useClaudeInChrome: USE_CLAUDE_IN_CHROME_KEY,
  replyLength: REPLY_LENGTH_KEY,
};

/** Missing or invalid stored values use the registered defaults. @complexity O(1) fixed keys. */
export function readAssistantRuntimePreferences({ values }: { values: Map<string, unknown> }, _options = {}): AssistantRuntimePreferences {
  const read = ({ field }: { field: 'preferSubagents' | 'useClaudeInChrome' }, _options: Record<string, never> = {}): boolean => {
    const value = values.get(KEYS[field]);
    return typeof value === 'boolean' ? value : DEFAULT_ASSISTANT_RUNTIME_PREFERENCES[field];
  };
  const replyLength = values.get(REPLY_LENGTH_KEY);
  return {
    preferSubagents: read({ field: 'preferSubagents' }), useClaudeInChrome: read({ field: 'useClaudeInChrome' }),
    replyLength: replyLength === 'short' || replyLength === 'detailed' ? replyLength : DEFAULT_ASSISTANT_RUNTIME_PREFERENCES.replyLength,
  };
}

/** Read the current person's effective preferences; ledger failures propagate. */
export async function loadAssistantRuntimePreferences({ port }: { port: ChatDisplayLedgerPort }, _options = {}): Promise<AssistantRuntimePreferences> {
  return readAssistantRuntimePreferences({ values: await port.load({ namespace: CHAT_DISPLAY_NAMESPACE }, {}) });
}

/** Save the diff at user scope; unchanged keys are sent as unchanged so the ledger skips them. */
export async function saveAssistantRuntimePreferences(
  { port, next, previous }: { port: ChatDisplayLedgerPort; next: AssistantRuntimePreferences; previous: AssistantRuntimePreferences }, _options = {},
): Promise<void> {
  const fields = Object.keys(KEYS) as (keyof AssistantRuntimePreferences)[];
  await port.save({ namespace: CHAT_DISPLAY_NAMESPACE, scope: 'user', candidates: fields.map(field => ({
    key: KEYS[field], valueJson: next[field], changed: next[field] !== previous[field],
  })) }, {});
}

/** The per-runtime capability flags the agents API (`GET /api/agents`, website
 *  `assistant/agents.ts` `AssistantAgentSummary`) adds to each agent entry. */
export interface AgentRuntimePreferenceSupport {
  supportsSubagents?: boolean;
  supportsClaudeInChrome?: boolean;
}

/** Which preferences apply; reply length works for every runtime, while switches need support.
 *  @complexity O(1). */
export function visibleAssistantRuntimePreferences({ agent }: { agent: AgentRuntimePreferenceSupport | undefined }, _options = {}): Record<keyof AssistantRuntimePreferences, boolean> {
  return { preferSubagents: agent?.supportsSubagents === true, useClaudeInChrome: agent?.supportsClaudeInChrome === true, replyLength: true };
}
