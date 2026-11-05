import { IdentityValidationError, OwnerRequiredError } from '../../core/types.js';
import { createSessionForPrincipal, verifyCredentials } from '../auth-service.js';
import { defaultUserManagementMessages } from '../messages.js';
import { inIdentityTransaction } from '../identity-transaction.js';
import type { MfaPending, MfaScope, OwnerMfaDeps } from './ports.js';

type Required<T> = { deps: OwnerMfaDeps; input: T };
type Options = Record<string, never>;
type SessionOptions = { ip?: string | undefined; userAgent?: string | undefined; sessionTtlMs?: number | undefined };
const refused = () => new IdentityValidationError({ message: 'The authenticator code was not accepted or has expired. Enter a fresh code, or sign in again to start a new attempt.' });
const transaction = <T>(deps: OwnerMfaDeps, workspaceId: string, execute: () => Promise<T>) =>
  inIdentityTransaction({ transactions: deps.auth.repos.transactions, workspaceId, execute });

/** Prove the server-selected owner, never a staff/member identity. O(1), two identity reads. */
async function owner(deps: OwnerMfaDeps, scope: MfaScope) {
  const principal = await deps.auth.repos.principals.findById({ workspaceId: scope.workspaceId, id: scope.principalId });
  const user = await deps.auth.repos.users.findByPrincipalId({ workspaceId: scope.workspaceId, principalId: scope.principalId });
  if (scope.principalId !== deps.seededOwnerPrincipalId || principal?.kind !== 'user' || principal.status !== 'active' || !user) {
    throw new OwnerRequiredError({ message: 'Only the active site owner can change this authenticator. Sign in as the owner and try again.' });
  }
  return { principal, user };
}

/** Verify and spend an existing factor in the caller's identity transaction. O(1) bounded I/O. */
export async function requireOwnerFactor(required: Required<MfaScope & { code?: string }>, _options: Options = {}): Promise<void> {
  const { deps, input } = required;
  const factor = await deps.store.factor(input);
  if (!factor) return;
  const secret = await deps.secrets.open(factor);
  const step = await deps.totp.verify({ secret, code: input.code ?? '', nowMs: deps.auth.clock.nowMs() });
  if (step === null || step <= factor.lastStep) throw refused();
  await deps.store.saveFactor({ ...factor, lastStep: step });
}

/** Password is checked afresh for every management action; sessions alone are insufficient. */
async function recentOwner(required: Required<MfaScope & { password: string; code?: string }>) {
  const { user } = await owner(required.deps, required.input);
  if (!required.input.password || !await required.deps.auth.hasher.verify({ hash: user.passwordHash, password: required.input.password })) {
    throw new IdentityValidationError({ message: 'The current owner password was not accepted. Enter your current password and try again.' });
  }
  await requireOwnerFactor(required);
}

/** Replace expired/same-purpose proofs instead of growing an unbounded challenge history. */
async function pending(deps: OwnerMfaDeps, scope: MfaScope, purpose: MfaPending['purpose'], sealedSecret?: string) {
  const pendingToken = deps.auth.tokens.newToken({});
  await deps.store.savePending({ ...scope, purpose, tokenHash: deps.auth.tokens.hashToken({ rawToken: pendingToken }),
    expiresAt: deps.auth.clock.nowMs() + 300000, attempts: 0, ...(sealedSecret === undefined ? {} : { sealedSecret }) });
  return { mfaRequired: true as const, pendingToken };
}

/** Credential verification happens before this trusted-principal boundary (including launcher proof).
 * O(1): one factor read and one pending/session write; no polling.
 */
export async function beginPrincipalSignIn(required: Required<MfaScope>, options: SessionOptions = {}) {
  const { deps, input } = required;
  return transaction(deps, input.workspaceId, async () => {
    const principal = await deps.auth.repos.principals.findById({ workspaceId: input.workspaceId, id: input.principalId });
    if (!principal || principal.status !== 'active' || principal.kind !== 'user') throw refused();
    if (input.principalId === deps.seededOwnerPrincipalId && await deps.store.factor(input)) return pending(deps, input, 'login');
    return { principal, ...await createSessionForPrincipal({ deps: deps.auth, input }, options) };
  });
}

/** Password proof alone never mints an enrolled owner's session. O(1) identity reads/writes. */
export async function beginOwnerLogin(required: Required<{ workspaceId: string; username: string; password: string }>, options: SessionOptions = {}) {
  const { deps, input } = required;
  return transaction(deps, input.workspaceId, async () => {
    const { userRow, principal } = await verifyCredentials({ deps: deps.auth, input, invalidCredentialsMessage: defaultUserManagementMessages.invalidCredentials });
    const result = await beginPrincipalSignIn({ deps, input: { workspaceId: input.workspaceId, principalId: principal.id } }, options);
    if ('session' in result) await deps.auth.repos.users.save({ ...userRow, lastLoginAt: result.session.createdAt });
    return result;
  });
}

/** Spend failed attempts without throwing inside the transaction (throwing would refund them).
 * O(1), one proof read/write and one factor/library verification. Session writes share rollback.
 */
async function useProof<T>(required: Required<{ workspaceId: string; pendingToken: string; code: string }>, purpose: MfaPending['purpose'], complete: (proof: MfaPending, step: number) => Promise<T>): Promise<T> {
  const { deps, input } = required;
  const result = await transaction(deps, input.workspaceId, async () => {
    const proof = await deps.store.pending({ workspaceId: input.workspaceId, tokenHash: deps.auth.tokens.hashToken({ rawToken: input.pendingToken }) });
    if (!proof || proof.purpose !== purpose || proof.expiresAt <= deps.auth.clock.nowMs() || proof.attempts >= 5) return { ok: false as const };
    await deps.store.savePending({ ...proof, attempts: proof.attempts + 1 });
    await owner(deps, proof);
    const factor = purpose === 'login' ? await deps.store.factor(proof) : null;
    const sealedSecret = factor?.sealedSecret ?? proof.sealedSecret;
    if (!sealedSecret) return { ok: false as const };
    const secret = await deps.secrets.open({ ...proof, sealedSecret });
    const step = await deps.totp.verify({ secret, code: input.code, nowMs: deps.auth.clock.nowMs() });
    if (step === null || (factor !== null && step <= factor.lastStep)) return { ok: false as const };
    return { ok: true as const, value: await complete(proof, step) };
  });
  if (!result.ok) throw refused();
  return result.value;
}

/** Atomically advance timestep, consume proofs and mint the only authorized session. O(1). */
export async function completeOwnerLogin(required: Required<{ workspaceId: string; pendingToken: string; code: string }>, options: SessionOptions = {}) {
  const { deps } = required;
  return useProof(required, 'login', async (proof, step) => {
    const factor = await deps.store.factor(proof);
    if (!factor) throw refused();
    await deps.store.saveFactor({ ...factor, lastStep: step });
    await deps.store.clearPending(proof);
    const { principal, user } = await owner(deps, proof);
    const result = await createSessionForPrincipal({ deps: deps.auth, input: proof }, options);
    await deps.auth.repos.users.save({ ...user, lastLoginAt: result.session.createdAt });
    return { principal, ...result };
  });
}

/** Activation requires a later proof; the new secret is sealed with principal/workspace AAD. O(1). */
export async function beginOwnerEnrollment(required: Required<MfaScope & { password: string; code?: string; label: string; issuer: string }>, _options: Options = {}) {
  const { deps, input } = required;
  return transaction(deps, input.workspaceId, async () => {
    await recentOwner(required);
    const secret = deps.totp.generate();
    const sealedSecret = await deps.secrets.seal({ ...input, secret });
    const result = await pending(deps, input, 'enroll', sealedSecret);
    return { pendingToken: result.pendingToken, secret, uri: deps.totp.uri({ secret, label: input.label, issuer: input.issuer }) };
  });
}

/** Revoke existing owner sessions after factor changes. O(s), existing bounded owner sessions. */
async function revokeSessions(deps: OwnerMfaDeps, scope: MfaScope) {
  const sessions = await deps.auth.repos.sessions.listByPrincipalId({ workspaceId: scope.workspaceId, principalId: scope.principalId });
  for (const session of sessions) await deps.auth.repos.sessions.revoke({ workspaceId: scope.workspaceId, id: session.id, revokedAt: new Date(deps.auth.clock.nowMs()).toISOString() });
}

/** Same-owner confirmation activates once and invalidates pending logins and older sessions. */
export async function confirmOwnerEnrollment(required: Required<MfaScope & { pendingToken: string; code: string }>, _options: Options = {}): Promise<void> {
  await useProof(required, 'enroll', async (proof, step) => {
    if (proof.principalId !== required.input.principalId || !proof.sealedSecret) throw refused();
    await required.deps.store.saveFactor({ workspaceId: proof.workspaceId, principalId: proof.principalId, sealedSecret: proof.sealedSecret, lastStep: step });
    await required.deps.store.clearPending(proof);
    await revokeSessions(required.deps, proof);
  });
}

/** Removal needs both current factors, and revokes sessions/proofs atomically. O(s). */
export async function removeOwnerFactor(required: Required<MfaScope & { password: string; code: string }>, _options: Options = {}): Promise<void> {
  const { deps, input } = required;
  await transaction(deps, input.workspaceId, async () => {
    await recentOwner(required);
    await deps.store.clear(input);
    await revokeSessions(deps, input);
  });
}
