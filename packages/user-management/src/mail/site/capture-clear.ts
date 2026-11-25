import { MAIL_CAPTURE_CLEAR_PERMISSION, type MailCaptureClearPlan, type MailCaptureClearResult } from "@jini-ai/core/contracts/mail";

/**
 * @file "Clear all" captured test emails (owner decision 2026-11-23, bt2-todos G7-7/848): the plan
 * the `POST system/mail-capture/clear` preview answers and the confirmed clear bound to it. The
 * route (`@jini-ai/cms/admin-http/routes/system/mail-activity`) only clears when the request is
 * confirmed with the revision of this plan. The revision names the exact reviewed set of captures
 * (not its count and newest time), and the clear deletes only those ids: a capture that arrived
 * after the review is never deleted unseen. "Test emails" are exactly what the Activity list shows
 * as kept locally: stored test-mode captures and console-driver sends (which store no copy).
 */

/** What `planMailCaptureClear` reads and deletes through, and how it asks for the owner grant. */
export interface MailCaptureClearDeps {
  capture: {
    reviewCaptured(required: { workspaceId: string }): Promise<{ plan: MailCaptureClearPlan; revision: string; captureIds: readonly string[]; attemptIds: readonly string[] }>;
    clearReviewedCaptures(required: { workspaceId: string; captureIds: readonly string[]; attemptIds: readonly string[] }): Promise<{ deleted: number }>;
  };
  forbidden: (required: { permission: string }, optional?: Record<string, never>) => Error;
  checkPermission: (required: { principalId: string; permission: string }) => Promise<{ allowed: boolean; reason: string }>;
}

export interface MailCaptureClearBinding {
  plan: MailCaptureClearPlan;
  revision: string;
  clear: () => Promise<MailCaptureClearResult>;
}

/**
 * Plans clearing the captured test emails of `workspaceId` as `principalId`.
 * @returns `{ plan: { count, newestAt }, revision, clear }`; `clear` deletes only the reviewed
 *   captures of this workspace and answers `{ cleared: true, deleted }`.
 * @throws MailActivityForbiddenError without `mail.capture.clear`, before anything is read.
 * @complexity One permission check and one indexed id read; `clear` is one id-bound delete transaction.
 */
export async function planMailCaptureClear(
  { principalId, workspaceId, deps }: { principalId: string; workspaceId: string; deps: MailCaptureClearDeps },
  _optional: Record<string, never> = {},
): Promise<MailCaptureClearBinding> {
  const grant = await deps.checkPermission({ principalId, permission: MAIL_CAPTURE_CLEAR_PERMISSION });
  if (!grant.allowed) {
    throw deps.forbidden({ permission: MAIL_CAPTURE_CLEAR_PERMISSION });
  }
  const { plan, captureIds, attemptIds, revision } = await deps.capture.reviewCaptured({ workspaceId });
  return {
    plan,
    revision,
    clear: async () => ({ cleared: true, deleted: (await deps.capture.clearReviewedCaptures({ workspaceId, captureIds, attemptIds })).deleted }),
  };
}
