import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { refuse, requireAuthRequest, type AuthPrincipal, type CurrentPrincipalAuth } from './auth-request.js';

export interface CurrentUserRouteDeps {
  readonly workspaceId: string;
  readonly findUserByPrincipalId: (required: { workspaceId: string; principalId: string }) => Promise<{ readonly username: string } | null | undefined>;
  readonly effectivePermissions: (required: { workspaceId: string; principalId: string }) => Promise<readonly string[]>;
  /** Owner or the built-in admin role, which deliberately holds no `user.manage`/`*` grant; a permission
   * string check alone would hide a working affordance from an admin-role caller. */
  readonly callerMayManageUserTrash: (required: { workspaceId: string; callerPrincipalId: string }) => Promise<boolean>;
  readonly canPublishToLive: () => boolean;
}

/** The signed-in principal, or the flat 401 every `/auth/me*` route answers without one. */
export async function signedInPrincipal({ auth }: { auth: CurrentPrincipalAuth }, _optional: Record<string, never> = {}): Promise<AuthPrincipal> {
  const principal = await auth.currentPrincipal();
  if (!principal) refuse({ status: 401, body: { error: 'unauthenticated', code: 'UNAUTHENTICATED' } });
  return principal;
}

/** `GET /api/admin/v1/auth/me`: who is signed in and which affordances to show. */
export const currentUserRoute = defineJsonRoute<Record<string, never>, unknown, CurrentUserRouteDeps, CurrentPrincipalAuth>({
  method: 'get',
  path: '/api/admin/v1/auth/me',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    const principal = await signedInPrincipal({ auth: requireAuthRequest({ context }) });
    const principalId = principal.id; const workspaceId = deps.workspaceId;
    const userRow = await deps.findUserByPrincipalId({ workspaceId, principalId });
    const effectivePermissions = await deps.effectivePermissions({ workspaceId, principalId });
    // The same check the trash routes gate on, so this affordance flag can never drift from the
    // real boundary. Not itself a security boundary.
    const canManageUserTrash = await deps.callerMayManageUserTrash({ workspaceId, callerPrincipalId: principalId });
    return ok({ value: {
      user: { id: principalId, username: userRow?.username ?? principal.displayName },
      effectivePermissions,
      canManageUserTrash,
      // Affordance flag, not the boundary: the admin hides every Publish entry point when this is
      // `false` (the live site); the push routes refuse on their own.
      canPublishToLive: deps.canPublishToLive(),
    } });
  },
});
