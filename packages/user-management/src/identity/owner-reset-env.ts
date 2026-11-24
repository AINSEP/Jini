import { resolveOwnerResetTarget, resetOwnerPassword, type OwnerRecoveryDeps } from '../server/recovery-codes.js';

/**
 * Incident-driven (2026-09-03): the admin UI's own "Reset password" flow was used against
 * production, closed with no error, and afterward NEITHER the old nor the new password could log
 * in. Tracing `Users.tsx` -> `api.ts` -> the `reset-password` route -> `@jini-ai/cms`'s
 * `resetUserPassword` -> `Argon2PasswordHasher` found the LOCAL source of every one of those to be
 * logically correct (same hasher instance hashes and verifies; no double-hash; no wrong-field
 * write) — but the host's production image installs `@jini-ai/cms` from the npm registry
 * (`check-no-linked-jini.mjs`), not from this local Jini checkout, so a bug specific to the
 * published package (or to something else entirely) cannot be ruled out from here. This module
 * exists to make that irrelevant: it does not trust that a write succeeded just because
 * `resetUserPassword` returned without throwing — it re-reads the row fresh and calls
 * `hasher.verify()` against the exact password just set, through the SAME hasher instance the real
 * login path (`auth-service.ts`'s `login()`) uses. A hash that was written but does not verify is
 * exactly the failure this incident produced, and is now caught here instead of reported as
 * success.
 *
 * Boot keeps a pre-write restore point (scope boot-admin-password-reset), captured anew for each
 * actual password change. Jini now verifies inside the identity transaction and rolls back a failed
 * verification, instead of restoring an open database inode. The snapshot remains available for
 * operator recovery; a manual file restore requires a restart to reopen the restored database.
 * A satisfied host secret skips hashing, session revocation and the full-database copy.
 */

/** Thin host-secret adapter shared by boot and CLI; identity rules and reset live in Jini.
 * A secret left set must not re-salt the credential or revoke sessions again on every boot.
 * @returns Current owner username for safe completion output; never returns the password/hash.
 * @complexity O(1) when satisfied; otherwise O(s) for the existing reset's owner session revocation.
 */
export async function applyOwnerPasswordReset(
  { deps, workspaceId, password, username }: { deps: OwnerRecoveryDeps; workspaceId: string; password: string; username?: string },
  { beforeReset }: { beforeReset?: () => Promise<unknown> } = {},
): Promise<string> {
  const input = { workspaceId, principalId: deps.seededOwnerPrincipalId };
  const owner = await resolveOwnerResetTarget({ deps, input: { ...input, ...(username === undefined ? {} : { username }) } }, {});
  if (!await deps.auth.hasher.verify({ hash: owner.passwordHash, password })) {
    await beforeReset?.();
    await resetOwnerPassword({ deps, input: { ...input, password } }, {});
  }
  return owner.username;
}
