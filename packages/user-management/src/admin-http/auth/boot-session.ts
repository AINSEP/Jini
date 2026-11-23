import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { bodyRecord, refuse, requireAuthRequest, type AuthRequest } from './auth-request.js';
import { answerBootRedemption } from './boot-redemption.js';

/** The body stays unread until the loopback check passes. */
export interface BootSessionInput { readonly body: unknown }

/**
 * Exchange a single-use boot token for an ordinary admin session.
 *
 * Exists so a process that STARTED this server can prove it started it without knowing a
 * password. The token is minted only when the launcher asked for one, lives in this
 * process's memory for one launch, and is destroyed on first redemption
 * (the host's boot-session token store).
 *
 * **This route knows nothing about who is calling it.** No desktop/Electron branch, no
 * launcher-specific name — the contract is only "a valid single-use loopback token starts a
 * session", so nothing here has to change or be removed if a particular launcher goes away.
 *
 * Every rejection is a flat 401 with no distinguishing detail: unarmed, wrong, and already-spent
 * are indistinguishable to a caller, so this cannot be used as an oracle for whether a token
 * exists. There is deliberately NO arm in which an unminted token means "allow" — an unarmed
 * store refuses every input, so an ordinary server start (which mints nothing) has this route
 * present but permanently closed.
 *
 * The session it creates is an ordinary one: a real, revocable `sessions` row bound to the seeded
 * owner principal, resolved by the same `validateSession` and gated by the same `authorize()` as
 * a password login. Nothing downstream can tell the difference, and no bypass flag is threaded
 * anywhere.
 */
export const bootSessionRoute = defineJsonRoute<BootSessionInput, unknown, Record<string, never>, AuthRequest>({
  method: 'post',
  path: '/api/admin/v1/auth/boot-session',
  parse: raw => ok({ value: { body: raw.body } }),
  handle: async ({ input, context }) => {
    const auth = requireAuthRequest({ context });
    // Checked before the token is even looked at, so a remote caller cannot probe redemption.
    if (!auth.loopback) refuse({ status: 403, body: { error: 'boot-session is loopback-only', code: 'FORBIDDEN' } });
    const redemption = await auth.redeemBootSession({ token: bodyRecord({ body: input.body }).token });
    return ok({ value: answerBootRedemption({ redemption, auth }) });
  },
});
