// Pure presentation helpers for the memory slice: provider/error labelling,
// extraction-record descriptions, and time/size formatting. All functions are
// side-effect-free (some take the i18n `t` so callers stay localized) and are
// unit-tested without React or transport.
//
// i18n note: this package's convention is "the English string itself is the
// key" (`t('Connect')`, not `t('settings.memoryX')`) — see
// `ADS-memory/reports/jini-port/god-components-extraction-plan.md`'s i18n policy. The
// pinned source's OD dictionary keys are NOT ported (that dictionary's actual
// translated copy is product content); every `t(...)` call below uses a
// plain-English default instead.
import { connectorAppLabel } from './constants.js';
import type {
  ConnectorMemoryAttempt,
  ConnectorMemorySuggestionResponse,
  FlashKind,
  FriendlyExtractionFailure,
  MemoryExtractionRecord,
  MemoryExtractionSkipReason,
  MemorySourceTab,
  MemoryType,
} from './types.js';

/** Structurally identical to `@jini-ai/ui`'s `useT()` return type
 *  (`I18nContextValue['t']`). Declared rather than imported so this package
 *  stays free of the React i18n context — the only thing it ever needed from
 *  there was the SHAPE of the translate function, not the hook. */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

const KIND_LABEL_KEYS: Partial<Record<NonNullable<MemoryExtractionRecord['kind']>, string>> = {
  heuristic: 'Heuristic',
  connector: 'Connected apps',
};

export function describeConnectorReadIssue(result: ConnectorMemorySuggestionResponse): string | null {
  const failed = result.connectors.filter((connector) => connector.status === 'failed');
  const skipped = result.connectors.filter((connector) => connector.status === 'skipped');
  const firstIssue = failed[0] ?? skipped[0];
  if (!firstIssue) return null;

  const connectorName = firstIssue.connectorName || connectorAppLabel(firstIssue.connectorId) || firstIssue.connectorId;
  const reason = (firstIssue.error || firstIssue.summary || '').trim();
  const suffix = reason ? ` ${reason}` : '';

  if (failed.length > 0) {
    return `Couldn't read ${connectorName}.${suffix}`;
  }
  return `No readable content from ${connectorName}.${suffix}`;
}

export function providerDisplayName(provider: MemoryExtractionRecord['provider'] | undefined): string {
  if (provider?.credentialSource === 'chat-cli') {
    if (provider.kind === 'anthropic') return 'Claude Code';
    return 'Local CLI';
  }
  switch (provider?.kind) {
    case 'anthropic':
      return 'Anthropic';
    case 'azure':
      return 'Azure OpenAI';
    case 'google':
      return 'Google Gemini';
    case 'ollama':
      return 'Ollama';
    case 'openai':
      return 'OpenAI';
    default:
      return 'Memory model';
  }
}

type ProviderErrorFields = { message?: string | undefined; code?: string | undefined; status?: number | undefined };

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

// Reads message/code/status out of the first `{...}` in the raw provider
// error. The nested `error.*` field wins for message/code; the top-level
// field wins for status.
function parseJsonErrorFields(raw: string): ProviderErrorFields {
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) return {};
  try {
    // Text starting at `{` can only parse to an object, so `parsed` is never null.
    const parsed = JSON.parse(raw.slice(jsonStart));
    const error = parsed.error;
    return {
      message: [error?.message, parsed.message].find(isString),
      code: [error?.code, parsed.code].find(isString),
      status: [parsed.status, error?.status].find(isNumber),
    };
  } catch {
    // Fall through to regex parsing below.
    return {};
  }
}

export function parseProviderError(raw: string): { message: string; code: string; status: number | null } {
  const fields = parseJsonErrorFields(raw);
  const statusMatch = /\b(4\d\d|5\d\d)\b/.exec(raw);
  return {
    message: (fields.message ?? raw.trim()).replace(/\s+/g, ' ').trim(),
    code: fields.code ?? '',
    status: fields.status ?? (statusMatch ? Number(statusMatch[1]) : null),
  };
}

type FailureCategory = 'auth' | 'quota' | 'network' | 'other';

function classifyFailure({ status, haystack }: { status: number | null; haystack: string }): FailureCategory {
  if (status === 401 || /token[_ -]?expired|authentication token has expired|invalid[_ -]?api[_ -]?key|unauthorized/.test(haystack)) {
    return 'auth';
  }
  if (status === 429 || /rate limit|quota|too many requests|insufficient_quota/.test(haystack)) return 'quota';
  if (/network|fetch failed|timeout|timed out|econnreset|enotfound/.test(haystack)) return 'network';
  return 'other';
}

function failureCopy({
  category,
  providerName,
  usesChatCli,
  source,
  message,
}: {
  category: FailureCategory;
  providerName: string;
  usesChatCli: boolean;
  source: string;
  message: string;
}): FriendlyExtractionFailure {
  switch (category) {
    case 'auth':
      return {
        title: `${providerName} authentication expired`,
        detail: source,
        action: usesChatCli
          ? 'Sign in to the selected local CLI or choose a different memory model.'
          : 'Update the memory extraction model key or sign in again.',
      };
    case 'quota':
      return {
        title: `${providerName} quota or rate limit hit`,
        detail: source,
        action: 'Try again later or switch the memory extraction model.',
      };
    case 'network':
      return {
        title: `${providerName} request failed`,
        detail: source,
        action: usesChatCli
          ? 'Check the selected local CLI and try again.'
          : 'Check the model provider connection and try again.',
      };
    default:
      return {
        title: 'Memory extraction failed',
        detail: message || source,
        action: usesChatCli
          ? 'Try again after checking the selected local CLI.'
          : 'Try again after checking the memory extraction model settings.',
      };
  }
}

export function describeExtractionFailure(record: MemoryExtractionRecord): FriendlyExtractionFailure | null {
  if (record.phase !== 'failed' || !record.error) return null;
  const parsed = parseProviderError(record.error);
  const haystack = `${parsed.message} ${parsed.code} ${record.error}`.toLowerCase();
  return failureCopy({
    category: classifyFailure({ status: parsed.status, haystack }),
    providerName: providerDisplayName(record.provider),
    usesChatCli: record.provider?.credentialSource === 'chat-cli',
    source:
      record.kind === 'connector'
        ? 'Connected apps were read, but the assistant could not turn that context into memory.'
        : 'Memory extraction could not run for this chat.',
    message: parsed.message,
  });
}

export function formatConnectorContextBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'No data';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function connectorAttemptName(attempt: ConnectorMemoryAttempt): string {
  return attempt.connectorName || connectorAppLabel(attempt.connectorId) || attempt.connectorId;
}

export function connectorAttemptTitle(attempt: ConnectorMemoryAttempt): string {
  const connectorName = connectorAttemptName(attempt);
  if (attempt.status === 'succeeded') return `Read ${connectorName}`;
  if (attempt.status === 'failed') return `Could not read ${connectorName}`;
  return `Skipped ${connectorName}`;
}

export function connectorAttemptDetail(attempt: ConnectorMemoryAttempt): string {
  const parts = [attempt.toolTitle || attempt.toolName, attempt.status === 'failed' ? attempt.error : null, attempt.summary]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.join(' · ');
}

// Map a record back to a single human label for the small badge that
// appears next to the row's preview text. Centralised so phase + skip
// reason render consistently across the empty banner and the list.
//
// `tone` only covers the four phases we actually render in the list —
// the `'deleted'` and `'cleared'` pseudo-phases ride the SSE channel
// and never show up in `extractions[]`, so they're filtered out before
// reaching describeRecord. We fall back to 'skipped' defensively in
// case a daemon-side regression sneaks one through.
export function describeRecord(
  record: MemoryExtractionRecord,
  t: Translate,
): {
  phaseLabel: string;
  reasonLabel: string | null;
  kindLabel: string;
  tone: 'running' | 'success' | 'skipped' | 'failed';
} {
  const tone: 'running' | 'success' | 'skipped' | 'failed' =
    record.phase === 'running' || record.phase === 'success' || record.phase === 'failed' ? record.phase : 'skipped';
  const phaseLabel = (() => {
    switch (record.phase) {
      case 'running':
        return t('Running');
      case 'success':
        return t('Done');
      case 'skipped':
        return t('Skipped');
      case 'failed':
        return t('Failed');
      default:
        return record.phase;
    }
  })();
  const reasonLabel = (() => {
    if (record.phase !== 'skipped') return null;
    const reason: MemoryExtractionSkipReason | undefined = record.reason;
    if (reason === 'no-provider') return t('No memory extraction model is configured.');
    if (reason === 'memory-disabled') return t('Memory is turned off.');
    if (reason === 'chat-disabled') return t('Chat conversation learning is off.');
    if (reason === 'empty-message') return t('The message had nothing to extract.');
    if (reason === 'no-match') return t('Nothing matched the extraction rules.');
    return null;
  })();
  // Records written before the `kind` field existed default to 'llm' —
  // that was the only writer at the time, so labelling them as such
  // keeps the history list legible after upgrading.
  const kind = record.kind ?? 'llm';
  const kindLabel = t(KIND_LABEL_KEYS[kind] ?? 'Model');
  return { phaseLabel, reasonLabel, kindLabel, tone };
}

export function formatRelativeTime(at: number, now: number): string {
  const delta = Math.max(0, now - at);
  if (delta < 60_000) return `${Math.round(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`;
  return `${Math.round(delta / 86_400_000)}d`;
}

// Wall-clock timestamp shown next to the relative age. Relative ages on
// their own drift after the panel sits open for a few minutes, and "5m"
// gives no hint about whether that 5m was during today's session or a
// stale row from yesterday. We omit the date for same-day rows so the line
// stays short, and tack on the date for older rows.
export function formatAbsoluteTime(at: number, now: number): string {
  const date = new Date(at);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  if (sameDay) return time;
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${day} ${time}`;
}

export function formatDuration(record: MemoryExtractionRecord): string | null {
  if (!record.finishedAt) return null;
  const ms = Math.max(0, record.finishedAt - record.startedAt);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export function formatRelativeTimeAgo(at: number, now: number): string {
  const relative = formatRelativeTime(at, now);
  return relative === '0s' ? 'just now' : `${relative} ago`;
}

export function memoryCountLabel(count: number): string {
  return count === 1 ? 'memory' : 'memories';
}

// The record's written count when it is a positive number, else 0.
function positiveWrittenCount(record: MemoryExtractionRecord): number {
  const count = record.writtenCount;
  return typeof count === 'number' && count > 0 ? count : 0;
}

function connectorCardTitle({ record, t }: { record: MemoryExtractionRecord; t: Translate }): string {
  switch (record.phase) {
    case 'running':
      return t('Scanning connected apps');
    case 'failed':
      return t('Connected app scan failed');
    case 'skipped':
      return t('Connected app scan skipped');
    case 'success': {
      const writtenCount = positiveWrittenCount(record);
      if (writtenCount > 0) {
        return t('Saved {count} {label}', { count: writtenCount, label: memoryCountLabel(writtenCount) });
      }
      return t('No new memories found');
    }
    default:
      return t('Connected app scan');
  }
}

export function extractionCardTitle(record: MemoryExtractionRecord, t: Translate): string {
  const kind = record.kind ?? 'llm';
  if (kind !== 'connector') {
    return record.userMessagePreview || t('Extraction');
  }
  return connectorCardTitle({ record, t });
}

function connectorCardMeta({ record, now, t }: { record: MemoryExtractionRecord; now: number; t: Translate }): string {
  if (record.phase === 'running') return t('Checking selected apps');
  const age = formatRelativeTimeAgo(record.startedAt, now);
  switch (record.phase) {
    case 'failed':
      return `${t('Needs attention')} · ${age}`;
    case 'skipped':
      return `${t('Skipped')} · ${age}`;
    case 'success': {
      const result = positiveWrittenCount(record) > 0 ? t('From connected apps') : t('Checked selected apps');
      return `${result} · ${age}`;
    }
    default:
      return `${t('Connected apps')} · ${age}`;
  }
}

function modelCardMeta({ record, now, t }: { record: MemoryExtractionRecord; now: number; t: Translate }): string {
  const duration = formatDuration(record);
  const parts = [formatAbsoluteTime(record.startedAt, now), formatRelativeTime(record.startedAt, now)];
  if (duration) parts.push(`${t('took')} ${duration}`);
  if (record.phase === 'success' && typeof record.writtenCount === 'number') {
    parts.push(`${record.writtenCount} ${t('saved')}`);
  }
  return parts.join(' · ');
}

export function extractionCardMeta(record: MemoryExtractionRecord, now: number, t: Translate): string {
  const kind = record.kind ?? 'llm';
  if (kind === 'connector') return connectorCardMeta({ record, now, t });
  return modelCardMeta({ record, now, t });
}

/** Localized labels for each memory type badge. `t`-only, so callers memoize on
 *  `t` at the call site instead of drilling the map through props. */
export function memoryTypeLabels(t: Translate): Record<MemoryType, string> {
  return {
    profile: t('Profile'),
    user: t('Preference'),
    feedback: t('Feedback'),
    project: t('Project'),
    reference: t('Reference'),
    rule: t('Rule'),
  };
}

/** Localized labels for the transient action-confirmation pills. `t`-only. */
export function memoryFlashLabels(t: Translate): Record<FlashKind, string> {
  return {
    created: t('Memory created'),
    saved: t('Memory saved'),
    deleted: t('Memory deleted'),
    indexSaved: t('Index saved'),
    pathCopied: t('Path copied'),
  };
}

/** The add-modal source-tab bar config (profile / manual / connected). `t`-only. */
export function memorySourceTabs(t: Translate): readonly MemorySourceTab[] {
  return [
    {
      id: 'profile',
      label: t('Profile'),
      caption: t('Structured facts about you'),
      icon: 'home',
    },
    {
      id: 'manual',
      label: t('Add manually'),
      caption: t('Write a fact or preference'),
      icon: 'edit',
    },
    {
      id: 'connected',
      label: t('Import from apps'),
      caption: t('Scan connected tools'),
      icon: 'link',
    },
  ];
}
