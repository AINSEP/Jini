import { IdentityValidationError } from '../../core/types.js';
import { createSessionForPrincipal } from '../auth-service.js';
import { inIdentityTransaction } from '../identity-transaction.js';
import { requireRecentOwnerAuthentication } from './service.js';
import type { MfaScope, MfaPending } from './ports.js';
import type { OwnerPasskeyDeps } from './passkey-ports.js';

type Required<T> = { deps: OwnerPasskeyDeps; input: T };
type Empty = Record<string, never>;
type Challenge = { challenge: string; origin: string; rpId: string; loginHash?: string };
const refused = () => new IdentityValidationError({ message: 'This passkey attempt was not accepted or has expired. Start a new attempt, or use your authenticator app or recovery code.' });
const transaction = <T>(deps: OwnerPasskeyDeps, workspaceId: string, execute: () => Promise<T>) =>
  inIdentityTransaction({ transactions: deps.mfa.auth.repos.transactions, workspaceId, execute });
const hash = (deps: OwnerPasskeyDeps, token: string) => deps.mfa.auth.tokens.hashToken({ rawToken: token });

/** Persist a purpose-bound, sealed challenge in the existing bounded pending-proof store. O(1). */
async function saveChallenge(deps: OwnerPasskeyDeps, scope: MfaScope, purpose: MfaPending['purpose'], data: Challenge) {
  const pendingToken = deps.mfa.auth.tokens.newToken({});
  const sealedSecret = await deps.mfa.secrets.seal({ ...scope, secret: JSON.stringify(data) });
  await deps.mfa.store.savePending({ ...scope, purpose, sealedSecret, tokenHash: hash(deps, pendingToken),
    expiresAt: deps.mfa.auth.clock.nowMs() + 300000, attempts: 0 });
  return pendingToken;
}

/** Spend once before protocol verification; failed ceremonies stay spent after commit. O(1). */
async function claim(deps: OwnerPasskeyDeps, input: { workspaceId: string; pendingToken: string }, purpose: MfaPending['purpose']) {
  const proof = await deps.mfa.store.pending({ workspaceId: input.workspaceId, tokenHash: hash(deps, input.pendingToken) });
  if (!proof || proof.purpose !== purpose || !proof.sealedSecret) return null;
  if (proof.expiresAt <= deps.mfa.auth.clock.nowMs() || proof.attempts !== 0) return null;
  await deps.mfa.store.savePending({ ...proof, attempts: 5 });
  const data = JSON.parse(await deps.mfa.secrets.open({ ...proof, sealedSecret: proof.sealedSecret })) as Challenge;
  if (data.origin !== deps.site.origin || data.rpId !== deps.site.rpId) return null;
  return { proof, data };
}

/** Registration requires a fresh owner password and existing TOTP factor; fallback stays available.
 * @complexity O(n), n <= 5 stored credentials; one challenge write, no polling.
 */
export async function beginOwnerPasskeyEnrollment(required: Required<MfaScope & { password: string; code: string }>, _options: Empty = {}) {
  const { deps, input } = required;
  return transaction(deps, input.workspaceId, async () => {
    await requireRecentOwnerAuthentication({ deps: deps.mfa, input });
    if (!await deps.mfa.store.factor(input)) throw new IdentityValidationError({ message: 'Set up your authenticator app before adding a passkey so you retain a sign-in fallback.' });
    const credentials = await deps.credentials.list(input);
    if (credentials.length >= 5) throw new IdentityValidationError({ message: 'Five passkeys are already registered. Remove one before adding another.' });
    const options = await deps.webauthn.registration({ site: deps.site, scope: input, credentials });
    const pendingToken = await saveChallenge(deps, input, 'passkey-enroll', { challenge: options.challenge, origin: deps.site.origin, rpId: deps.site.rpId });
    return { pendingToken, options };
  });
}

/** Complete a same-owner registration once; a failed library proof writes no credential. O(1). */
export async function confirmOwnerPasskeyEnrollment(required: Required<MfaScope & { pendingToken: string; response: unknown }>, _options: Empty = {}): Promise<void> {
  const { deps, input } = required;
  const accepted = await transaction(deps, input.workspaceId, async () => {
    const claimed = await claim(deps, input, 'passkey-enroll');
    if (!claimed || claimed.proof.principalId !== input.principalId) return false;
    if (!await deps.mfa.store.factor(input)) return false;
    const credentials = await deps.credentials.list(input);
    if (credentials.length >= 5) return false;
    let credential;
    try { credential = await deps.webauthn.register({ site: deps.site, response: input.response, challenge: claimed.data.challenge }); }
    catch { return false; }
    // Exclusion hints are not a server-side ownership/counter guard: refuse re-registration.
    if (credentials.some(existing => existing.id === credential.id)) return false;
    await deps.credentials.save({ workspaceId: input.workspaceId, principalId: input.principalId, ...credential, rpId: deps.site.rpId });
    return true;
  });
  if (!accepted) throw refused();
}

/** Accept only the password-created owner login proof; never discover accounts from passkeys. O(1). */
async function loginProof(deps: OwnerPasskeyDeps, workspaceId: string, tokenHash: string | undefined) {
  if (!tokenHash) return null;
  const proof = await deps.mfa.store.pending({ workspaceId, tokenHash });
  if (!proof || proof.purpose !== 'login' || proof.principalId !== deps.mfa.seededOwnerPrincipalId) return null;
  if (proof.expiresAt <= deps.mfa.auth.clock.nowMs() || proof.attempts >= 5) return null;
  return proof;
}

/** Begin an alternative second factor, preserving the original TOTP proof for cancellation/fallback.
 * @complexity O(n), n <= 5 credentials; one added pending write per explicit attempt.
 */
export async function beginOwnerPasskeyLogin(required: Required<{ workspaceId: string; pendingToken: string }>, _options: Empty = {}) {
  const { deps, input } = required;
  return transaction(deps, input.workspaceId, async () => {
    const proof = await loginProof(deps, input.workspaceId, hash(deps, input.pendingToken));
    if (!proof) throw refused();
    const credentials = (await deps.credentials.list(proof)).filter(c => c.rpId === deps.site.rpId);
    if (!credentials.length) throw new IdentityValidationError({ message: 'No passkey is registered for this site. Use your authenticator app or recovery code.' });
    const options = await deps.webauthn.authentication({ site: deps.site, credentials });
    const pendingToken = await saveChallenge(deps, proof, 'passkey-login', { challenge: options.challenge,
      origin: deps.site.origin, rpId: deps.site.rpId, loginHash: proof.tokenHash });
    return { pendingToken, options };
  });
}

/** Verify only a credential owned by this exact site/owner; library handles zero/nonzero counters. */
async function verifyAssertion(deps: OwnerPasskeyDeps, proof: MfaPending, data: Challenge, response: unknown) {
  const credentialId = (response as { id?: unknown } | null)?.id;
  const credential = (await deps.credentials.list(proof)).find(c => c.id === credentialId && c.rpId === deps.site.rpId);
  if (!credential) return null;
  try { return { credential, counter: await deps.webauthn.authenticate({ site: deps.site, response, challenge: data.challenge, credential }) }; }
  catch { return null; }
}

/** Counter, challenge consumption and session mint share one transaction; rollback grants nothing.
 * @complexity O(n), n <= 5 credentials; fixed identity reads/writes plus existing session persistence.
 */
export async function completeOwnerPasskeyLogin(required: Required<{ workspaceId: string; pendingToken: string; response: unknown }>, options: { sessionTtlMs?: number; ip?: string; userAgent?: string } = {}) {
  const { deps, input } = required;
  const result = await transaction(deps, input.workspaceId, async () => {
    const claimed = await claim(deps, input, 'passkey-login');
    if (!claimed) return null;
    const proof = await loginProof(deps, input.workspaceId, claimed.data.loginHash);
    if (!proof || proof.principalId !== claimed.proof.principalId) return null;
    const principal = await deps.mfa.auth.repos.principals.findById({ workspaceId: proof.workspaceId, id: proof.principalId });
    if (principal?.kind !== 'user' || principal.status !== 'active') return null;
    const user = await deps.mfa.auth.repos.users.findByPrincipalId({ workspaceId: proof.workspaceId, principalId: proof.principalId });
    if (!user) return null;
    const verified = await verifyAssertion(deps, proof, claimed.data, input.response);
    if (!verified) return null;
    await deps.credentials.save({ ...verified.credential, counter: verified.counter });
    await deps.mfa.store.clearPending(proof);
    const session = await createSessionForPrincipal({ deps: deps.mfa.auth, input: proof }, options);
    await deps.mfa.auth.repos.users.save({ ...user, lastLoginAt: session.session.createdAt });
    return { principal, ...session };
  });
  if (!result) throw refused();
  return result;
}

/** Removing a key requires current owner password and TOTP; sessions cannot authorize it alone. O(1). */
export async function removeOwnerPasskey(required: Required<MfaScope & { id: string; password: string; code: string }>, _options: Empty = {}): Promise<void> {
  const { deps, input } = required;
  await transaction(deps, input.workspaceId, async () => {
    await requireRecentOwnerAuthentication({ deps: deps.mfa, input });
    await deps.credentials.remove(input);
    await deps.mfa.store.clearPending(input);
  });
}
