/**
 * @module components/mcp-ui-surface-state
 *
 * Whether an MCP-UI card in a chat transcript is closed, and with which label. Kept out of
 * `McpUiSurfaceCard.tsx` so the component only renders; moved here from that file 2026-10-04 when
 * the card's own deadline (`useSurfaceExpiry`) became a second reason to close it.
 */
import type { ExtEventCall } from '../ext-event-renderer-registry.js';
import type { useT } from '../hooks/context.js';

type Translate = ReturnType<typeof useT>;

/** Words in a finished call's result that mean nobody answered in time. */
const UNANSWERED_RESULT = /\b(expired|abandoned|did not respond|run ended)\b/i;

/**
 * Why a card can no longer be answered, or `undefined` while it still can.
 *
 * A held-open question (the tool shows the card and waits) is over once its tool call returns, and
 * dead once its run ends without that return. Its first document stays on screen either way, so
 * without this an expired, answered or orphaned question still looked answerable (host stuck-chat
 * investigation, 2026-09-27). Only a card still showing that FIRST document closes: a tool that sent
 * a follow-up document for the same `ui://` URI (an outcome after the answer) keeps showing it.
 *
 * The labels are read from the call's result text, so they are a best guess for a producer this
 * package has not seen; the card is closed either way, which is the property that matters.
 */
function settledLabel(
  t: Translate,
  call: ExtEventCall | undefined,
  runStreaming: boolean,
  documentsForUri: number,
): string | undefined {
  if (call === undefined || documentsForUri > 1) return undefined;
  if (call.result === undefined) return runStreaming ? undefined : t('This question expired');
  return UNANSWERED_RESULT.test(call.result.content) ? t('This question expired') : t('Answered');
}

/**
 * Why a card can no longer be answered, or `undefined` while it still can: {@link settledLabel}'s
 * answer first, so a card answered in time still reads "Answered", then the card's own deadline
 * (`useSurfaceExpiry`). The deadline closes the card the moment it passes rather than when the
 * server's expired result arrives, so a person never clicks a card nobody is waiting on.
 *
 * @complexity O(r) in the call result's length (one regex test).
 */
export function closedSurfaceLabel({ t, call, runStreaming, documentsForUri, expired }: {
  t: Translate;
  call: ExtEventCall | undefined;
  runStreaming: boolean;
  documentsForUri: number;
  expired: boolean;
}): string | undefined {
  return settledLabel(t, call, runStreaming, documentsForUri) ?? (expired ? t('This question expired') : undefined);
}
