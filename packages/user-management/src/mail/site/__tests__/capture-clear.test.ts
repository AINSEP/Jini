import { expect, it, vi } from 'vitest';
import { MAIL_CAPTURE_CLEAR_PERMISSION } from '@jini-ai/core/contracts/mail';
import { planMailCaptureClear } from '../capture-clear.js';

it('denied principal never reads captures', async () => {
  const refusal = new Error('forbidden');
  const deps = { checkPermission: vi.fn().mockResolvedValue({ allowed: false, reason: 'denied' }), forbidden: vi.fn(() => refusal),
    capture: { reviewCaptured: vi.fn(), clearReviewedCaptures: vi.fn() } };
  await expect(planMailCaptureClear({ principalId: 'member', workspaceId: 'site', deps })).rejects.toBe(refusal);
  expect(deps.forbidden).toHaveBeenCalledWith({ permission: MAIL_CAPTURE_CLEAR_PERMISSION });
  expect(deps.capture.reviewCaptured).not.toHaveBeenCalled();
});

it('clear forwards only the reviewed workspace and IDs', async () => {
  const captureIds = ['reviewed']; const attemptIds = ['attempt'];
  const plan = { count: 1, newestAt: '2026-11-25' };
  const capture = { reviewCaptured: vi.fn().mockResolvedValueOnce({ plan, revision: 'reviewed-revision', captureIds, attemptIds })
    .mockResolvedValue({ plan, revision: 'new-revision', captureIds: ['reviewed', 'new'], attemptIds: ['attempt', 'new'] }),
    clearReviewedCaptures: vi.fn().mockResolvedValue({ deleted: 1 }) };
  const binding = await planMailCaptureClear({ principalId: 'owner', workspaceId: 'site', deps: {
    capture, checkPermission: async () => ({ allowed: true, reason: 'owner' }), forbidden: () => new Error('forbidden'),
  } });
  expect(binding.plan).toBe(plan); expect(binding.revision).toBe('reviewed-revision');
  expect(await binding.clear()).toEqual({ cleared: true, deleted: 1 });
  expect(capture.reviewCaptured).toHaveBeenCalledTimes(1);
  expect(capture.clearReviewedCaptures).toHaveBeenCalledWith({ workspaceId: 'site', captureIds, attemptIds });
});
