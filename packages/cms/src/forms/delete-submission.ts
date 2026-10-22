import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort, UUID } from "@jini-ai/core/primitives";

import type { FormSubmissionRepoPort, RemoveFormSubmissionFn } from "./ports.js";

/**
 * @file Deleting one form submission = moving it to the Trash. The Trash itself is injected as
 * `remove` (bound to the `"form_submission"` type at the composition root), so this feature never
 * imports `features/trash`. A purge from the Trash (a human, or the 60-day sweeper) is the only thing
 * that removes a submission for good.
 */

export type DeleteFormSubmissionOutcome =
  | { ok: true }
  | { ok: false; reason: "not-found" | "version-changed" };

/**
 * Moves a submission of `form` to the Trash. A submission of another form, an already-trashed one,
 * or a missing one is `not-found` — the caller cannot delete what it cannot see.
 *
 * The Trash row shows the form's name and the submission time, never the visitor's data.
 *
 * @complexity O(1): one read, one `remove` call.
 */
export async function deleteFormSubmission(
  required: {
    submissionRepo: FormSubmissionRepoPort;
    remove: RemoveFormSubmissionFn;
    clock: ClockPort;
    workspaceId: UUID;
    form: { id: UUID; name: string };
    submissionId: UUID;
    actor: { principalId: string; pluginId?: string | null };
  },
  _optional: Record<string, never> = {}
): Promise<DeleteFormSubmissionOutcome> {
  const submission = await required.submissionRepo.findById({ workspaceId: required.workspaceId, id: required.submissionId });
  if (!submission || submission.formDefinitionId !== required.form.id) return { ok: false, reason: "not-found" };

  const removed = await required.remove({
    workspaceId: required.workspaceId,
    id: submission.id,
    display: { title: required.form.name, subtitle: submission.submittedAt },
    at: clockNowIso({ clock: required.clock }),
    // Submissions are never edited, so there is no concurrent write to guard against.
    expectedVersion: null,
    actor: required.actor,
  });
  return removed.ok ? { ok: true } : { ok: false, reason: removed.reason };
}
