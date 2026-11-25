import { readBoolean, readString, type LedgerCandidate } from "../../../core/ledger-slice.js";
import type { ChatDisplayPreferences, ChatToolCallDisplay } from "./hooks/use-chat-display-preferences.hooks.js";

/**
 * @file The assistant dock's Chat settings → Display choices (owner, 2026-10-11), stored per operator
 * in the server's `core.interface` settings namespace — the same per-user ledger as Settings → User
 * Interface, so the choice follows the person, not the browser. The server registers the three keys
 * in `@jini-ai/cms/settings/site/admin-interface`; until a server carries them, reads
 * fall back to the defaults below and a save is reported as failed (the choice still applies for
 * the session).
 *
 * Pure mapping plus the two ledger calls; the live state is `@jini-ai/admin`'s `use-chat-display-preferences.hooks`.
 */

/** Collapsed tools (the owner's chosen default), Done line on, thinking hidden as it always was. */
export const DEFAULT_CHAT_DISPLAY: ChatDisplayPreferences = { toolCalls: "collapsed", showUsageLine: true, showThinking: false };

/** The host's per-user "interface" settings namespace; the server registers the three keys below in it. */
export const CHAT_DISPLAY_NAMESPACE = "core.interface";
export const CHAT_DISPLAY_KEYS = { toolCalls: "chatToolCalls", showUsageLine: "chatShowUsageLine", showThinking: "chatShowThinking" } as const;

const TOOL_CALL_MODES: readonly ChatToolCallDisplay[] = ["show", "collapsed", "hidden"];

/** An unknown stored mode (an older or hand-edited value) reads as the default, never as a crash. */
export function toChatToolCallDisplay({ value }: { value: string }): ChatToolCallDisplay {
  return (TOOL_CALL_MODES as readonly string[]).includes(value) ? (value as ChatToolCallDisplay) : DEFAULT_CHAT_DISPLAY.toolCalls;
}

/**
 * Stored ledger values → preferences, each key falling back to {@link DEFAULT_CHAT_DISPLAY}.
 * @complexity O(1).
 */
export function readChatDisplayPreferences({ values }: { values: Map<string, unknown> }): ChatDisplayPreferences {
  return {
    toolCalls: toChatToolCallDisplay({ value: readString({ values, key: CHAT_DISPLAY_KEYS.toolCalls, fallback: DEFAULT_CHAT_DISPLAY.toolCalls }, {}) }),
    showUsageLine: readBoolean({ values, key: CHAT_DISPLAY_KEYS.showUsageLine, fallback: DEFAULT_CHAT_DISPLAY.showUsageLine }, {}),
    showThinking: readBoolean({ values, key: CHAT_DISPLAY_KEYS.showThinking, fallback: DEFAULT_CHAT_DISPLAY.showThinking }, {}),
  };
}

/**
 * The ledger writes for a change: one candidate per key, flagged `changed` only where it differs, so
 * flipping one control writes one row.
 * @complexity O(1).
 */
export function chatDisplayCandidates({ next, previous }: { next: ChatDisplayPreferences; previous: ChatDisplayPreferences }): LedgerCandidate[] {
  return [
    { key: CHAT_DISPLAY_KEYS.toolCalls, valueJson: next.toolCalls, changed: next.toolCalls !== previous.toolCalls },
    { key: CHAT_DISPLAY_KEYS.showUsageLine, valueJson: next.showUsageLine, changed: next.showUsageLine !== previous.showUsageLine },
    { key: CHAT_DISPLAY_KEYS.showThinking, valueJson: next.showThinking, changed: next.showThinking !== previous.showThinking },
  ];
}

/**
 * `ChatPane`'s display props for these preferences. Spread onto the pane rather than written as JSX
 * attributes: a chat build without the props ignores them, so the dock compiles and runs against
 * either build.
 * @complexity O(1).
 */
export function chatPaneDisplayProps({ preferences }: { preferences: ChatDisplayPreferences }): {
  toolCallDisplay: ChatToolCallDisplay; showUsageLine: boolean; showThinking: boolean;
} {
  return { toolCallDisplay: preferences.toolCalls, showUsageLine: preferences.showUsageLine, showThinking: preferences.showThinking };
}

/** The existing shared ledger owns reads and sequential diff writes; the host supplies its adapter. */
export interface ChatDisplayLedgerPort {
  load(input: { namespace: string }, options?: Record<string, never>): Promise<Map<string, unknown>>;
  save(input: { namespace: string; scope: "user"; candidates: readonly LedgerCandidate[] }, options?: Record<string, never>): Promise<void>;
}

/** Read this operator's display choices through the injected ledger. Errors propagate. @complexity O(1) keys. */
export async function loadChatDisplayPreferences(
  { port }: { port: ChatDisplayLedgerPort }, _options: Record<string, never> = {},
): Promise<ChatDisplayPreferences> {
  return readChatDisplayPreferences({ values: await port.load({ namespace: CHAT_DISPLAY_NAMESPACE }, {}) });
}

/** Save the requested diff through the injected ledger. Errors propagate. @complexity O(1) keys. */
export async function saveChatDisplayPreferences(
  { next, previous, port }: { next: ChatDisplayPreferences; previous: ChatDisplayPreferences; port: ChatDisplayLedgerPort },
  _options: Record<string, never> = {},
): Promise<void> {
  await port.save({ namespace: CHAT_DISPLAY_NAMESPACE, scope: "user", candidates: chatDisplayCandidates({ next, previous }) }, {});
}

/** The tool-call control's choices, in display order; `label` is the dock dictionary's key. */
export const CHAT_TOOL_CALL_OPTIONS: readonly { value: ChatToolCallDisplay; label: string }[] = [
  { value: "show", label: "Show" },
  { value: "collapsed", label: "Collapsed" },
  { value: "hidden", label: "Hidden" },
];
