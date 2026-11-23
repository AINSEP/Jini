import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { requireAuthRequest, type CurrentPrincipalAuth } from './auth-request.js';
import { signedInPrincipal } from './current-user.js';

export interface PasswordStatusRouteDeps {
  readonly workspaceId: string;
  readonly findUserByPrincipalId: (required: { workspaceId: string; principalId: string }) => Promise<{ readonly passwordHash: string } | null | undefined>;
  readonly verifyPassword: (required: { hash: string; password: string }) => Promise<boolean>;
  /** The host's seeded owner password; the banner warns while the caller's own row still verifies against it. */
  readonly defaultOwnerPassword: string;
}

/** `GET /api/admin/v1/auth/me/password-status`, one per registration.
 *
 * Tells the DASHBOARD (not deployment-overview, which is owner-only and `system.read`-gated)
 * whether the SIGNED-IN CALLER's own stored credential still verifies against the default owner
 * password. No extra permission is needed — it's a check against your own row, so it can't be used
 * to probe anyone else's password. Deliberately a separate route from `/auth/me` rather than a
 * field on it: that route runs on every admin boot, and only the dashboard needs the ~tens-of-ms
 * argon2id verify this adds.
 *
 * Results are memoized by the stored hash: argon2id is deliberately expensive, and a signed-in
 * session could otherwise call this in a loop. A hash is salted per write, so any password change
 * produces a new key and is re-verified — the cache can never report a stale answer. Capped and
 * cleared wholesale; it only holds hashes already in the DB and booleans.
 */
export function createPasswordStatusRoute(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const defaultPasswordByHash = new Map<string, boolean>();
  const usesDefaultPasswordFor = async ({ passwordHash, deps }: { passwordHash: string; deps: PasswordStatusRouteDeps }): Promise<boolean> => {
    const cached = defaultPasswordByHash.get(passwordHash);
    if (cached !== undefined) return cached;
    const result = await deps.verifyPassword({ hash: passwordHash, password: deps.defaultOwnerPassword });
    if (defaultPasswordByHash.size >= 256) defaultPasswordByHash.clear();
    defaultPasswordByHash.set(passwordHash, result);
    return result;
  };
  return defineJsonRoute<Record<string, never>, { usesDefaultPassword: boolean }, PasswordStatusRouteDeps, CurrentPrincipalAuth>({
    method: 'get',
    path: '/api/admin/v1/auth/me/password-status',
    parse: () => ok({ value: {} }),
    handle: async ({ deps, context }) => {
      const principal = await signedInPrincipal({ auth: requireAuthRequest({ context }) });
      const userRow = await deps.findUserByPrincipalId({ workspaceId: deps.workspaceId, principalId: principal.id });
      const usesDefaultPassword = userRow ? await usesDefaultPasswordFor({ passwordHash: userRow.passwordHash, deps }) : false;
      return ok({ value: { usesDefaultPassword } });
    },
  });
}
