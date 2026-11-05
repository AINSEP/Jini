import { requireOwnerFactor } from './mfa/service.js';
import type { OwnerMfaDeps } from './mfa/ports.js';
import type { AuthServiceDeps } from './auth-service.js';
import { resetUserPassword } from './admin-crud-service.js';
import { inIdentityTransaction } from './identity-transaction.js';
import { IdentityValidationError, OwnerRequiredError } from '../core/types.js';

type OwnerScope = { workspaceId: string; principalId: string };

/** Storage must join auth's identity transaction, including rollback and workspace serialization. */
export interface RecoveryCodeStore {
  replace(input: OwnerScope & { hashes: string[] }): Promise<void>;
  contains(input: OwnerScope & { hash: string }): Promise<boolean>;
  clear(input: OwnerScope): Promise<void>;
}

export interface OwnerRecoveryDeps {
  mfa?: OwnerMfaDeps;
  auth: AuthServiceDeps;
  codes: RecoveryCodeStore;
  seededOwnerPrincipalId: string;
}

type Required<Input> = { deps: OwnerRecoveryDeps; input: Input };
type Options = Record<string, never>;

/** Refuse staff and inactive identities before any recovery write; never assigns roles.
 * @complexity O(1), two scoped identity reads, constant memory.
 */
async function requireOwner({ deps, input }: Required<OwnerScope>) {
  if (input.principalId !== deps.seededOwnerPrincipalId) {
    throw new OwnerRequiredError({ message: 'Only the site owner can recover this account. Sign in as the owner and try again.' });
  }
  const principal = await deps.auth.repos.principals.findById({ workspaceId: input.workspaceId, id: input.principalId });
  const user = await deps.auth.repos.users.findByPrincipalId({ workspaceId: input.workspaceId, principalId: input.principalId });
  if (principal?.kind !== 'user' || principal.status !== 'active' || !user) {
    throw new OwnerRequiredError({ message: 'The owner account is unavailable. Ask the host operator to check the owner account.' });
  }
  return user;
}

/** Domain separation prevents a stored digest being useful for another owner, workspace or session.
 * @complexity O(1), bounded code and identity fields; no I/O.
 */
function codeHash({ deps, input }: Required<OwnerScope & { code: string }>): string {
  return deps.auth.tokens.hashToken({ rawToken: JSON.stringify(['owner-recovery-v1', input.workspaceId, input.principalId, input.code]) });
}

/** Rotate ten 256-bit codes after checking the current password; raw codes leave only in this result.
 * @throws OwnerRequiredError or IdentityValidationError; storage errors roll back the rotation.
 * @complexity O(1): ten entropy/digest operations and one bounded replacement per explicit rotation.
 */
export async function issueRecoveryCodes(required: Required<OwnerScope & { password: string; code?: string }>, _options: Options = {}): Promise<{ codes: string[] }> {
  const { deps, input } = required;
  return inIdentityTransaction({ transactions: deps.auth.repos.transactions, workspaceId: input.workspaceId, execute: async () => {
    const user = await requireOwner(required);
    if (!input.password || !await deps.auth.hasher.verify({ hash: user.passwordHash, password: input.password })) {
      throw new IdentityValidationError({ message: 'The current password was not accepted. Enter your current owner password and try again.' });
    }
    if (await deps.auth.mfaStore?.factor(input)) {
      if (!deps.mfa) throw new IdentityValidationError({ message: 'Authenticator verification is unavailable. Reopen the owner security settings and try again.' });
      await requireOwnerFactor({ deps: deps.mfa, input }, {});
    }
    const codes = Array.from({ length: 10 }, () => deps.auth.tokens.newToken({}));
    if (new Set(codes).size !== 10 || codes.some(code => !/^[a-f0-9]{64}$/.test(code))) {
      throw new Error('Recovery code generation failed. Try again after the host operator checks the entropy source. Details: recovery-entropy');
    }
    await deps.codes.replace({ workspaceId: input.workspaceId, principalId: input.principalId, hashes: codes.map(code => codeHash({ deps, input: { ...input, code } })) });
    return { codes };
  } });
}

/** Trusted host/desktop entry: use only after proving host ownership or an authenticated owner session.
 * Reuses the password transition and proves its write before clearing the kit in the same transaction.
 * @throws OwnerRequiredError or IdentityValidationError; any failure rolls back all writes.
 * @complexity O(s) time/space for the existing reset transition's s owner sessions, plus one kit delete.
 */
export async function resetOwnerPassword(required: Required<OwnerScope & { password: string }>, _options: Options = {}): Promise<void> {
  const { deps, input } = required;
  await inIdentityTransaction({ transactions: deps.auth.repos.transactions, workspaceId: input.workspaceId, execute: async () => {
    await requireOwner(required);
    await resetUserPassword({ deps: deps.auth, input: { ...input, callerPrincipalId: input.principalId, seededOwnerPrincipalId: deps.seededOwnerPrincipalId } });
    const fresh = await deps.auth.repos.users.findByPrincipalId({ workspaceId: input.workspaceId, principalId: input.principalId });
    if (!fresh || !await deps.auth.hasher.verify({ hash: fresh.passwordHash, password: input.password })) {
      throw new Error('The new owner password could not be verified. No recovery changes were saved. Ask the host operator to check password hashing. Details: owner-reset-verification');
    }
    await deps.auth.mfaStore?.clear({ workspaceId: input.workspaceId, principalId: input.principalId });
    await deps.codes.clear({ workspaceId: input.workspaceId, principalId: input.principalId });
  } });
}

/** Redeem only in its owner/workspace transaction; concurrent redemptions have exactly one winner.
 * @throws IdentityValidationError for an unavailable code; reset failures roll back code consumption.
 * @complexity O(s) for owner sessions; one indexed hash read and at most ten deleted code rows.
 */
export async function recoverOwner(required: Required<OwnerScope & { code: string; password: string }>, _options: Options = {}): Promise<void> {
  const { deps, input } = required;
  if (!/^[a-f0-9]{64}$/.test(input.code)) {
    throw new IdentityValidationError({ message: 'The recovery code was not accepted. Use an unused code from your latest download.' });
  }
  await inIdentityTransaction({ transactions: deps.auth.repos.transactions, workspaceId: input.workspaceId, execute: async () => {
    await requireOwner(required);
    if (!await deps.codes.contains({ workspaceId: input.workspaceId, principalId: input.principalId, hash: codeHash(required) })) {
      throw new IdentityValidationError({ message: 'The recovery code was not accepted. Use an unused code from your latest download.' });
    }
    await resetOwnerPassword(required, {});
  } });
}

/** Resolve host recovery by the seeded identity, never a default username or a delegated account.
 * @throws OwnerRequiredError for another requested username or an unavailable owner.
 * @complexity O(1), two scoped identity reads; constant memory.
 */
export async function resolveOwnerResetTarget(required: Required<OwnerScope & { username?: string }>, _options: Options = {}) {
  const owner = await requireOwner(required);
  if (required.input.username !== undefined && required.input.username !== owner.username) {
    throw new OwnerRequiredError({ message: 'That username is not the site owner. Omit the username to recover the current owner account.' });
  }
  return owner;
}
