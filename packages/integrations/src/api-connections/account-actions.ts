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

function switchNotStaged(): ApiConnectionError {
  return new ApiConnectionError({ code: 'switch-not-staged',
    message: 'There is no account switch waiting for your confirmation, or it expired. Start the switch again.' });
}

function stagedSwitchUsable(record: ApiConnectionRecord, actorId: string, nowMs: number): boolean {
  const staged = record.staged;
  return staged !== null && staged.actorId === actorId && staged.generation === record.generation
    && Date.parse(staged.expiresAt) > nowMs;
}

/** Revoke a stored credential through the plugin hook; `confirmed` only when the hook returned normally. */
async function revokeCredential(deps: ApiConnectionServiceDeps, key: string): Promise<ApiConnectionRemoteRevocation> {
  const tokens = await deps.tokens.load({ key });
  if (tokens === null) return 'not-needed';
  try {
    await deps.hooks.revoke({ token: tokens.refreshToken ?? tokens.accessToken });
    return 'confirmed';
  } catch {
    // The hook's error may echo provider bodies; the outcome, not the detail, is what callers get.
    return 'pending';
  }
}

export async function confirmSwitchAccount(
  deps: ApiConnectionServiceDeps,
  requiredArgs: { readonly connectionRef: string; readonly actorId: string },
): Promise<ApiConnectionStatusView> {
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

/** Drop a staged switch; its tokens are revoked best-effort because the person consented to them. */
export async function cancelSwitchAccount(
  deps: ApiConnectionServiceDeps,
  requiredArgs: { readonly connectionRef: string },
): Promise<ApiConnectionDisconnectResult> {
  const record = await loadOwnedRecord(deps, requiredArgs);
  const stagedKey = stagedTokenKey({ key: record.key });
  const remoteRevocation = await revokeCredential(deps, stagedKey);
  await deps.tokens.delete({ key: stagedKey });
  const updated = record.staged === null ? record : await writeRecord(deps, record, { staged: null });
  return { ...toStatusView(updated), remoteRevocation };
}

/** Disconnect and revoke; call again to retry a `pending` remote revocation. */
export async function disconnectApiConnection(
  deps: ApiConnectionServiceDeps,
  requiredArgs: { readonly connectionRef: string },
): Promise<ApiConnectionDisconnectResult> {
  const record = await loadOwnedRecord(deps, requiredArgs);
  // Stop use before any network call: no token is served once the generation moves.
  const stopped = record.status === 'revocation-pending' ? record
    : await writeRecord(deps, record, { status: 'revocation-pending', generation: record.generation + 1, staged: null });
  if (record.staged !== null) await cancelStagedTokens(deps, record.key);
  const remoteRevocation = await revokeCredential(deps, record.key);
  if (remoteRevocation === 'pending') return { ...toStatusView(stopped), remoteRevocation };
  await deps.tokens.delete({ key: record.key });
  const cleared = await writeRecord(deps, stopped, { status: 'disconnected', account: null, grantedScopes: [] });
  return { ...toStatusView(cleared), remoteRevocation };
}

async function cancelStagedTokens(deps: ApiConnectionServiceDeps, key: string): Promise<void> {
  const stagedKey = stagedTokenKey({ key });
  await revokeCredential(deps, stagedKey);
  await deps.tokens.delete({ key: stagedKey });
}
