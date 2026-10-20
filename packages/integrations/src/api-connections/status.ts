/**
 * @file The token-free status view hosts render for a connection.
 *
 * Exists so status, account display and granted scopes can be shown anywhere (settings pages,
 * chat, logs) without any path from a status object back to a credential.
 */
import type { ApiConnectionServiceDeps } from './deps.js';
import { connectionNotFound, isOwnedRecord, type OwnedRecordArgs } from './records.js';
import { isUnreadableTokenRecord } from './token-store/errors.js';
import type { ApiConnectionAccount, ApiConnectionRecord, ApiConnectionRevocationFailure, ApiConnectionStatus } from './types.js';

export interface ApiConnectionStatusView {
  readonly connectionRef: string;
  readonly status: ApiConnectionStatus;
  readonly account: ApiConnectionAccount | null;
  readonly grantedScopes: readonly string[];
  /** Account of a switch-account result awaiting confirmation, if any. */
  readonly pendingSwitch: ApiConnectionAccount | null;
  /** Why the last revocation was not confirmed (a fixed code for operators), or null. */
  readonly revocationFailure: ApiConnectionRevocationFailure | null;
}

export function toStatusView(record: ApiConnectionRecord): ApiConnectionStatusView {
  return {
    connectionRef: record.key, status: record.status, account: record.account,
    grantedScopes: record.grantedScopes, pendingSwitch: record.staged?.account ?? null,
    // Rows written before the diagnostic existed have no field; they read as "none".
    revocationFailure: record.revocationFailure ?? null,
  };
}

/**
 * A connection that was never created reads as disconnected, without opening credentials.
 * A connected record with missing or incompatible tokens reads as reconnect-required; status
 * never rewrites or deletes the stored credential. Other storage failures still propagate.
 * @complexity One record read and, only for a connected record, one token-store load; no HTTP.
 */
export async function getApiConnectionStatus(
  deps: Pick<ApiConnectionServiceDeps, 'records' | 'descriptor' | 'tokens'>,
  requiredArgs: OwnedRecordArgs,
): Promise<ApiConnectionStatusView> {
  const record = await deps.records.read({ key: requiredArgs.connectionRef });
  if (record === null) {
    return { connectionRef: requiredArgs.connectionRef, status: 'disconnected', account: null, grantedScopes: [], pendingSwitch: null,
      revocationFailure: null };
  }
  if (!isOwnedRecord(record, deps, requiredArgs.workspaceId)) throw connectionNotFound();
  if (record.status === 'connected') {
    const tokens = await deps.tokens.load({ key: record.key }).catch((error: unknown) => {
      if (isUnreadableTokenRecord(error)) return null;
      throw error;
    });
    if (tokens === null) return toStatusView({ ...record, status: 'reconnect-required' });
  }
  return toStatusView(record);
}
