import type { MailActivityDeps, MailSuppressionDeps } from "@jini-ai/core/contracts/site/platform-mail";
import { MAIL_PERMISSION_IDS } from "./permissions.js";

/**
 * @file The host's binding of the activity and suppression operations in `@jini-ai/platform/mail`
 * (email phases 4-5): behind `mail_list_activity`, `mail_get_activity`, `mail_list_suppressions`,
 * `mail_remove_suppression` and the admin routes `system/mail-activity` and
 * `system/mail-suppressions[/remove]`. Removal needs a fresh confirmation every time: the tool's
 * card has no remember option and the route performs only with `confirmed: true`. The owner-only
 * rule for removal is declared with the permission ids in `./permissions.ts`.
 */

/** What the host's deps bag supplies to the activity and suppression operations. */
export type MailHostActivityDeps = Omit<MailActivityDeps, "permissions"> & Omit<MailSuppressionDeps, "permissions">;

/**
 * Binds this site's permission ids to the host deps for ONE call of an activity or suppression
 * operation. Read per call, never captured at registration: `ownerPrincipalId` and the repos are
 * read from the bag at the moment of the call, exactly as the operations did before they took
 * their permission ids as input.
 *
 * @param required.deps - The host deps bag (route deps in production).
 * @returns The deps object the operations take.
 * @complexity O(1).
 */
export function mailDomainDepsFrom({ deps }: { deps: MailHostActivityDeps }, _optional: Record<string, never> = {}): MailActivityDeps & MailSuppressionDeps {
  return {
    workspaceId: deps.workspaceId,
    authorize: deps.authorize,
    permissions: MAIL_PERMISSION_IDS,
    // Absent stays absent (exact optional properties): the operations treat a missing repo as unavailable.
    ...(deps.ownerPrincipalId === undefined ? {} : { ownerPrincipalId: deps.ownerPrincipalId }),
    ...(deps.mailActivity === undefined ? {} : { mailActivity: deps.mailActivity }),
    ...(deps.mailSuppressionAdmin === undefined ? {} : { mailSuppressionAdmin: deps.mailSuppressionAdmin }),
  };
}
