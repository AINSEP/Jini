import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { refuse, requireAuthRequest, type AuthRequest } from './auth-request.js';
import { answerBootRedemption } from './boot-redemption.js';

/** A desktop launch signs its own browser in without exposing a raw boot token.
 * Desktop must present its private launch capability before browser-style header admission.
 * The browser has no private parent stdout pipe. A launcher-armed, same-origin loopback
 * request uses a request-scoped one-time token; no raw boot token is exposed to JS or logs.
 * Separate stores prevent concurrent tabs, or the desktop's still-armed token, burning each other.
 */
export const localBootSessionRoute = defineJsonRoute<Record<string, never>, unknown, Record<string, never>, AuthRequest>({
  method: 'post',
  path: '/api/admin/v1/auth/local-boot-session',
  parse: () => ok({ value: {} }),
  handle: async ({ context }) => {
    const auth = requireAuthRequest({ context });
    const policy = auth.localOwnerSignIn;
    if (!policy.enabled || !policy.acceptsCapability()) refuse({ status: 404, body: { error: 'local owner sign-in is disabled', code: 'NOT_FOUND' } });
    if (!auth.loopback || !policy.allowsRequest()) refuse({ status: 403, body: { error: 'local owner sign-in requires a same-origin loopback request', code: 'FORBIDDEN' } });
    auth.noStore();
    // Keep an existing human session; auto sign-in must never promote a non-owner account.
    const existing = await auth.currentPrincipal();
    if (existing) return ok({ value: { user: { id: existing.id } } });
    const redemption = await auth.redeemBootSession({ token: undefined }, { mintLocal: true });
    return ok({ value: answerBootRedemption({ redemption, auth }) });
  },
});
