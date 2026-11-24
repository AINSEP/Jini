import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { MFA_PROOF_REFUSED_MESSAGE, MfaProofRefusedError } from '../../core/types.js';
import { bodyRecord, refuse, requireAuthRequest, type AuthPrincipal, type AuthSessionOptions, type SignInAuth } from './auth-request.js';

export interface MfaLoginRouteDeps {
  readonly workspaceId: string;
  readonly completeOwnerLogin: (required: { input: { workspaceId: string; pendingToken: string; code: string } }, optional: AuthSessionOptions) =>
    Promise<{ readonly principal: AuthPrincipal; readonly session: { readonly expiresAt: string }; readonly rawToken: string }>;
  readonly findUserByPrincipalId: (required: { workspaceId: string; principalId: string }) => Promise<{ readonly username: string } | null | undefined>;
}
export interface MfaLoginInput { readonly pendingToken: string; readonly code: string }

/** MFA proofs are strings; objects/numbers never become bearer tokens by coercion. O(1). */
function mfaBodyText(body: Readonly<Record<string, unknown>>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

async function mfaLogin({ input, deps, auth }: { input: MfaLoginInput; deps: MfaLoginRouteDeps; auth: SignInAuth }) {
  const rate = await auth.rateLimit.check();
  if (!rate.allowed) {
    auth.retryAfter(rate.retryAfterSeconds);
    refuse({ status: 429, body: { error: 'Too many authenticator attempts. Wait a minute and try again.', code: 'RATE_LIMIT_EXCEEDED' } });
  }
  const result = await deps.completeOwnerLogin({ input: { workspaceId: deps.workspaceId, pendingToken: input.pendingToken, code: input.code } }, auth.sessionOptions());
  await auth.revokeSessions();
  auth.cookies.replaceSession({ rawToken: result.rawToken, expiresAtIso: result.session.expiresAt });
  const user = await deps.findUserByPrincipalId({ workspaceId: deps.workspaceId, principalId: result.principal.id });
  auth.signedIn({ principalId: result.principal.id });
  return { user: { id: result.principal.id, username: user?.username ?? result.principal.displayName } };
}

/** `POST /api/admin/v1/auth/mfa/login`: completes an owner MFA challenge. */
export const mfaLoginRoute = defineJsonRoute<MfaLoginInput, unknown, MfaLoginRouteDeps, SignInAuth>({
  method: 'post',
  path: '/api/admin/v1/auth/mfa/login',
  parse: raw => { const body = bodyRecord({ body: raw.body }); return ok({ value: { pendingToken: mfaBodyText(body, 'pendingToken'), code: mfaBodyText(body, 'code') } }); },
  handle: async ({ input, deps, context }) => {
    const auth = requireAuthRequest({ context });
    // Every answer, refusals and failures included, is uncacheable: set before anything can throw.
    auth.noStore();
    try { return ok({ value: await mfaLogin({ input, deps, auth }) }); } catch (error) {
      // Only the classified proof refusal is public, with its fixed text; any other failure (an injected
      // collaborator's validation error can echo the proof) goes to the host's redacted envelope.
      if (error instanceof MfaProofRefusedError) refuse({ status: 400, body: { error: MFA_PROOF_REFUSED_MESSAGE, code: 'MFA_REFUSED' } });
      throw error;
    }
  },
});
