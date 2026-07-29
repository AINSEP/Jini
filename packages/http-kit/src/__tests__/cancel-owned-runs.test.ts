import { describe, expect, it, vi } from 'vitest';
import { cancelRunsOwnedBy, type RunCancellationService } from '../cancel-owned-runs.js';

function fakeRuns(runs: RunCancellationService): RunCancellationService {
  return runs;
}

describe('cancelRunsOwnedBy', () => {
  it('cancels every non-terminal run for the given contextRef', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const runs = fakeRuns({
      list: vi.fn().mockResolvedValue([
        { id: 'run-1', state: 'running' },
        { id: 'run-2', state: 'queued' },
        { id: 'run-3', state: 'succeeded' },
      ]),
      cancel,
    });

    await cancelRunsOwnedBy(runs, 'ctx-1');

    expect(runs.list).toHaveBeenCalledWith('ctx-1');
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(cancel).toHaveBeenCalledWith({ runId: 'run-2' });
  });

  it('does not call cancel when every run is already terminal', async () => {
    const cancel = vi.fn();
    const runs = fakeRuns({
      list: vi.fn().mockResolvedValue([
        { id: 'run-1', state: 'succeeded' },
        { id: 'run-2', state: 'failed' },
        { id: 'run-3', state: 'cancelled' },
      ]),
      cancel,
    });

    await cancelRunsOwnedBy(runs, 'ctx-1');

    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not call cancel when list returns no runs', async () => {
    const cancel = vi.fn();
    const runs = fakeRuns({ list: vi.fn().mockResolvedValue([]), cancel });

    await cancelRunsOwnedBy(runs, 'ctx-empty');

    expect(cancel).not.toHaveBeenCalled();
  });

  it('swallows a per-run cancellation failure so it never rejects', async () => {
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const runs = fakeRuns({
      list: vi.fn().mockResolvedValue([
        { id: 'run-1', state: 'running' },
        { id: 'run-2', state: 'running' },
      ]),
      cancel,
    });

    await expect(cancelRunsOwnedBy(runs, 'ctx-1')).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
