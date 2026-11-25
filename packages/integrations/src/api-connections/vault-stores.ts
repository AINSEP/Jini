import { VaultError, type VaultContext, type VaultIdentity, type VaultMeta, type VaultQuery, type VaultSummary } from "@jini-ai/core/contracts/vault";
import type { Clock } from "@jini-ai/core/primitives";
import { createApiConnectionGenerationReader } from "./keys.js";
import { createVaultOAuthTokenStore, type OAuthTokenVaultPort } from "./token-store/vault-token-store.js";
import { deriveApiConnectionKey } from "./keys.js";
import { parseTokenPayload, buildTokenPayload } from "./token-store/record.js";
import type { ApiConnectionAttempt, ApiConnectionRecord } from "./types.js";
import type { ApiConnectionRecordStore, ApiConnectionTokenStore } from "./ports.js";

export interface ApiConnectionArchiveEntry {
  id: string; kind: string; ownerKey: string; binding: string | null; provider: string | null;
  label: string; isDefault: boolean; meta: VaultMeta; payload: VaultMeta | null;
}

export interface ApiConnectionVaultPolicy {
  scope(required: { workspaceId: string }): VaultContext;
  recordFormat: string;
  attemptFormat: string;
  pluginStateFormat: string;
  hashState(required: { state: string }): string;
  recordLabel(required: { key: string }): string;
  attemptLabel(required: { attempt: ApiConnectionAttempt }): string;
  isOwnerReference(required: { id: string }): boolean;
  omittedNotice(required: { count: number }): string;
}

/**
 * @file the host's storage for plugin-declared API connections, all in the existing secrets vault under
 * the `api-connection` kind (migration 0020): the sealed token sets (Jini's vault token store), the
 * connection records and the single-use sign-in attempts. The same kind also holds plugin settings
 * rows (`plugin-state.ts`), so plugin state needs no new table or vault kind (no migration 0021).
 *
 * Why the vault for records and attempts too: the settings ledger is append-only and exportable,
 * and an attempt carries a PKCE verifier that must never be exported or logged. Sealed vault rows
 * give revision CAS (record writes) and a revision-checked delete (consume-once attempts) with no
 * new table. Row ids are prefixed so they can never collide with a token row, whose id is the
 * connection key itself.
 */

const recordId = ({ key }: { key: string }, _optional = {}): string => `record:${key}`;
// State is sealed inside the attempt only: row ids and labels are visible to vault listings.
const attemptId = ({ state, policy }: { state: string; policy: ApiConnectionVaultPolicy }, _optional = {}): string => `attempt:${policy.hashState({ state })}`;
/** The host-side record store: Jini's port plus a non-consuming read the public callback routes by. */
export interface ApiConnectionVaultRecordStore extends ApiConnectionRecordStore {
  /** The attempt a callback `state` names, without consuming it; null when unknown or used. */
  peekAttempt(required: { readonly state: string }, optional?: Record<string, never>): Promise<ApiConnectionAttempt | null>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isConflict = ({ error }: { error: unknown }, _optional = {}): boolean => error instanceof VaultError && error.code === "conflict";
async function sweepExpiredAttempts(required: Parameters<typeof createApiConnectionVaultRecordStore>[0], vault: Parameters<typeof createApiConnectionVaultRecordStore>[0]["vault"], scope: VaultContext): Promise<void> {
    const nowMs = required.clock.nowMs();
    for (const row of await vault.list({ ...scope })) {
      if (row.meta.credentialFormat !== required.policy.attemptFormat || (row.meta.expiresAtMs as number) > nowMs) continue;
      await vault.delete({ ...scope, id: row.id, expectedRevision: row.revision }).catch((error: unknown) => { if (!isConflict({ error })) throw error; });
    }
  
}


/**
 * Connection records and attempts as sealed vault rows. `compareAndSet` maps the record revision to
 * the vault revision (0 = create); `takeAttempt` deletes with the revision it read, so two callbacks
 * racing on one state cannot both get the attempt.
 * @complexity O(1) vault calls per operation; `putAttempt` also sweeps expired attempts, O(a) rows.
 */
export function createApiConnectionVaultRecordStore(
  required: { readonly vault: {
  get(input: VaultIdentity): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null>;
  put(input: VaultContext & { id?: string; expectedRevision: number | null; provider: string | null; label: string; meta: unknown; payload?: VaultMeta | null | undefined; isDefault?: boolean | undefined; hintToken?: string }): Promise<VaultSummary>;
  delete(input: VaultIdentity & { expectedRevision: number }): Promise<boolean>;
  list(input: VaultQuery): Promise<VaultSummary[]>;
}; readonly workspaceId: string; readonly clock: Clock; readonly policy: ApiConnectionVaultPolicy },
  _optional: Record<string, never> = {},
): ApiConnectionVaultRecordStore {
  const { policy } = required;
  const scope = policy.scope({ workspaceId: required.workspaceId });
  const { vault } = required;
  const readPayload = async ({ id }: { id: string }, _optional = {}) => vault.get({ ...scope, id });
  const readAttempt = async ({ state }: { state: string }, _optional = {}) => {
    const found = await readPayload({ id: attemptId({ state, policy }) });
    return found && isObject(found.payload?.attempt) ? { found, attempt: found.payload.attempt as unknown as ApiConnectionAttempt } : null;
  };
  return {
    async read({ key }) {
      const found = await readPayload({ id: recordId({ key }) });
      if (!found || !isObject(found.payload?.record)) return null;
      const record = found.payload.record as unknown as ApiConnectionRecord;
      // A record sealed under another key (a copied or tampered row) is never served.
      if (record.key !== key) throw new VaultError({ code: "invalid-record" });
      return { ...record, revision: found.summary.revision };
    },
    async compareAndSet({ key, expectedRevision, record }) {
      if (record.key !== key) throw new VaultError({ code: "invalid-record" });
      try {
        await vault.put({ ...scope, id: recordId({ key }), expectedRevision: expectedRevision === 0 ? null : expectedRevision, provider: null,
          label: policy.recordLabel({ key }), meta: { credentialFormat: policy.recordFormat }, payload: { record: { ...record } as unknown as VaultMeta } });
        return true;
      } catch (error) {
        if (isConflict({ error })) return false;
        throw error;
      }
    },
    async putAttempt({ attempt }) {
      await sweepExpiredAttempts(required, vault, scope);
      await vault.put({ ...scope, id: attemptId({ state: attempt.state, policy }), expectedRevision: null, provider: null, label: policy.attemptLabel({ attempt }),
        meta: { credentialFormat: policy.attemptFormat, expiresAtMs: Date.parse(attempt.expiresAt) }, payload: { attempt: { ...attempt } as unknown as VaultMeta } });
    },
    async takeAttempt({ state }) {
      const read = await readAttempt({ state });
      if (!read) return null;
      const deleted = await vault.delete({ ...scope, id: attemptId({ state, policy }), expectedRevision: read.found.summary.revision })
        .catch((error: unknown) => { if (isConflict({ error })) { return false; } throw error; });
      return deleted ? read.attempt : null;
    },
    async peekAttempt({ state }) {
      return (await readAttempt({ state }))?.attempt ?? null;
    },
  };
}

/**
 * Jini's vault token store bound to one connection owner, fenced by the record store's generation.
 * Sign-in and switch write through its fenced `install` (no lease); only the refresher's `persist`
 * needs the refresh lease, so the host no longer wraps writes in one.
 * @complexity O(1) setup.
 */
export function createApiConnectionVaultTokenStore(
  required: {
    readonly vault: OAuthTokenVaultPort; readonly records: ApiConnectionRecordStore; readonly clock: Clock; readonly policy: ApiConnectionVaultPolicy;
    readonly owner: { readonly workspaceId: string; readonly pluginId: string; readonly connectionId: string; readonly clientId: string };
  },
  _optional: Record<string, never> = {},
): ApiConnectionTokenStore {
  return createVaultOAuthTokenStore({
    vault: required.vault, vaultScope: required.policy.scope({ workspaceId: required.owner.workspaceId }), owner: required.owner,
    readGeneration: createApiConnectionGenerationReader({ records: required.records }), clock: required.clock,
    isVaultConflict: error => isConflict({ error }),
  });
}

/** Verify the durable record owns its original derived key before constructing a recipient key. */
function archiveConnection(row: ApiConnectionArchiveEntry): ApiConnectionRecord {
  const record = row.payload?.record;
  if (!isObject(record)) throw new VaultError({ code: "invalid-record" });
  const ids = [record.workspaceId, record.pluginId, record.connectionId];
  if (ids.some(value => typeof value !== "string" || !value)) throw new VaultError({ code: "invalid-record" });
  const connection = record as unknown as ApiConnectionRecord;
  if (deriveApiConnectionKey(connection) !== connection.key || row.id !== recordId({ key: connection.key })) throw new VaultError({ code: "context" });
  assertArchiveConnectionState(connection);
  return connection;
}

/** Archive transport admits connected durable state only; no pending account switch is resumed. */
function assertArchiveConnectionState(connection: ApiConnectionRecord): void {
  if (!Number.isSafeInteger(connection.generation) || connection.generation < 0 || !Array.isArray(connection.grantedScopes)) throw new VaultError({ code: "invalid-record" });
  if (!connection.grantedScopes.every(scope => typeof scope === "string") || connection.status !== "connected") throw new VaultError({ code: "invalid-record" });
}

/** Reuse the token owner's authenticated payload codec; enumerate only durable record fields. */
function reboundConnection(required: { row: ApiConnectionArchiveEntry; rows: ReadonlyMap<string, ApiConnectionArchiveEntry>; workspaceId: string; policy: ApiConnectionVaultPolicy }): ApiConnectionArchiveEntry[] {
  const connection = archiveConnection(required.row);
  const tokenRow = required.rows.get(connection.key);
  const payload = tokenRow?.payload, owner = payload?.owner;
  if (!tokenRow || !isObject(owner) || typeof owner.clientId !== "string") throw new VaultError({ code: "invalid-record" });
  const sourceOwner = { workspaceId: connection.workspaceId, pluginId: connection.pluginId, connectionId: connection.connectionId, clientId: owner.clientId };
  const parsed = parseTokenPayload({ payload, key: connection.key, owner: sourceOwner });
  if (parsed.generation !== connection.generation || !parsed.tokens) throw new VaultError({ code: "invalid-record" });
  const key = deriveApiConnectionKey({ ...sourceOwner, workspaceId: required.workspaceId });
  // Enumerate durable fields: staged account switches, actors, leases and source extensions die here.
  const record: ApiConnectionRecord = { key, workspaceId: required.workspaceId, pluginId: connection.pluginId, connectionId: connection.connectionId,
    status: "connected", revision: 1, generation: connection.generation, account: connection.account, grantedScopes: [...connection.grantedScopes],
    staged: null, revocationFailure: null, updatedAt: connection.updatedAt };
  return [
    { ...required.row, id: recordId({ key }), label: required.policy.recordLabel({ key }), payload: { record: record as unknown as VaultMeta } },
    { ...tokenRow, id: key, label: key, meta: { credentialFormat: "oauth-token-set", status: "active", leaseHolder: null, leaseExpiresAtMs: null },
      payload: buildTokenPayload({ key, owner: { ...sourceOwner, workspaceId: required.workspaceId }, generation: parsed.generation, tokens: parsed.tokens }) },
  ];
}

/** Transient attempts/switches are deliberate exclusions; orphan durable rows deserve a notice. */
function omittedApiRow(row: ApiConnectionArchiveEntry, consumed: ReadonlySet<string>, policy: ApiConnectionVaultPolicy): boolean {
  const transient = row.id.endsWith("#staged") || row.meta.credentialFormat === policy.attemptFormat;
  return !consumed.has(row.id) && !transient;
}

/** Mark both halves consumed. One failed pair gets one notice, even when both its record and tokens are unusable. */
function markApiPairConsumed(row: ApiConnectionArchiveEntry, consumed: Set<string>): void {
  consumed.add(row.id);
  const record = row.payload?.record;
  if (isObject(record) && typeof record.key === "string") consumed.add(record.key);
}

/** Transport only complete, connected record/token pairs using the live key/codec owners. Plugin
 * settings have no workspace-derived identity. Pending sign-ins, shared references and staged tokens never travel.
 * Unsupported durable connections are omitted with a count, never raw identifiers/provider text.
 * @example const rebound = rebindApiConnectionArchive({ entries, workspaceId: recipientWorkspaceId });
 * @complexity O(rows + token bytes) time/space, bounded by the archive's credential cap.
 */
export function rebindApiConnectionArchive(required: { entries: readonly ApiConnectionArchiveEntry[]; workspaceId: string; policy: ApiConnectionVaultPolicy }, _optional: Record<string, never> = {}): { entries: ApiConnectionArchiveEntry[]; notices: string[] } {
  const { policy } = required;
  const kind = policy.scope({ workspaceId: required.workspaceId }).kind;
  const entries = required.entries.filter(row => row.kind !== kind);
  const api = required.entries.filter(row => row.kind === kind && !policy.isOwnerReference({ id: row.id }));
  const rows = new Map(api.map(row => [row.id, row]));
  let omitted = 0;
  const consumed = new Set<string>();
  for (const row of api) {
    if (row.meta.credentialFormat === policy.pluginStateFormat && row.id.startsWith("plugin-state:")) { entries.push(row); consumed.add(row.id); }
    if (row.meta.credentialFormat !== policy.recordFormat) continue;
    try {
      const pair = reboundConnection({ row, rows, workspaceId: required.workspaceId, policy });
      entries.push(...pair);
      markApiPairConsumed(row, consumed);
    } catch {
      omitted++;
      markApiPairConsumed(row, consumed);
    }
  }
  omitted += api.filter(row => omittedApiRow(row, consumed, policy)).length;
  return { entries, notices: omitted ? [policy.omittedNotice({ count: omitted })] : [] };
}
