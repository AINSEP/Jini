import { describe, expect, it, vi } from 'vitest';
import { createLiveRunTracker, waitForStoppingRuns } from '../session-coordination.js';

// F1 fix wave (Stryker L8 §4 session-coordination.ts:27,32,39,87).
describe('createLiveRunTracker — F1', () => {
  it('re-registering a run under a different conversation moves it (old conversation no longer sees it)', () => {
    const t = createLiveRunTracker({});
    t.register({ conversationId: 'c1', runId: 'r1' });
    t.register({ conversationId: 'c1', runId: 'r2' });
    t.register({ conversationId: 'c2', runId: 'r1' });
    expect(t.concurrentLiveRunIds({ conversationId: 'c1', runId: 'x' })).toEqual(['r2']);
    expect(t.concurrentLiveRunIds({ conversationId: 'c2', runId: 'x' })).toEqual(['r1']);
    expect(t.conversationIdForRun({ runId: 'r1' })).toBe('c2');
  });

  it('re-registering under the SAME conversation is idempotent', () => {
    const t = createLiveRunTracker({});
    t.register({ conversationId: 'c1', runId: 'r1' });
    t.register({ conversationId: 'c1', runId: 'r1' });
    expect(t.concurrentLiveRunIds({ conversationId: 'c1', runId: 'x' })).toEqual(['r1']);
  });

  it('concurrent ids exclude the asking run itself, among ≥3 runs, in registration order', () => {
    const t = createLiveRunTracker({});
    for (const runId of ['a', 'b', 'c']) t.register({ conversationId: 'c', runId });
    expect(t.concurrentLiveRunIds({ conversationId: 'c', runId: 'a' })).toEqual(['b', 'c']);
    expect(t.concurrentLiveRunIds({ conversationId: 'c', runId: 'b' })).toEqual(['a', 'c']);
    expect(t.concurrentLiveRunIds({ conversationId: 'c', runId: 'c' })).toEqual(['a', 'b']);
    expect(t.hasConcurrentLiveRun({ conversationId: 'c', runId: 'c' })).toBe(true);
  });

  it('a lone run has no concurrent peer; after its peer unregisters neither does the other', () => {
    const t = createLiveRunTracker({});
    t.register({ conversationId: 'c', runId: 'a' });
    expect(t.hasConcurrentLiveRun({ conversationId: 'c', runId: 'a' })).toBe(false);
    t.register({ conversationId: 'c', runId: 'b' });
    t.unregister({ conversationId: 'c', runId: 'b' });
    expect(t.hasConcurrentLiveRun({ conversationId: 'c', runId: 'a' })).toBe(false);
    expect(t.concurrentLiveRunIds({ conversationId: 'c', runId: 'zzz' })).toEqual(['a']);
  });

  it('unregister under the WRONG conversation keeps the run\'s conversation mapping', () => {
    const t = createLiveRunTracker({});
    t.register({ conversationId: 'c1', runId: 'r' });
    t.unregister({ conversationId: 'c2', runId: 'r' });
    expect(t.conversationIdForRun({ runId: 'r' })).toBe('c1');
    expect(t.concurrentLiveRunIds({ conversationId: 'c1', runId: 'x' })).toEqual(['r']);
  });
});

describe('waitForStoppingRuns — F1', () => {
  it('a peer whose cancellation subscription throws is treated as NOT stopping (no wait, no unregister)', async () => {
    const t = createLiveRunTracker({});
    t.register({ conversationId: 'c', runId: 'self' });
    t.register({ conversationId: 'c', runId: 'peer' });
    const waitForTerminal = vi.fn(async () => undefined);
    const schedule = vi.fn(() => () => undefined);
    await waitForStoppingRuns({
      tracker: t, conversationId: 'c', runId: 'self', scheduler: { schedule } as never,
      lifecycle: { onCancelRequested: () => { throw new Error('port down'); }, waitForTerminal },
    });
    expect(waitForTerminal).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(t.concurrentLiveRunIds({ conversationId: 'c', runId: 'self' })).toEqual(['peer']);
  });

  it('only cancelled peers are awaited and then unregistered; active peers stay', async () => {
    const t = createLiveRunTracker({});
    for (const runId of ['self', 'cancelled', 'active']) t.register({ conversationId: 'c', runId });
    const waitForTerminal = vi.fn(async () => undefined);
    const cancelTimer = vi.fn();
    await waitForStoppingRuns({
      tracker: t, conversationId: 'c', runId: 'self', scheduler: { schedule: vi.fn(() => cancelTimer) } as never,
      lifecycle: { onCancelRequested: ({ runId, listener }) => { if (runId === 'cancelled') listener(); return () => undefined; }, waitForTerminal },
    }, { timeoutMs: 5 });
    expect(waitForTerminal.mock.calls).toEqual([[{ runId: 'cancelled' }]]);
    expect(t.concurrentLiveRunIds({ conversationId: 'c', runId: 'self' })).toEqual(['active']);
    expect(cancelTimer).toHaveBeenCalledTimes(1);
  });
});
