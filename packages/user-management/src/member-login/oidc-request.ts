import { completeOidcLogin, openLoginEmailContinuation, sealLoginEmailContinuation, type LoginContext, type OidcLoginDeps } from './oidc-login.js';
import { requestLoginEmailProof, resolveFederatedIdentity, type MemberLoginLinkDeps, type MemberLoginLinkResult } from './link-service.js';
import { MemberLoginError } from '../server/login-types.js';
import type { MemberSignInResult } from '../members/ports.js';

/** The shared member delivery limits for this top-level browser page. The API routes answer a
 * refusal with 429 JSON; here the one-time code is already spent, so a refusal becomes the fixed
 * sign-in error redirect instead (the route's catch), and the limiter's own response is discarded.
 * @throws {MemberLoginError} LOGIN_UNAVAILABLE when a limit refuses. @complexity O(1) limiter checks.
 */
export async function requireOidcContinuationDelivery(required: {
  check: () => Promise<boolean>;
}, _optional = {}): Promise<void> {
  const allowed = await required.check();
  if (!allowed) throw new MemberLoginError({ code: 'LOGIN_UNAVAILABLE' });
}

/** Query parser rejects repeated/object values before OAuth can receive ambiguous credentials.
 * Provider denial takes the same fixed error path, after clearing the browser cookie; Cancel
 * (`access_denied`) only picks a kinder message. O(k) keys.
 */
export function readOidcCallbackParams({ query, cancelled }: {
  query: Readonly<Record<string, unknown>>; cancelled: (required: Record<string, never>) => Error;
}, _optional = {}): { code: string; state: string } {
  const { code, state, error } = query;
  if (error === 'access_denied') throw cancelled({});
  if (error !== undefined || typeof code !== 'string' || typeof state !== 'string') throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  if (!code || code.length > 4096 || !state || state.length > 16384) throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  return { code, state };
}

/** Strict JSON DTO; callers cannot inject claims, intent or proof booleans. O(k) body keys. */
export function readOidcEmailProof({ body }: { body: unknown }, _optional = {}): { continuation: string; challengeId: string; code: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !Object.keys(record).every(key => ['continuation', 'challengeId', 'code'].includes(key))) throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  const continuation = proofString({ value: record.continuation, maxLength: 8192 });
  const challengeId = proofString({ value: record.challengeId, maxLength: 255 });
  if (typeof record.code !== 'string' || !/^\d{6}$/.test(record.code)) throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  return { continuation, challengeId, code: record.code };
}

/** Bound opaque handles before cryptography or challenge repository work. O(1). */
function proofString({ value, maxLength }: { value: unknown; maxLength: number }, _optional = {}): string {
  if (typeof value !== 'string' || !value || value.length > maxLength) throw new MemberLoginError({ code: 'LOGIN_INVALID' });
  return value;
}

export type OidcCallbackResult = { kind: 'signed_in'; result: MemberSignInResult }
  | { kind: 'email_verification_required'; continueByEmail: () => Promise<{ browserBinding: string; location: string }> };

/** The protocol leg of the callback for this request: live member intent, the unique binding cookie, the
 * strict query parser, the one-time code exchange (S2) and the federated-identity link — then either the
 * signed-in session (cookie + event, written by the spec after it clears the proof cookie) or the email proof.
 * @complexity O(1) protocol/transaction calls; S2 owns bounded exchange and indexed persistence.
 */
export async function completeMemberOidcCallback(required: {
  context: LoginContext; protocol: OidcLoginDeps; links: MemberLoginLinkDeps;
  browserBinding: (required: Record<string, never>) => string;
  query: (required: Record<string, never>) => Readonly<Record<string, unknown>>;
  cancelled: (required: Record<string, never>) => Error;
  userAgent: string | undefined; ip: string;
  deliveryAllowed: (required: { email: string }) => Promise<void>;
  continuationLocation: (required: { providerId: string; challengeId: string; continuation: string }) => string;
}, _optional = {}): Promise<OidcCallbackResult> {
  const { context, protocol, browserBinding: readBinding, query, cancelled, deliveryAllowed, continuationLocation } = required;
  const browserBinding = readBinding({});
  const login = await completeOidcLogin({ deps: protocol, input: { ...context, browserBinding, params: readOidcCallbackParams({ query: query({}), cancelled }) } });
  const { links, userAgent, ip } = required;
  const linked = await resolveFederatedIdentity({ deps: links, input: { workspaceId: context.workspaceId,
    identity: login.identity, startedAt: login.startedAt, ...(login.connectMemberId === undefined ? {} : { connectMemberId: login.connectMemberId }),
    ...(userAgent === undefined ? {} : { userAgent }), ip } });
  if (linked.kind === 'email_verification_required') {
/** Keep validated identity sealed and browser-bound while the existing challenge owner proves
 * a non-authoritative mailbox. Fragment data is removed by U1 before rendering; no OAuth tokens.
 * @returns The browser binding the spec sets as the proof cookie, and the `/signin#…` continuation location.
 * @complexity O(1) seal/challenge issuance, with shared IP/email delivery limits before mail.
 */
    return { kind: 'email_verification_required', continueByEmail: async () => {
      await deliveryAllowed({ email: linked.email });
      const continuation = await sealLoginEmailContinuation({ deps: protocol, input: { ...context, browserBinding }, login });
      const proof = await requestLoginEmailProof({ deps: links, input: { workspaceId: context.workspaceId, email: linked.email } });
      return { browserBinding, location: continuationLocation({ providerId: context.providerId, challengeId: proof.challengeId, continuation }) };
    } };
  }
  return linked;
}

/** Open the sealed continuation against this browser's proof cookie and link the identity with the emailed code.
 * @complexity O(1) sealed open and challenge/link calls.
 */
export async function verifyMemberOidcEmailProof(required: {
  context: LoginContext; protocol: OidcLoginDeps; links: MemberLoginLinkDeps; browserBinding: string;
  proof: { continuation: string; challengeId: string; code: string }; userAgent: string | undefined; ip: string;
}, _optional = {}): Promise<MemberLoginLinkResult> {
  const { context, protocol, browserBinding, proof } = required;
  const login = await openLoginEmailContinuation({ deps: protocol, input: { ...context, browserBinding, continuation: proof.continuation } });
  const { links, userAgent, ip } = required;
  return resolveFederatedIdentity({ deps: links, input: { workspaceId: context.workspaceId,
    identity: login.identity, startedAt: login.startedAt, ...(login.connectMemberId === undefined ? {} : { connectMemberId: login.connectMemberId }),
    emailProof: { challengeId: proof.challengeId, code: proof.code }, ...(userAgent === undefined ? {} : { userAgent }), ip } });
}
