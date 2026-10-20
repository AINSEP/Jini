/**
 * @file Read and compare-and-set helpers over the record store.
 *
 * Exists so every write bumps `revision` the same way and a lost race surfaces as one
 * `storage-conflict` error instead of a silent overwrite, and so a service can only touch
 * records of its own plugin connection.
 */
import { nowIso } from '@jini-ai/core/primitives';
import type { ApiConnectionServiceDeps } from './deps.js';
import { ApiConnectionError } from './errors.js';
import type { ApiConnectionRecord } from './types.js';

type RecordDeps = Pick<ApiConnectionServiceDeps, 'records' | 'clock' | 'descriptor'>;
export type RecordPatch = Partial<Pick<ApiConnectionRecord, 'status' | 'generation' | 'account' | 'grantedScopes' | 'staged' | 'revocationFailure'>>;

export function connectionNotFound(): ApiConnectionError {
  return new ApiConnectionError({
    code: 'connection-not-found',
    message: 'This connection does not exist for this plugin in this workspace. Connect the account first.',
  });
}

/** The ref a caller passes plus the workspace its host authorized it for. */
export interface OwnedRecordArgs { readonly connectionRef: string; readonly workspaceId: string }

/**
 * A service bound to one plugin connection must never act on another plugin's record, and a ref
 * from another workspace is refused here too, so a host cannot serve one by forgetting to check.
 */
export function isOwnedRecord(record: ApiConnectionRecord, deps: Pick<RecordDeps, 'descriptor'>, workspaceId: string): boolean {
  return record.pluginId === deps.descriptor.pluginId && record.connectionId === deps.descriptor.connectionId
    && record.workspaceId === workspaceId;
}

/** Load a record owned by this service's plugin connection in `workspaceId`, or throw `connection-not-found`. */
export async function loadOwnedRecord(deps: RecordDeps, requiredArgs: OwnedRecordArgs): Promise<ApiConnectionRecord> {
  const record = await deps.records.read({ key: requiredArgs.connectionRef });
  if (record === null || !isOwnedRecord(record, deps, requiredArgs.workspaceId)) throw connectionNotFound();
  return record;
}

/** Empty record for a first connect; revision 0 means "absent" to compare-and-set. */
export function blankRecord(deps: RecordDeps, requiredArgs: { readonly key: string; readonly workspaceId: string }): ApiConnectionRecord {
  return {
    key: requiredArgs.key, workspaceId: requiredArgs.workspaceId,
    pluginId: deps.descriptor.pluginId, connectionId: deps.descriptor.connectionId,
    status: 'disconnected', revision: 0, generation: 0, account: null, grantedScopes: [], staged: null, revocationFailure: null,
    updatedAt: nowIso({ clock: deps.clock }),
  };
}

/** Apply `patch` iff nobody wrote since `current` was read; returns the stored record. */
export async function writeRecord(deps: RecordDeps, current: ApiConnectionRecord, patch: RecordPatch): Promise<ApiConnectionRecord> {
  const next: ApiConnectionRecord = { ...current, ...patch, revision: current.revision + 1, updatedAt: nowIso({ clock: deps.clock }) };
  const written = await deps.records.compareAndSet({ key: current.key, expectedRevision: current.revision, record: next });
  if (!written) {
    throw new ApiConnectionError({
      code: 'storage-conflict',
      message: 'This connection changed while the request was running. Reload its status and try again.',
    });
  }
  return next;
}
