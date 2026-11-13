/**
 * @file T23J (dedupe design, Tovu `development/refactor-patterns/dedupe/dedupe-06.terra-prompt.md`):
 * characterization of the bounded self-scheduling poll generalized from Tovu
 * `apps/admin/src/features/deployment/hooks/use-static-export.hooks.ts` (and its publish twin).
 * The loop's first fetch waits one interval, exactly like the Tovu copies. Written by the design
 * before the hook exists; RED until job 06 adds it.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoundedStatusPoll } from '../use-bounded-status-poll.hooks.js';

const INTERVAL_MS = 1000;
const FAILURE_LIMIT = 3;

interface Status { readonly status: 'running' | 'done' }

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS); });
  }
}

function harness(fetchStatus: () => Promise<Status>) {
  const fetch = vi.fn(fetchStatus);
  const onGiveUp = vi.fn();
  const statuses: Status[] = [];
  const view = renderHook(
    ({ active, onStatus }: { active: boolean; onStatus: (required: { status: Status }) => void }) => useBoundedStatusPoll<Status>({
      active,
      intervalMs: INTERVAL_MS,
      failureLimit: FAILURE_LIMIT,
      fetchStatus: fetch,
      onStatus,
      shouldContinue: ({ status }) => status.status === 'running',
      onGiveUp,
    }),
    { initialProps: { active: true, onStatus: ({ status }: { status: Status }) => { statuses.push(status); } } },
  );
  return { ...view, fetch, onGiveUp, statuses };
}

describe('useBoundedStatusPoll (T23J)', () => {
  it('polls every interval while the status says running', async () => {
    const { fetch, statuses } = harness(async () => ({ status: 'running' }));
    expect(fetch).not.toHaveBeenCalled();
    await tick(3);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(statuses).toHaveLength(3);
  });

  it('re-arms only when active flips to true; a new onStatus identity does not re-arm', async () => {
    const { fetch, rerender } = harness(async () => ({ status: 'running' }));
    await tick(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    // A new onStatus identity HALF-WAY through the wait must not restart the timer. Rerendering
    // right after a tick would not catch a restart: a restarted timer would fire at that same
    // deadline. So wait half an interval first; then the original deadline is the next
    // half-interval, while a restarted timer would fire a whole interval after the rerender.
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS / 2); });
    rerender({ active: true, onStatus: () => {} });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS / 2); });
    expect(fetch).toHaveBeenCalledTimes(2);

    rerender({ active: false, onStatus: () => {} });
    await tick(3);
    expect(fetch).toHaveBeenCalledTimes(2);

    rerender({ active: true, onStatus: () => {} });
    await tick(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a success resets the consecutive-failure count', async () => {
    const script: Array<'fail' | 'ok'> = ['fail', 'fail', 'ok', 'fail', 'fail', 'ok'];
    const { fetch, onGiveUp } = harness(async () => {
      if (script.shift() === 'fail') throw new Error('network');
      return { status: 'running' };
    });
    await tick(6);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('failureLimit consecutive failures call onGiveUp once and stop fetching', async () => {
    const error = new Error('down');
    const { fetch, onGiveUp } = harness(async () => { throw error; });
    await tick(FAILURE_LIMIT);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith({ error });
    await tick(5);
    expect(fetch).toHaveBeenCalledTimes(FAILURE_LIMIT);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('stops when shouldContinue is false', async () => {
    const { fetch, statuses } = harness(async () => ({ status: 'done' }));
    await tick(1);
    expect(statuses).toEqual([{ status: 'done' }]);
    await tick(5);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('unmount mid-wait fetches nothing more', async () => {
    const { fetch, unmount } = harness(async () => ({ status: 'running' }));
    await tick(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(INTERVAL_MS / 2); });
    unmount();
    await tick(5);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
