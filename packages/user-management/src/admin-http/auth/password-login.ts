import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { AuthInvalidCredentialsError } from '../../core/types.js';
import { bodyRecord, refuse, requireAuthRequest, type AuthPrincipal, type AuthSessionOptions, type SignInAuth } from './auth-request.js';

export type PasswordLoginOutcome =
  | { readonly mfaRequired: true; readonly [field: string]: unknown }
  | { readonly principal: AuthPrincipal; readonly session: { readonly expiresAt: string }; readonly rawToken: string };
type SignIn = (required: { input: { workspaceId: string; username: string; password: string } }, optional: AuthSessionOptions) => Promise<PasswordLoginOutcome>;
/** Only the fields this route reads. The host pre-binds both sign-in services to its identity deps. */
export interface PasswordLoginRouteDeps {
  readonly identityReady: Promise<unknown>;
  readonly workspaceId: string;
  /** Present when owner MFA is configured; the route then starts the owner login, which may challenge. */
  readonly mfaStore?: unknown;
  readonly login: SignIn;
  readonly beginOwnerLogin: SignIn;
}
/** The JSON body, carried uncoerced: credential fields are coerced only after readiness and the limiter. */
export interface PasswordLoginInput { readonly body: Readonly<Record<string, unknown>> }

/**
 * Coerced exactly as the original route did: any value becomes its string form, absence becomes "".
 * Some valid JSON values (`{"toString":1}`) throw here, so this runs inside the handler's error
 * boundary and after the limiter: a denied request always gets its exact 429.
 */
function credentialFields({ body }: PasswordLoginInput): { username: string; password: string } {
  return { username: String(body.username ?? ''), password: String(body.password ?? '') };
}

/** Wrong credentials are a deliberate 401; every other failure is the host's to report. */
async function refusingInvalidCredentials<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof AuthInvalidCredentialsError) refuse({ status: 401, body: { error: 'invalid username or password', code: 'UNAUTHENTICATED' } });
    throw error;
  }
}

async function passwordLogin({ input, deps, auth }: { input: PasswordLoginInput; deps: PasswordLoginRouteDeps; auth: SignInAuth }) {
  await deps.identityReady;
  const rate = await auth.rateLimit.check();
  if (!rate.allowed) {
    auth.retryAfter(rate.retryAfterSeconds);
    refuse({ status: 429, body: { error: 'too many login attempts', code: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: rate.retryAfterSeconds } } });
  }
  const { username, password } = credentialFields(input);
  const signIn = deps.mfaStore ? deps.beginOwnerLogin : deps.login;
  const result = await signIn({ input: { workspaceId: deps.workspaceId, username, password } }, auth.sessionOptions());
  // Cache-Control is set only once the credentials succeeded; the 401 and 429 answers never carry it.
  auth.noStore();
  if ('mfaRequired' in result) return result;
  const { principal, session, rawToken } = result;
  // Credentials succeeded; revoke both superseded bearers before clearing/replacing cookies.
  await auth.revokeSessions();
  auth.cookies.replaceSession({ rawToken, expiresAtIso: session.expiresAt });
  auth.signedIn({ principalId: principal.id });
  return { user: { id: principal.id, username } };
}

/** `POST /api/admin/v1/auth/login`: password sign-in, or the start of an owner MFA challenge. */
export const passwordLoginRoute = defineJsonRoute<PasswordLoginInput, unknown, PasswordLoginRouteDeps, SignInAuth>({
  method: 'post',
  path: '/api/admin/v1/auth/login',
  // Total: the body is carried through; coercion happens in the handler after the limiter.
  parse: raw => ok({ value: { body: bodyRecord({ body: raw.body }) } }),
  handle: async ({ input, deps, context }) => ok({ value: await refusingInvalidCredentials(() => passwordLogin({ input, deps, auth: requireAuthRequest({ context }) })) }),
});
