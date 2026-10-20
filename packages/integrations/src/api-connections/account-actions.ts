/**
 * @file Account actions after sign-in: confirm or cancel a staged switch, and disconnect.
 *
 * Exists so the rules owners care about live in one place: a switch only takes effect on an
 * explicit confirm by the actor who staged it, against the generation it was staged on; a
 * disconnect stops use first, then asks the plugin to revoke remotely, clears local tokens only
 * after the provider confirmed, and otherwise stays `revocation-pending` with the disabled
 * credential kept for a retry. Remote success is never reported unless the hook returned.
 */
import type { ApiConnectionServiceDeps } from './deps.js';
import { ApiConnectionError } from './errors.js';
import { installCredential } from './install-credential.js';
import { isUnreadableTokenRecord } from './token-store/errors.js';
import { stagedTokenKey } from './keys.js';
import { loadOwnedRecord, writeRecord, type OwnedRecordArgs } from './records.js';
import { toStatusView, type ApiConnectionStatusView } from './status.js';
import type { ApiConnectionRecord, ApiConnectionRevocationFailure } from './types.js';

/**
 * `not-needed` when no credential existed locally, so nothing could be revoked. `pending` with
 * status `revocation-pending` means the disabled credential is kept and disconnecting again
 * retries; `pending` with status `disconnected` means the stored credential could not be read
 * (for example the host changed its OAuth client), so it was removed locally and the person has
 * to remove the access on the provider's account page.
 */
export type ApiConnectionRemoteRevocation = 'confirmed' | 'pending' | 'not-needed';

/** `abandoned`: the credential was unreadable and deleted locally; reported to callers as `pending`. */
type CredentialRevocation = ApiConnectionRemoteRevocation | 'abandoned';

interface RevocationResult {
  readonly outcome: CredentialRevocation;
  readonly failure: ApiConnectionRevocationFailure | null;
}

/** Classifications a revoke hook may put on its error's `code`; anything else is `unclassified`. */
const HOOK_FAILURE_CODES: ReadonlySet<unknown> = new Set<ApiConnectionRevocationFailure>(['provider-unreachable', 'provider-refused']);

/** Read only the hook's `code`, and only when it is a known classification: its message may echo provider bodies. */
function hookFailureOf(error: unknown): ApiConnectionRevocationFailure {
  // A hook may throw anything, `undefined` included.
  const code = (error as { readonly code?: unknown } | null | undefined)?.code;
  return HOOK_FAILURE_CODES.has(code) ? code as ApiConnectionRevocationFailure : 'unclassified';
}

export interface ApiConnectionDisconnectResult extends ApiConnectionStatusView {
  readonly remoteRevocation: ApiConnectionRemoteRevocation;
}

/**
 * A confirmed switch never revokes the previous account's grant at the provider: revoking it could
 * cut off the same account connected elsewhere through the same client. Hosts say so and link the
 * provider's account-access page; the local copy of its tokens is gone.
 */
export type ApiConnectionSwitchResult = ApiConnectionStatusView;

function switchNotStaged(): ApiConnectionError {
  return new ApiConnectionError({ code: 'switch-not-staged',
    message: 'There is no account switch waiting for your confirmation, or it expired. Cancel the switch and start it again.' });
}

function stagedSwitchUsable(record: ApiConnectionRecord, actorId: string, nowMs: number): boolean {
  const staged = record.staged;
  return staged !== null && staged.actorId === actorId && staged.generation === record.generation
    && Date.parse(staged.expiresAt) > nowMs;
}

/**
 * Revoke the credential stored under `key` through the plugin hook and delete it only when the
 * hook returned. The read ignores the generation fence: a disconnect has already disabled the
 * credential, and these tokens go to the revoke hook only.
 */
async function revokeStoredCredential(deps: ApiConnectionServiceDeps, key: string): Promise<RevocationResult> {
  const tokens = await deps.tokens.loadForRevocation({ key }).catch((error: unknown) => {
    if (isUnreadableTokenRecord(error)) return 'unreadable' as const;
    throw error;
  });
  // Nothing can ever revoke with an unreadable row; keeping it would block every later sign-in.
  if (tokens === 'unreadable') {
    await deps.tokens.delete({ key });
    return { outcome: 'abandoned', failure: 'credential-unreadable' };
  }
  if (tokens === null) return { outcome: 'not-needed', failure: null };
  try {
    await deps.hooks.revoke({ token: tokens.refreshToken ?? tokens.accessToken });
  } catch (error: unknown) {
    // The hook's error may echo provider bodies; the outcome and a fixed code, not the detail, is
    // what callers and the record get. The credential stays (disabled) so a retry can still revoke.
    return { outcome: 'pending', failure: hookFailureOf(error) };
  }
  await deps.tokens.delete({ key });
  return { outcome: 'confirmed', failure: null };
}

/** One outcome for several credentials: any pending (or abandoned) wins, then any confirmed. */
function combineRevocations(outcomes: readonly CredentialRevocation[]): ApiConnectionRemoteRevocation {
  if (outcomes.includes('pending') || outcomes.includes('abandoned')) return 'pending';
  return outcomes.includes('confirmed') ? 'confirmed' : 'not-needed';
}

/** The first failure among several credentials (the live one is revoked first), or null. */
function firstFailure(results: readonly RevocationResult[]): ApiConnectionRevocationFailure | null {
  return results.find(result => result.failure !== null)?.failure ?? null;
}

export async function confirmSwitchAccount(
  deps: ApiConnectionServiceDeps,
  requiredArgs: OwnedRecordArgs & { readonly actorId: string },
): Promise<ApiConnectionSwitchResult> {
  const record = await loadOwnedRecord(deps, requiredArgs);
  if (!stagedSwitchUsable(record, requiredArgs.actorId, deps.clock.nowMs())) throw switchNotStaged();
  const stagedKey = stagedTokenKey({ key: record.key });
  const tokens = await deps.tokens.load({ key: stagedKey });
  if (tokens === null) throw switchNotStaged();
  const staged = record.staged!;
  const updated = await installCredential(deps, { current: record, tokens, account: staged.account, grantedScopes: staged.grantedScopes });
  await deps.tokens.delete({ key: stagedKey });
  return toStatusView(updated);
}

/**
 * Drop a staged switch, revoking its tokens because the person consented to them. When the
 * provider does not confirm, the switch stays staged (still confirmable) and cancelling again retries.
 */
export async function cancelSwitchAccount(
  deps: ApiConnectionServiceDeps,
  requiredArgs: OwnedRecordArgs,
): Promise<ApiConnectionDisconnectResult> {
  const record = await loadOwnedRecord(deps, requiredArgs);
  // Without a staged record the slot can only hold a confirmed switch's copy of the live grant
  // (or a credential a pending disconnect owns): revoking it here would cut off the live account.
  if (record.staged === null) return { ...toStatusView(record), remoteRevocation: 'not-needed' };
  const result = await revokeStoredCredential(deps, stagedTokenKey({ key: record.key }));
  const updated = await writeRecord(deps, record, result.outcome === 'pending'
    ? { revocationFailure: result.failure } : { staged: null, revocationFailure: result.failure });
  return { ...toStatusView(updated), remoteRevocation: combineRevocations([result.outcome]) };
}

/** Disconnect and revoke the live and any staged credential; call again to retry a `pending` revocation. */
export async function disconnectApiConnection(
  deps: ApiConnectionServiceDeps,
  requiredArgs: OwnedRecordArgs,
): Promise<ApiConnectionDisconnectResult> {
  const record = await loadOwnedRecord(deps, requiredArgs);
  // Stop use before any network call: no token is served or refreshed once the generation moves.
  const stopped = record.status === 'revocation-pending' ? record
    : await writeRecord(deps, record, { status: 'revocation-pending', generation: record.generation + 1, staged: null });
  const results = [
    await revokeStoredCredential(deps, record.key),
    await revokeStoredCredential(deps, stagedTokenKey({ key: record.key })),
  ];
  const outcomes = results.map(result => result.outcome);
  const remoteRevocation = combineRevocations(outcomes);
  const revocationFailure = firstFailure(results);
  // Only a kept credential can be retried; an abandoned one leaves nothing to wait for locally.
  if (outcomes.includes('pending')) return { ...toStatusView(await writeRecord(deps, stopped, { revocationFailure })), remoteRevocation };
  const cleared = await writeRecord(deps, stopped, { status: 'disconnected', account: null, grantedScopes: [], revocationFailure });
  return { ...toStatusView(cleared), remoteRevocation };
}
