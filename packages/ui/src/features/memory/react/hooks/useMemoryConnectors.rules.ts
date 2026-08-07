// Pure decision helpers extracted out of useMemoryConnectors.hooks.ts's
// scan/suggest/save callbacks, so the "what should the UI show" branching is
// unit-testable without React, a port, or a rendered hook. No React, no
// transport, no side effects — same charter as this feature's rules.ts files.
import { describeConnectorReadIssue } from '../../formatters.js';
import type { ConnectorMemorySuggestionResponse, FriendlyExtractionFailure, MemorySuggestion } from '../../types.js';

/** Removes `key` from `record`, preserving referential identity when the key
 *  was already absent. Small generic utility, intentionally duplicated per
 *  slice rather than shared cross-feature — see this file's sibling
 *  `../../rules.js`'s header comment on the slice's duplication convention;
 *  `features/connectors/hooks/useConnectorAuthorization.ts` has the same
 *  helper for its own Record<string, T> state. */
export function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (record[key] === undefined) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** `Set` counterpart to {@link withoutKey}: removes `value`, preserving
 *  referential identity when it was already absent. */
export function withoutSetMember<T>(set: Set<T>, value: T): Set<T> {
  if (!set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
}

/** What `onSuggestConnectorMemory` should show once a scan attempt resolves:
 *  a friendly extraction failure wins over any suggestions found, followed by
 *  suggestions, a read-issue error, and finally a benign "nothing new" status. */
export interface ConnectorSuggestionOutcome {
  suggestions: MemorySuggestion[] | null;
  status: string | null;
  error: string | null;
}

/**
 * Decides the scan outcome from a resolved `suggestConnectorMemories` result,
 * the (already-looked-up) friendly failure for a matching extraction record,
 * and the count of connectors that succeeded. Exactly one of `suggestions`,
 * `status`, `error` (well, `status`/`error` are mutually exclusive; `suggestions`
 * accompanies a `status`) is non-null.
 */
export function describeConnectorSuggestionOutcome({
  result,
  friendlyFailure,
  succeeded,
}: {
  result: ConnectorMemorySuggestionResponse;
  friendlyFailure: FriendlyExtractionFailure | null;
  succeeded: number;
}): ConnectorSuggestionOutcome {
  if (friendlyFailure) {
    return {
      suggestions: null,
      status: null,
      error: [friendlyFailure.title, friendlyFailure.detail, friendlyFailure.action].filter(Boolean).join(' '),
    };
  }
  if (result.suggestions.length > 0) {
    return {
      suggestions: result.suggestions,
      status: `Found ${result.suggestions.length} suggested memor${result.suggestions.length === 1 ? 'y' : 'ies'} from ${succeeded} app${succeeded === 1 ? '' : 's'}. Review before saving.`,
      error: null,
    };
  }
  if (!result.attemptedLLM) {
    return {
      suggestions: null,
      status: null,
      error: describeConnectorReadIssue(result) ?? 'No memory suggestions found. Could not read useful content from the selected app yet.',
    };
  }
  return {
    suggestions: null,
    status: `Checked ${succeeded} selected app${succeeded === 1 ? '' : 's'}, but found no new memory suggestions.`,
    error: null,
  };
}

/** Whether a just-reloaded extraction record is the one this scan attempt
 *  itself triggered: a failed connector-kind record started no more than 5s
 *  before the scan began (a generous window for the extraction to have been
 *  written and the reload to land). */
export function isRecentFailedConnectorExtraction(
  record: { kind?: string | undefined; phase: string; startedAt: number },
  scanStartedAt: number,
): boolean {
  return record.kind === 'connector' && record.phase === 'failed' && record.startedAt >= scanStartedAt - 5_000;
}

/** What `onSaveConnectorSuggestions` should report once the save loop (and
 *  its follow-up `reload()`) settle: a thrown failure wins over a partial-save
 *  message, and a status line is shown whenever at least one suggestion saved
 *  (independent of whether a later step also failed). */
export interface ConnectorSuggestionsSaveOutcome {
  status: string | null;
  error: string | null;
}

export function describeConnectorSuggestionsSaveOutcome({
  savedCount,
  totalCount,
  failure,
}: {
  savedCount: number;
  totalCount: number;
  failure: unknown;
}): ConnectorSuggestionsSaveOutcome {
  const status =
    savedCount > 0 ? `Saved ${savedCount} memor${savedCount === 1 ? 'y' : 'ies'} from connected apps.` : null;
  const error = failure
    ? failure instanceof Error
      ? failure.message
      : String(failure)
    : savedCount !== totalCount
      ? `Saved ${savedCount} of ${totalCount} selected memories. Please try the remaining items again.`
      : null;
  return { status, error };
}
