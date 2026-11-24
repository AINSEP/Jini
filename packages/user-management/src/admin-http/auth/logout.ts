import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { requireAuthRequest, type LogoutAuth } from './auth-request.js';

export interface LogoutRouteDeps { readonly identityReady: Promise<unknown> }

/** `POST /api/admin/v1/auth/logout`: revokes this request's sessions and clears both cookies.
 * Failures are thrown so the host answers them like the login route instead of leaving the request hanging. */
export const logoutRoute = defineJsonRoute<Record<string, never>, { ok: true }, LogoutRouteDeps, LogoutAuth>({
  method: 'post',
  path: '/api/admin/v1/auth/logout',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    const auth = requireAuthRequest({ context });
    await deps.identityReady;
    await auth.revokeSessions();
    auth.cookies.clearSessions();
    return ok({ value: { ok: true as const } });
  },
});
