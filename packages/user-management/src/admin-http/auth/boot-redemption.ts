import { OwnerAuthFailure, refuse, type AuthRequest, type BootRedemption } from './auth-request.js';

/** Turns a redemption into the route's answer. Every rejection is one flat 401 with no detail, so
 * unarmed, wrong and already-spent tokens are indistinguishable to a caller. The sign-in signal
 * fires only after the host has installed the session cookie. */
export function answerBootRedemption({ redemption, auth }: { redemption: BootRedemption; auth: AuthRequest }, _optional: Record<string, never> = {}): unknown {
  if (redemption.kind === 'refused') refuse({ status: 401, body: { error: 'invalid or spent boot token', code: 'UNAUTHENTICATED' } });
  if (redemption.kind === 'mfa') { auth.noStore(); return redemption.body; }
  if (redemption.kind === 'failure') throw new OwnerAuthFailure({ error: redemption.error, operation: 'boot-session' });
  auth.signedIn({ principalId: redemption.principal.id });
  return { user: { id: redemption.principal.id } };
}
