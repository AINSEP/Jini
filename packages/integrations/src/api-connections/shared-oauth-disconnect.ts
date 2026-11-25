import { ApiConnectionError, disconnectApiConnection, type ApiConnectionHooks } from './index.js';
import type { Clock } from '@jini-ai/core/primitives';
import type { KeyAttachments, ProjectKeyTransaction } from '@jini-ai/core/contracts/site/project-key-attachments';

export interface SharedOAuthDisconnectReport {
  id: string; label: string; sites: string[]; revision: number; sourceDigest: string;
  applied: boolean; status: string; remoteRevocation: 'confirmed' | 'pending' | 'not-needed';
}

type DisconnectDeps = Parameters<typeof disconnectApiConnection>[0]['deps'];
/** The selected issuing context disconnect reads: the owner identity it re-checks and the descriptor revocation uses. */
export interface SharedOAuthDisconnectContext {
  readonly identity: { readonly pluginId: string; readonly connectionId: string };
  readonly descriptor: DisconnectDeps['descriptor'];
}
/** Explicit owner-storage contract at the disconnect seam (the host binds the shared-owner storage). Method syntax keeps the
 * context the storage returned flowing back into `tokensFor` unchanged. */
export interface SharedOAuthDisconnectStorage {
  readContext(input: { credentialId: string }): Promise<SharedOAuthDisconnectContext | null>;
  readonly records: DisconnectDeps['records'];
  tokensFor(input: { context: SharedOAuthDisconnectContext }): DisconnectDeps['tokens'];
}
type Empty = Record<string, never>;
export type DisconnectOwner = {
  storage: SharedOAuthDisconnectStorage; attachments: KeyAttachments; transaction: ProjectKeyTransaction; clock: Clock;
  ownerWorkspaceId: string;
  digest: (required: { text: string }, optional?: Empty) => string;
  copy: { changed: string; revocationUnavailable: string };
};
export interface SharedOAuthDisconnectInspection {
  context: SharedOAuthDisconnectContext;
  record: NonNullable<Awaited<ReturnType<DisconnectDeps['records']['read']>>>;
  report: SharedOAuthDisconnectReport;
}
const changed = (required: DisconnectOwner) => new ApiConnectionError({ code: 'storage-conflict', message: required.copy.changed });

/** Review only the selected owner connection and its current grants.
 * @complexity One context/record lookup and one selected connection's grant query; no token read.
 */
export async function inspectSharedOAuthDisconnect(required: DisconnectOwner & { credentialId: string }, _optional: Empty = {}): Promise<SharedOAuthDisconnectInspection> {
  const { storage, credentialId } = required;
  const [context, record, sites] = await Promise.all([storage.readContext({ credentialId }), storage.records.read({ key: credentialId }), required.attachments.usersOf({ keyId: credentialId })]);
  if (!context || !record || record.workspaceId !== required.ownerWorkspaceId || record.pluginId !== context.identity.pluginId || record.connectionId !== context.identity.connectionId) throw changed(required);
  const sourceDigest = required.digest({ text: JSON.stringify({ credentialId, revision: record.revision, sites }) });
  const report: SharedOAuthDisconnectReport = { id: credentialId, label: context.descriptor.label, sites: sites.map(site => site.siteName),
    revision: record.revision, sourceDigest, applied: false, status: record.status, remoteRevocation: 'pending' };
  return { context, record, report };
}

/** Stop this owner's shared connection and every site grant atomically before provider traffic.
 * Jini owns pending-revocation/retry semantics. Without a loaded plugin hook, remote confirmation
 * remains pending and disabled tokens stay available for an explicit retry by that plugin.
 * @complexity Selected-row CAS plus one connection's grant delete, then Jini's bounded lifecycle I/O.
 */
export async function disconnectSharedOAuth(required: DisconnectOwner & {
  credentialId: string; expectedRevision: number; expectedDigest: string;
}, optional: { revoke?: ApiConnectionHooks['revoke'] } = {}): Promise<SharedOAuthDisconnectReport> {
  const inspected = await required.transaction({ run: async () => {
    const current = await inspectSharedOAuthDisconnect(required);
    if (current.record.revision !== required.expectedRevision || current.report.sourceDigest !== required.expectedDigest) throw changed(required);
    if (current.record.status !== 'revocation-pending') {
      const stopped = { ...current.record, status: 'revocation-pending' as const, generation: current.record.generation + 1,
        revision: current.record.revision + 1, staged: null, updatedAt: new Date(required.clock.nowMs()).toISOString() };
      if (!await required.storage.records.compareAndSet({ key: required.credentialId, expectedRevision: current.record.revision, record: stopped })) throw changed(required);
    }
    await required.attachments.removeKey({ keyId: required.credentialId });
    return current;
  } });
  const result = await disconnectApiConnection({ deps: { descriptor: inspected.context.descriptor, records: required.storage.records,
    tokens: required.storage.tokensFor({ context: inspected.context }), clock: required.clock,
    hooks: { revoke: optional.revoke ?? (async () => { throw Object.assign(new Error(required.copy.revocationUnavailable), { code: 'provider-unreachable' }); }) } },
    connectionRef: required.credentialId, workspaceId: required.ownerWorkspaceId });
  return { ...inspected.report, applied: true, status: result.status, remoteRevocation: result.remoteRevocation };
}
