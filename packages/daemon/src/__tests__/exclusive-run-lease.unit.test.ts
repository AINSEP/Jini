import { describe, expect, it } from 'vitest';
import { createExclusiveRunLease } from '../exclusive-run-lease.js';

describe('createExclusiveRunLease', () => {
  it('grants the first run, refuses a second run naming the holder, and re-grants the holder', () => {
    const lease = createExclusiveRunLease({});
    expect(lease.acquire({ runId: 'a' })).toEqual({ granted: true });
    expect(lease.acquire({ runId: 'b' })).toEqual({ granted: false, holder: 'a' });
    expect(lease.acquire({ runId: 'a' })).toEqual({ granted: true });
    expect(lease.holder()).toBe('a');
  });

  it('lets another run acquire once the holder releases', () => {
    const lease = createExclusiveRunLease({});
    lease.acquire({ runId: 'a' });
    lease.release({ runId: 'a' });
    expect(lease.holder()).toBeUndefined();
    expect(lease.acquire({ runId: 'b' })).toEqual({ granted: true });
    expect(lease.holder()).toBe('b');
  });

  it('release is idempotent and a non-holder release is a no-op', () => {
    const lease = createExclusiveRunLease({});
    lease.acquire({ runId: 'a' });
    lease.release({ runId: 'b' });
    expect(lease.holder()).toBe('a');
    lease.release({ runId: 'a' });
    lease.release({ runId: 'a' });
    expect(lease.holder()).toBeUndefined();
    expect(lease.acquire({ runId: 'b' })).toEqual({ granted: true });
  });

  it('keeps separate leases independent of each other', () => {
    const first = createExclusiveRunLease({});
    const second = createExclusiveRunLease({});
    first.acquire({ runId: 'a' });
    expect(second.acquire({ runId: 'b' })).toEqual({ granted: true });
  });
});
