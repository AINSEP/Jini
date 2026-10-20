/**
 * @file The token-free status view hosts render for a connection.
 *
 * Exists so status, account display and granted scopes can be shown anywhere (settings pages,
 * chat, logs) without any path from a status object back to a credential.
 */
import type { ApiConnectionServiceDeps } from './deps.js';
import { connectionNotFound, isOwnedRecord, type OwnedRecordArgs } from './records.js';
import type { ApiConnectionAccount, ApiConnectionRecord, ApiConnectionStatus } from './types.js';

export interface ApiConnectionStatusView {
  readonly connectionRef: string;
  readonly status: ApiConnectionStatus;
  readonly account: ApiConnectionAccount | null;
  readonly grantedScopes: readonly string[];
  /** Account of a switch-account result awaiting confirmation, if any. */
  readonly pendingSwitch: ApiConnectionAccount | null;
}

export function toStatusView(record: ApiConnectionRecord): ApiConnectionStatusView {
  return {
    connectionRef: record.key, status: record.status, account: record.account,
    grantedScopes: record.grantedScopes, pendingSwitch: record.staged?.account ?? null,
  };
}

/** A connection that was never created reads as disconnected. */
export async function getApiConnectionStatus(
  deps: Pick<ApiConnectionServiceDeps, 'records' | 'descriptor'>,
  requiredArgs: OwnedRecordArgs,
): Promise<ApiConnectionStatusView> {
  const record = await deps.records.read({ key: requiredArgs.connectionRef });
  if (record === null) {
    return { connectionRef: requiredArgs.connectionRef, status: 'disconnected', account: null, grantedScopes: [], pendingSwitch: null };
  }
  if (!isOwnedRecord(record, deps, requiredArgs.workspaceId)) throw connectionNotFound();
  return toStatusView(record);
}
