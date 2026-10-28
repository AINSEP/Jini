import { useMemo } from 'react';
import type { ChatMessage } from '../../core/messages.js';
import { terminalMessageNotice } from '../../core/durable-projection.js';
import { conversationUsage, type ChatUsageSummary } from '../../core/turn-usage.js';
import { formatUsageCost } from '../../core/usage-format.js';
import { useI18n } from '../hooks/context.js';

/** A run's terminal state wins over its last model response; interrupted usage never claims success.
 * Missing lifecycle data keeps the legacy completed label. O(n) in terminal notice events. */
export function usageEndLabel(
  { usage, message, awaitingAnswer = false }: { usage: ChatUsageSummary; message?: ChatMessage; awaitingAnswer?: boolean }, _options = {},
): string {
  const status = message?.runStatus;
  if (status === 'failed') return 'Failed';
  if (status === 'canceled') {
    return canceledUsageLabel({ message: message! });
  }
  if (awaitingAnswer) return 'Waiting for your answer';
  const reason = usage.stopReason ?? '';
  if (/error|fail/i.test(reason)) return 'Failed';
  return /abort|interrupt|cancel|max_tokens|max_tool_turns|length|tool_use/i.test(reason) ? 'Interrupted' : 'Done';
}

function canceledUsageLabel({ message }: { message: ChatMessage }, _options = {}): string {
  return /stopped/i.test(terminalMessageNotice({ message }) ?? '') ? 'Stopped' : 'Canceled';
}

/** A standalone row has one turn; MessageList supplies the full conversation projection. */
export function useMessageUsage({ message, summary }: { message: ChatMessage; summary?: ChatUsageSummary }, _optional = {}): ChatUsageSummary | undefined {
  return useMemo(() => summary ?? conversationUsage({ messages: [message] }).get(message.id), [message, summary]);
}

/** Which "Done" lines a message shows. Each finished reply gets its own line where it ends; the reply
 * still running gets none, so a stale line never sits above live work (owner, 2026-10-10). Per-reply
 * lines need the ordered block layout to know where a reply ends; the flat fallback keeps one
 * whole-message line under the message once the run is over. A row still streaming counts as running
 * even when its `runStatus` was never set, so the previous reply's line cannot slide down under the
 * live tool rows above "Running …" (owner bug, 2026-10-10). O(r) for r replies.
 * @example usageLayout({ usage, interleaved: true, runInProgress: true }).footer // undefined */
export function usageLayout(
  { usage, interleaved, runInProgress }: { usage: ChatUsageSummary | undefined; interleaved: boolean; runInProgress: boolean },
  { runStreaming = false }: { runStreaming?: boolean } = {},
): { footer: ChatUsageSummary | undefined; replies: readonly (ChatUsageSummary | undefined)[] } {
  const segments = interleaved ? usage?.segments : undefined;
  const last = segments ? segments.at(-1) : usage;
  return { footer: runInProgress || runStreaming ? undefined : last, replies: segments ? segments.slice(0, -1) : [] };
}

/** Whether the footer's "Done" line renders directly above the copy row: a finished turn with a
 * non-empty usage line and no notice between them. Rows get a modifier class from this so a host can
 * lay the two out on one line with a plain class selector — a `:has(> usage + actions)` selector made
 * every keystroke restyle the whole page in long chats (2026-10-11). O(1).
 * @example usageLineMeetsActions({ footer: { kind: 'usage', costUsd: 0.1 }, terminalNotice: null, pending: false, runInProgress: false }) // true */
export function usageLineMeetsActions(
  { footer, terminalNotice, pending, runInProgress }: { footer: ChatUsageSummary | undefined; terminalNotice: string | null; pending: boolean; runInProgress: boolean },
  { showTotal = true }: { showTotal?: boolean } = {},
): boolean {
  const hasText = footer !== undefined && (footer.durationMs !== undefined || footer.costUsd !== undefined || (showTotal && footer.totalCostUsd !== undefined));
  return hasText && !terminalNotice && !pending && !runInProgress;
}

/** Build footer display values outside JSX; token counts remain available in the tooltip and accessible footer label.
 * Each line carries the chat's running total as of that reply, "Done · 16s · $0.39 · total $3.95" (owner,
 * 2026-10-10: keep the total, always shown, even on the first turn). Known totals remain visible when
 * the current turn's cost is unknown. `showTotal: false` turns the total off. */
export function useUsageSummary({ usage }: { usage: ChatUsageSummary }, { showTotal = true, label = 'Done' }: { showTotal?: boolean; label?: string } = {}) {
  const { t, locale } = useI18n();
  const parts = [usageDuration({ durationMs: usage.durationMs }), usageCost({ usage }, { showTotal })]
    .filter((part): part is string => part !== undefined);
  const text = parts.join(' · ');
  const title = usage.outputTokens === undefined ? undefined : t('{n} output tokens', { n: usage.outputTokens.toLocaleString(locale) });
  return { text, title, ariaLabel: title === undefined ? undefined : `${t(label)} · ${text} · ${title}` };
}

function usageDuration({ durationMs }: { durationMs: number | undefined }, _options = {}): string | undefined {
  if (durationMs === undefined) return undefined;
  const seconds = Math.round(durationMs / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function usageCost({ usage }: { usage: ChatUsageSummary }, { showTotal = true }: { showTotal?: boolean } = {}): string | undefined {
  if (usage.costUsd !== undefined) {
    return formatUsageCost({ costUsd: usage.costUsd, ...(showTotal ? { totalCostUsd: usage.totalCostUsd ?? usage.costUsd } : {}) });
  }
  if (showTotal && usage.totalCostUsd !== undefined) return `total ${formatUsageCost({ costUsd: usage.totalCostUsd })}`;
  return undefined;
}
