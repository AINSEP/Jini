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
import { stagedTokenKey } from './keys.js';
import { loadOwnedRecord, writeRecord } from './records.js';
import { toStatusView, type ApiConnectionStatusView } from './status.js';
import type { ApiConnectionRecord } from './types.js';

/** `not-needed` when no credential existed locally, so nothing could be revoked. */
export type ApiConnectionRemoteRevocation = 'confirmed' | 'pending' | 'not-needed';

export interface ApiConnectionDisconnectResult extends ApiConnectionStatusView {
  readonly remoteRevocation: ApiConnectionRemoteRevocation;
}

export interface ApiConnectionSwitchResult extends ApiConnectionStatusView {
  /**
   * The previous account's grant is left at the provider: revoking it could cut off the same
   * account connected elsewhere through the same client. Hosts say so and link the provider's
   * account-access page; the local copy of its tokens is gone.
   */
  readonly previousAccountRevocation: 'not-attempted';
}

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
async function revokeStoredCredential(deps: ApiConnectionServiceDeps, key: string): Promise<ApiConnectionRemoteRevocation> {
  const tokens = await deps.tokens.loadForRevocation({ key });
  if (tokens === null) return 'not-needed';
  try {
    await deps.hooks.revoke({ token: tokens.refreshToken ?? tokens.accessToken });
  } catch {
    // The hook's error may echo provider bodies; the outcome, not the detail, is what callers get.
    // The credential stays (disabled) so a retry can still revoke the grant.
    return 'pending';
  }
  await deps.tokens.delete({ key });
  return 'confirmed';
}

/** One outcome for several credentials: any pending wins, then any confirmed. */
function combineRevocations(outcomes: readonly ApiConnectionRemoteRevocation[]): ApiConnectionRemoteRevocation {
  if (outcomes.includes('pending')) return 'pending';
  return outcomes.includes('confirmed') ? 'confirmed' : 'not-needed';
}

export async function confirmSwitchAccount(
  deps: ApiConnectionServiceDeps,
  requiredArgs: { readonly connectionRef: string; readonly actorId: string },
): Promise<ApiConnectionSwitchResult> {
  const record = await loadOwnedRecord(deps, requiredArgs);
  if (!stagedSwitchUsable(record, requiredArgs.actorId, deps.clock.nowMs())) throw switchNotStaged();
  const stagedKey = stagedTokenKey({ key: record.key });
  const tokens = await deps.tokens.load({ key: stagedKey });
  if (tokens === null) throw switchNotStaged();
  const staged = record.staged!;
  const updated = await installCredential(deps, { current: record, tokens, account: staged.account, grantedScopes: staged.grantedScopes });
  await deps.tokens.delete({ key: stagedKey });
  return { ...toStatusView(updated), previousAccountRevocation: 'not-attempted' };
}

/**
 * Drop a staged switch, revoking its tokens because the person consented to them. When the
 * provider does not confirm, the switch stays staged (still confirmable) and cancelling again retries.
 */
export async function cancelSwitchAccount(
  deps: ApiConnectionServiceDeps,
  requiredArgs: { readonly connectionRef: string },
): Promise<ApiConnectionDisconnectResult> {
  const record = await loadOwnedRecord(deps, requiredArgs);
  // Without a staged record the slot can only hold a confirmed switch's copy of the live grant
  // (or a credential a pending disconnect owns): revoking it here would cut off the live account.
  if (record.staged === null) return { ...toStatusView(record), remoteRevocation: 'not-needed' };
  const remoteRevocation = await revokeStoredCredential(deps, stagedTokenKey({ key: record.key }));
  const updated = remoteRevocation === 'pending' ? record : await writeRecord(deps, record, { staged: null });
  return { ...toStatusView(updated), remoteRevocation };
}

/** Disconnect and revoke the live and any staged credential; call again to retry a `pending` revocation. */
export async function disconnectApiConnection(
  deps: ApiConnectionServiceDeps,
  requiredArgs: { readonly connectionRef: string },
): Promise<ApiConnectionDisconnectResult> {
  const record = await loadOwnedRecord(deps, requiredArgs);
  // Stop use before any network call: no token is served or refreshed once the generation moves.
  const stopped = record.status === 'revocation-pending' ? record
    : await writeRecord(deps, record, { status: 'revocation-pending', generation: record.generation + 1, staged: null });
  const remoteRevocation = combineRevocations([
    await revokeStoredCredential(deps, record.key),
    await revokeStoredCredential(deps, stagedTokenKey({ key: record.key })),
  ]);
  if (remoteRevocation === 'pending') return { ...toStatusView(stopped), remoteRevocation };
  const cleared = await writeRecord(deps, stopped, { status: 'disconnected', account: null, grantedScopes: [] });
  return { ...toStatusView(cleared), remoteRevocation };
}
