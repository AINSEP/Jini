// Direct unit tests for useMemoryConnectors.rules.ts's exported pure
// helpers — no React, no renderHook, no port. These pin the decision logic
// extracted out of useMemoryConnectors.hooks.ts's onSuggestConnectorMemory
// and onSaveConnectorSuggestions callbacks (see that file for the callers).
// The hook-level tests in useMemoryConnectors.test.tsx already exercise
// these same branches end-to-end through the rendered hook; these tests
// cover them directly and cheaply, which is the point of the extraction.
import { describe, expect, it } from 'vitest';
import {
  describeConnectorSuggestionOutcome,
  describeConnectorSuggestionsSaveOutcome,
  isRecentFailedConnectorExtraction,
  withoutKey,
  withoutSetMember,
} from '../../../react/hooks/useMemoryConnectors.rules.js';
import type { ConnectorMemorySuggestionResponse, FriendlyExtractionFailure, MemorySuggestion } from '../../../types.js';

function suggestion(id: string, over: Partial<MemorySuggestion> = {}): MemorySuggestion {
  return { id, name: `name-${id}`, description: `desc-${id}`, type: 'project', body: `body-${id}`, ...over };
}

function scanResult(over: Partial<ConnectorMemorySuggestionResponse> = {}): ConnectorMemorySuggestionResponse {
  return { suggestions: [], attemptedLLM: true, connectors: [], contextBytes: 0, ...over };
}

describe('describeConnectorSuggestionOutcome', () => {
  it('a friendly failure wins over suggestions, joining title/detail/action', () => {
    const friendlyFailure: FriendlyExtractionFailure = {
      title: 'Anthropic authentication expired',
      detail: 'Connected apps were read, but the assistant could not turn that context into memory.',
      action: 'Update the memory extraction model key or sign in again.',
    };
    const outcome = describeConnectorSuggestionOutcome({
      result: scanResult({ suggestions: [suggestion('s1')] }),
      friendlyFailure,
      succeeded: 1,
    });
    expect(outcome).toEqual({
      suggestions: null,
      status: null,
      error: `${friendlyFailure.title} ${friendlyFailure.detail} ${friendlyFailure.action}`,
    });
  });

  it('surfaces suggestions with a singular "1 suggested memory from 1 app" status', () => {
    const outcome = describeConnectorSuggestionOutcome({
      result: scanResult({ suggestions: [suggestion('only')] }),
      friendlyFailure: null,
      succeeded: 1,
    });
    expect(outcome.suggestions).toEqual([suggestion('only')]);
    expect(outcome.status).toBe('Found 1 suggested memory from 1 app. Review before saving.');
    expect(outcome.error).toBeNull();
  });

  it('pluralizes suggestions/apps when there is more than one of each', () => {
    const outcome = describeConnectorSuggestionOutcome({
      result: scanResult({ suggestions: [suggestion('a'), suggestion('b')] }),
      friendlyFailure: null,
      succeeded: 2,
    });
    expect(outcome.status).toBe('Found 2 suggested memories from 2 apps. Review before saving.');
  });

  it('reports a connector read issue when the scan found nothing and never reached the LLM', () => {
    const outcome = describeConnectorSuggestionOutcome({
      result: scanResult({
        suggestions: [],
        attemptedLLM: false,
        connectors: [{ connectorId: 'notion', connectorName: 'Notion', status: 'failed', error: 'boom' }],
      }),
      friendlyFailure: null,
      succeeded: 0,
    });
    expect(outcome.suggestions).toBeNull();
    expect(outcome.status).toBeNull();
    expect(outcome.error).toMatch(/Couldn't read Notion/);
  });

  it('falls back to a generic "no useful content" error when the read-issue helper finds nothing specific', () => {
    const outcome = describeConnectorSuggestionOutcome({
      result: scanResult({ suggestions: [], attemptedLLM: false, connectors: [] }),
      friendlyFailure: null,
      succeeded: 0,
    });
    expect(outcome.error).toBe('No memory suggestions found. Could not read useful content from the selected app yet.');
  });

  it('reports a benign "checked N apps, found nothing new" status when the LLM ran but found nothing', () => {
    const outcome = describeConnectorSuggestionOutcome({
      result: scanResult({ suggestions: [], attemptedLLM: true }),
      friendlyFailure: null,
      succeeded: 1,
    });
    expect(outcome.status).toBe('Checked 1 selected app, but found no new memory suggestions.');
    expect(outcome.error).toBeNull();
  });

  it('pluralizes "apps" on the no-new-suggestions path', () => {
    const outcome = describeConnectorSuggestionOutcome({
      result: scanResult({ suggestions: [], attemptedLLM: true }),
      friendlyFailure: null,
      succeeded: 2,
    });
    expect(outcome.status).toBe('Checked 2 selected apps, but found no new memory suggestions.');
  });
});

describe('isRecentFailedConnectorExtraction', () => {
  const scanStartedAt = 10_000;

  it('is true for a failed connector-kind record started within the 5s window', () => {
    expect(isRecentFailedConnectorExtraction({ kind: 'connector', phase: 'failed', startedAt: 9_000 }, scanStartedAt)).toBe(true);
  });

  it('is false for a non-connector kind', () => {
    expect(isRecentFailedConnectorExtraction({ kind: 'llm', phase: 'failed', startedAt: 9_000 }, scanStartedAt)).toBe(false);
  });

  it('is false for a phase other than failed', () => {
    expect(isRecentFailedConnectorExtraction({ kind: 'connector', phase: 'success', startedAt: 9_000 }, scanStartedAt)).toBe(false);
  });

  it('is false for a record started before the 5s window', () => {
    expect(isRecentFailedConnectorExtraction({ kind: 'connector', phase: 'failed', startedAt: 4_000 }, scanStartedAt)).toBe(false);
  });

  it('is false when kind is absent (defaults to the non-connector case)', () => {
    expect(isRecentFailedConnectorExtraction({ phase: 'failed', startedAt: 9_000 }, scanStartedAt)).toBe(false);
  });
});

describe('describeConnectorSuggestionsSaveOutcome', () => {
  it('reports a status but no error when everything saved', () => {
    const outcome = describeConnectorSuggestionsSaveOutcome({ savedCount: 2, totalCount: 2, failure: undefined });
    expect(outcome).toEqual({ status: 'Saved 2 memories from connected apps.', error: null });
  });

  it('singularizes "memory" for a single save', () => {
    const outcome = describeConnectorSuggestionsSaveOutcome({ savedCount: 1, totalCount: 1, failure: undefined });
    expect(outcome.status).toBe('Saved 1 memory from connected apps.');
  });

  it('reports no status when nothing saved', () => {
    const outcome = describeConnectorSuggestionsSaveOutcome({ savedCount: 0, totalCount: 2, failure: undefined });
    expect(outcome.status).toBeNull();
  });

  it('an Error failure reports its message, even alongside a partial save status', () => {
    const outcome = describeConnectorSuggestionsSaveOutcome({ savedCount: 1, totalCount: 2, failure: new Error('reload failed') });
    expect(outcome.status).toBe('Saved 1 memory from connected apps.');
    expect(outcome.error).toBe('reload failed');
  });

  it('a non-Error failure is stringified', () => {
    const outcome = describeConnectorSuggestionsSaveOutcome({ savedCount: 0, totalCount: 1, failure: 'plain string failure' });
    expect(outcome.error).toBe('plain string failure');
  });

  it('reports a partial-save error when nothing threw but not everything saved', () => {
    const outcome = describeConnectorSuggestionsSaveOutcome({ savedCount: 1, totalCount: 2, failure: undefined });
    expect(outcome.error).toBe('Saved 1 of 2 selected memories. Please try the remaining items again.');
  });

  it('reports no error when nothing threw and everything saved', () => {
    const outcome = describeConnectorSuggestionsSaveOutcome({ savedCount: 2, totalCount: 2, failure: undefined });
    expect(outcome.error).toBeNull();
  });
});

describe('withoutKey', () => {
  it('removes the key when present', () => {
    expect(withoutKey({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 });
  });

  it('returns the same reference when the key is already absent', () => {
    const record = { a: 1 };
    expect(withoutKey(record, 'missing')).toBe(record);
  });
});

describe('withoutSetMember', () => {
  it('removes the value when present', () => {
    const result = withoutSetMember(new Set(['a', 'b']), 'a');
    expect([...result]).toEqual(['b']);
  });

  it('returns the same reference when the value is already absent', () => {
    const set = new Set(['a']);
    expect(withoutSetMember(set, 'missing')).toBe(set);
  });
});
