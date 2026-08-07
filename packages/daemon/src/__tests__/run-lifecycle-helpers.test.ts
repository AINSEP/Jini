import { describe, expect, it, vi } from 'vitest';
import type { EventLogEntry } from '../event-log.js';
import {
  armWatchdogIfConfigured,
  buildStartPayload,
  clearIdempotencyIndexEntryIfMatching,
  deliverReplayedEvents,
  deliverUndeliveredEvents,
  finishStreamSubscription,
  registerIdempotencyKeyIfPresent,
  resolveIdempotentReplayRunId,
} from '../run-lifecycle.js';

// Pure/near-pure helpers extracted from `start()`/`stream()` during the complexity refactor that
// brought both methods under the ≤10 cyclomatic/cognitive gate. `run-lifecycle.test.ts`'s existing
// 56 characterization tests already exercise these paths end-to-end through the public
// start()/stream()/finish() API; these tests instead pin each extracted decision directly, so a
// regression in one shows up as a failure naming the exact function and branch rather than only as
// a downstream symptom several calls away.

describe('resolveIdempotentReplayRunId', () => {
  it('returns undefined when no idempotencyKey was supplied, without touching the index', () => {
    const index = new Map<string, string>([['other-key', 'other-run']]);
    expect(resolveIdempotentReplayRunId(index, undefined)).toBeUndefined();
  });

  it('returns undefined when the key has no existing mapping', () => {
    const index = new Map<string, string>();
    expect(resolveIdempotentReplayRunId(index, 'fresh-key')).toBeUndefined();
  });

  it('returns the mapped runId when the key already exists', () => {
    const index = new Map<string, string>([['key-1', 'run-1']]);
    expect(resolveIdempotentReplayRunId(index, 'key-1')).toBe('run-1');
  });
});

describe('registerIdempotencyKeyIfPresent', () => {
  it('is a no-op when idempotencyKey is undefined', () => {
    const index = new Map<string, string>();
    registerIdempotencyKeyIfPresent(index, undefined, 'run-1');
    expect(index.size).toBe(0);
  });

  it('maps the key to runId when present', () => {
    const index = new Map<string, string>();
    registerIdempotencyKeyIfPresent(index, 'key-1', 'run-1');
    expect(index.get('key-1')).toBe('run-1');
  });

  it('overwrites an existing mapping for the same key', () => {
    const index = new Map<string, string>([['key-1', 'stale-run']]);
    registerIdempotencyKeyIfPresent(index, 'key-1', 'fresh-run');
    expect(index.get('key-1')).toBe('fresh-run');
  });
});

describe('clearIdempotencyIndexEntryIfMatching', () => {
  it('is a no-op when idempotencyKey is undefined', () => {
    const index = new Map<string, string>([['key-1', 'run-1']]);
    clearIdempotencyIndexEntryIfMatching(index, undefined, 'run-1');
    expect(index.get('key-1')).toBe('run-1');
  });

  it('removes the entry when it still points at runId', () => {
    const index = new Map<string, string>([['key-1', 'run-1']]);
    clearIdempotencyIndexEntryIfMatching(index, 'key-1', 'run-1');
    expect(index.has('key-1')).toBe(false);
  });

  it('leaves the entry alone when it now points at a different run (a later claimant of the same key)', () => {
    const index = new Map<string, string>([['key-1', 'newer-run']]);
    clearIdempotencyIndexEntryIfMatching(index, 'key-1', 'stale-run');
    expect(index.get('key-1')).toBe('newer-run');
  });

  it('is a no-op when the key was never registered at all', () => {
    const index = new Map<string, string>();
    clearIdempotencyIndexEntryIfMatching(index, 'key-1', 'run-1');
    expect(index.has('key-1')).toBe(false);
  });
});

describe('buildStartPayload', () => {
  it('omits agentId and idempotencyKey when neither was supplied', () => {
    expect(buildStartPayload('run-1', { contextRef: 'ctx-1' })).toEqual({
      runId: 'run-1',
      contextRef: 'ctx-1',
    });
  });

  it('includes agentId when supplied', () => {
    expect(buildStartPayload('run-1', { contextRef: 'ctx-1', agentId: 'agent-a' })).toEqual({
      runId: 'run-1',
      contextRef: 'ctx-1',
      agentId: 'agent-a',
    });
  });

  it('includes idempotencyKey when supplied', () => {
    expect(buildStartPayload('run-1', { contextRef: 'ctx-1', idempotencyKey: 'key-1' })).toEqual({
      runId: 'run-1',
      contextRef: 'ctx-1',
      idempotencyKey: 'key-1',
    });
  });

  it('includes both when both are supplied', () => {
    expect(buildStartPayload('run-1', { contextRef: 'ctx-1', agentId: 'agent-a', idempotencyKey: 'key-1' })).toEqual({
      runId: 'run-1',
      contextRef: 'ctx-1',
      agentId: 'agent-a',
      idempotencyKey: 'key-1',
    });
  });

  it('threads a null contextRef through unchanged', () => {
    expect(buildStartPayload('run-1', { contextRef: undefined as unknown as string })).toEqual({
      runId: 'run-1',
      contextRef: undefined,
    });
  });
});

describe('armWatchdogIfConfigured', () => {
  it('does not arm a watchdog when timeoutMs is undefined', () => {
    const record = { watchdog: undefined as unknown };
    armWatchdogIfConfigured(record as never, undefined, () => {});
    expect(record.watchdog).toBeUndefined();
  });

  it('arms a watchdog when timeoutMs is configured', () => {
    vi.useFakeTimers();
    try {
      const record = { watchdog: undefined as unknown };
      const onTimeout = vi.fn();
      armWatchdogIfConfigured(record as never, 1_000, onTimeout);
      expect(record.watchdog).toBeDefined();
      expect(onTimeout).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

function makeEntry(id: string, event: string, data: unknown = {}): EventLogEntry {
  return { id, event, data, recordedAt: 0 };
}

describe('deliverReplayedEvents', () => {
  it('delivers every entry in order and returns their eventIds', () => {
    const delivered: unknown[] = [];
    const ids = deliverReplayedEvents('run-1', [makeEntry('1', 'start'), makeEntry('2', 'agent')], (e) => delivered.push(e));
    expect(delivered).toHaveLength(2);
    expect(ids).toEqual(new Set(['run-1:1', 'run-1:2']));
  });

  it('returns an empty set and delivers nothing for an empty entry list', () => {
    const delivered: unknown[] = [];
    const ids = deliverReplayedEvents('run-1', [], (e) => delivered.push(e));
    expect(delivered).toHaveLength(0);
    expect(ids.size).toBe(0);
  });
});

describe('deliverUndeliveredEvents', () => {
  it('delivers events whose eventId is not already in deliveredEventIds', () => {
    const delivered: unknown[] = [];
    const deliveredIds = new Set<string>();
    const events = [
      { eventId: 'a', kind: 'agent' } as never,
      { eventId: 'b', kind: 'agent' } as never,
    ];
    deliverUndeliveredEvents(events, deliveredIds, (e) => delivered.push(e));
    expect(delivered).toEqual(events);
    expect(deliveredIds).toEqual(new Set(['a', 'b']));
  });

  it('skips an event already present in deliveredEventIds (no double-delivery)', () => {
    const delivered: unknown[] = [];
    const deliveredIds = new Set<string>(['a']);
    const events = [{ eventId: 'a', kind: 'agent' } as never, { eventId: 'b', kind: 'agent' } as never];
    deliverUndeliveredEvents(events, deliveredIds, (e) => delivered.push(e));
    expect(delivered).toEqual([events[1]]);
  });

  it('is a no-op on an empty events list', () => {
    const delivered: unknown[] = [];
    const deliveredIds = new Set<string>();
    deliverUndeliveredEvents([], deliveredIds, (e) => delivered.push(e));
    expect(delivered).toHaveLength(0);
  });
});

describe('finishStreamSubscription', () => {
  it('removes the subscriber immediately when the run is terminal', () => {
    const subscriber = () => {};
    const record = { subscribers: new Set([subscriber]) };
    const result = finishStreamSubscription(record, subscriber, true);
    expect(result.kind).toBe('ok');
    expect(record.subscribers.has(subscriber)).toBe(false);
  });

  it('an unsubscribe call on the terminal result is a harmless no-op', () => {
    const subscriber = () => {};
    const record = { subscribers: new Set([subscriber]) };
    const result = finishStreamSubscription(record, subscriber, true);
    expect(() => (result as { unsubscribe: () => void }).unsubscribe()).not.toThrow();
  });

  it('keeps the subscriber registered when the run is still live', () => {
    const subscriber = () => {};
    const record = { subscribers: new Set([subscriber]) };
    const result = finishStreamSubscription(record, subscriber, false);
    expect(result.kind).toBe('ok');
    expect(record.subscribers.has(subscriber)).toBe(true);
  });

  it('a live result\'s unsubscribe() removes the subscriber', () => {
    const subscriber = () => {};
    const record = { subscribers: new Set([subscriber]) };
    const result = finishStreamSubscription(record, subscriber, false);
    (result as { unsubscribe: () => void }).unsubscribe();
    expect(record.subscribers.has(subscriber)).toBe(false);
  });
});
