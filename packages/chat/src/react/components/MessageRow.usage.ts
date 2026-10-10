import { useMemo } from 'react';
import type { ChatMessage } from '../../core/messages.js';
import { turnUsage, type ChatUsageSummary } from '../../core/turn-usage.js';
import { formatUsageCost } from '../../core/usage-format.js';
import { useT } from '../hooks/context.js';

/** A standalone row has one turn; MessageList supplies the full conversation projection. */
export function useMessageUsage({ message, summary }: { message: ChatMessage; summary?: ChatUsageSummary }, _optional = {}): ChatUsageSummary | undefined {
  return useMemo(() => summary ?? turnUsage({ events: message.events }), [message.events, summary]);
}

/** Build footer display values outside JSX; token counts remain available in the tooltip and accessible footer label. */
export function useUsageSummary({ usage }: { usage: ChatUsageSummary }, _optional = {}) {
  const t = useT();
  const parts: string[] = [];
  if (usage.durationMs !== undefined) {
    const seconds = Math.round(usage.durationMs / 1000);
    parts.push(seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`);
  }
  if (usage.costUsd !== undefined) parts.push(formatUsageCost({ costUsd: usage.costUsd, totalCostUsd: usage.totalCostUsd ?? usage.costUsd }));
  const text = parts.join(' · ');
  const title = usage.outputTokens === undefined ? undefined : t('{n} out', { n: usage.outputTokens });
  return { text, title, ariaLabel: title === undefined ? undefined : `${t('Done')} · ${text} · ${title}` };
}
