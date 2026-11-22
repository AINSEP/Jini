import { describe, expect, it, vi } from 'vitest';
import { ensureSession } from '../ensure.js';

describe('ensureSession', () => {
  it('reuses a confirmed session without redeeming', async () => {
    const probe = vi.fn(async () => true);
    const redeem = vi.fn(async () => true);
    expect(await ensureSession({ probe, redeem })).toEqual({ authenticated: true, redeemed: false });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(redeem).not.toHaveBeenCalled();
  });

  it.each([true, false])('redeems once after a failed probe and reports %s', async (authenticated) => {
    const calls: string[] = [];
    const probe = vi.fn(async () => { calls.push('probe'); return false; });
    const redeem = vi.fn(async () => { calls.push('redeem'); return authenticated; });
    expect(await ensureSession({ probe, redeem }, {})).toEqual({ authenticated, redeemed: true });
    expect(calls).toEqual(['probe', 'redeem']);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejecting probe without redeeming', async () => {
    const error = new Error('probe failed');
    const probe = vi.fn(async () => { throw error; });
    const redeem = vi.fn(async () => true);
    await expect(ensureSession({ probe, redeem })).rejects.toBe(error);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(redeem).not.toHaveBeenCalled();
  });
});
