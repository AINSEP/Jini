/** @file `OAuthTokenStore` backed by the platform secrets vault.
 * Exists so OAuth connections reuse the vault's sealing, AAD binding and revision CAS instead
 * of a second secret store. It adds three guarantees the OAuth refresher relies on:
 * - a durable refresh lease (vault metadata + CAS), so only one process refreshes at a time;
 * - fencing: a write is refused once the connection's generation moved on (disconnect,
 *   account switch, reconnect) or a newer attempt took the lease, so a late refresh cannot
 *   resurrect tokens;
 * - owner binding: every read must match the expected workspace/plugin/connection/client. */
import { randomUUID } from "node:crypto";
import type { Clock } from "@jini-ai/core/primitives";
import type { OAuthTokenSet, OAuthTokenStore } from "@jini-ai/oauth";
import { VaultError, type SecretsVaultService, type VaultContext, type VaultIdentity, type VaultMeta } from "@jini-ai/platform/secrets/credential-sets";
import { OAuthTokenStoreError } from "./errors.js";
import { buildRecordMeta, buildTokenPayload, parseTokenPayload, parseTokenSet, readRecordMeta,
  type OAuthConnectionOwner, type OAuthConnectionStatus, type OAuthTokenPayload, type OAuthTokenRecordMeta } from "./record.js";

/** A crashed holder's lease frees itself after this long; longer than any single token request. */
const LEASE_TTL_MS = 30_000;
/** Loads older than this cannot belong to a refresh that is about to take the lease. */
const LOAD_OBSERVATION_WINDOW_MS = 60_000;
/** Disconnect must win over concurrent lease writes; each retry re-reads the newest revision. */
const DELETE_ATTEMPTS = 3;

/** The vault operations this store uses; `SecretsVaultService` satisfies it. */
export type OAuthTokenVaultPort = Pick<SecretsVaultService, "get" | "put" | "patchMeta" | "delete">;
/** Current generation of a connection. The host bumps it on disconnect, switch and reconnect. */
export type ReadConnectionGeneration = (requiredArgs: { readonly key: string }) => Promise<number>;

export interface VaultOAuthTokenStoreDeps {
  readonly vault: OAuthTokenVaultPort;
  /** Where rows live. The kind's metadata parser must be `parseOAuthTokenVaultMeta`. */
  readonly vaultScope: VaultContext;
  readonly owner: OAuthConnectionOwner;
  readonly readGeneration: ReadConnectionGeneration;
  readonly clock: Clock;
}
/** `OAuthTokenStore` plus disconnect. Writes (`persist`, `markNeedsReauth`) require the lease. */
export type VaultOAuthTokenStore = Required<OAuthTokenStore> & {
  delete(requiredArgs: { readonly key: string }): Promise<void>;
};

interface OpenedRecord { readonly revision: number; readonly meta: OAuthTokenRecordMeta; readonly payload: OAuthTokenPayload }
interface HeldLease { readonly holder: string; readonly generation: number }
interface LoadObservation { readonly generation: number; readonly atMs: number }

function isConflict(error: unknown): boolean {
  return error instanceof VaultError && error.code === "conflict";
}

/** Creates the store for one connection owner.
 * @throws OAuthTokenStoreError `configuration` when the vault scope names another workspace. */
export function createVaultOAuthTokenStore(
  deps: VaultOAuthTokenStoreDeps,
  _optionalArgs: Record<string, never> = {},
): VaultOAuthTokenStore {
  const { vault, vaultScope, owner, readGeneration, clock } = deps;
  if (vaultScope.workspaceId !== owner.workspaceId) throw new OAuthTokenStoreError({ code: "configuration" });
  // Leases this instance holds, with the generation recorded at acquisition (the write fence).
  const held = new Map<string, HeldLease>();
  // Generations recent loads returned; a lease is refused if any differs from the live one,
  // because the refresher would then be refreshing tokens of a connection that has moved on.
  const loads = new Map<string, LoadObservation[]>();
  const identity = (key: string): VaultIdentity => ({ ...vaultScope, id: key });

  const open = async (key: string): Promise<OpenedRecord | null> => {
    const found = await vault.get(identity(key));
    if (found === null) return null;
    const meta = readRecordMeta({ meta: found.summary.meta });
    return { revision: found.summary.revision, meta, payload: parseTokenPayload({ payload: found.payload, key, owner }) };
  };
  const observeLoad = (key: string, generation: number): void => {
    const nowMs = clock.nowMs();
    const recent = (loads.get(key) ?? []).filter(entry => nowMs - entry.atMs < LOAD_OBSERVATION_WINDOW_MS);
    loads.set(key, [...recent, { generation, atMs: nowMs }]);
  };
  const takeRecentLoads = (key: string): LoadObservation[] => {
    const nowMs = clock.nowMs();
    const recent = (loads.get(key) ?? []).filter(entry => nowMs - entry.atMs < LOAD_OBSERVATION_WINDOW_MS);
    loads.delete(key);
    return recent;
  };
  const writeRecord = async (key: string, required: { record: OpenedRecord | null; meta: OAuthTokenRecordMeta; payload: VaultMeta }): Promise<void> => {
    await vault.put({ ...identity(key), expectedRevision: required.record?.revision ?? null, provider: null,
      label: owner.connectionId, meta: buildRecordMeta({ meta: required.meta }), payload: required.payload });
  };
  // Every token write re-proves the lease and the generation immediately before the CAS write.
  const fencedWrite = async (key: string, required: { status: OAuthConnectionStatus; tokens: OAuthTokenSet | null }): Promise<void> => {
    const lease = held.get(key);
    if (lease === undefined) throw new OAuthTokenStoreError({ code: "lease-not-held" });
    if (await readGeneration({ key }) !== lease.generation) throw new OAuthTokenStoreError({ code: "stale-generation" });
    const record = await open(key);
    if (record === null || record.meta.leaseHolder !== lease.holder) throw new OAuthTokenStoreError({ code: "lease-lost" });
    const payload = buildTokenPayload({ key, owner, generation: lease.generation, tokens: required.tokens });
    try {
      await writeRecord(key, { record, meta: { ...record.meta, status: required.status }, payload });
    } catch (error) {
      throw isConflict(error) ? new OAuthTokenStoreError({ code: "lease-lost" }, { cause: error }) : error;
    }
  };
  const claimLease = async (key: string, required: { record: OpenedRecord | null; generation: number; holder: string }): Promise<boolean> => {
    const leaseFields = { leaseHolder: required.holder, leaseExpiresAtMs: clock.nowMs() + LEASE_TTL_MS };
    try {
      if (required.record === null) {
        await writeRecord(key, { record: null, meta: { status: "active", ...leaseFields },
          payload: buildTokenPayload({ key, owner, generation: required.generation, tokens: null }) });
      } else {
        await vault.patchMeta({ ...identity(key), expectedRevision: required.record.revision, patch: leaseFields });
      }
      return true;
    } catch (error) {
      if (isConflict(error)) return false;
      throw error;
    }
  };
  const deleteOnce = async (key: string): Promise<boolean> => {
    const record = await open(key);
    if (record === null) return true;
    try {
      await vault.delete({ ...identity(key), expectedRevision: record.revision });
      return true;
    } catch (error) {
      if (isConflict(error)) return false;
      throw error;
    }
  };

  return {
    async load({ key }) {
      const generation = await readGeneration({ key });
      const record = await open(key);
      // Tokens sealed under an older generation belong to a disconnected or switched account.
      if (record === null || record.payload.generation !== generation) return null;
      observeLoad(key, generation);
      return record.payload.tokens;
    },
    async persist({ key, tokens }) {
      await fencedWrite(key, { status: "active", tokens: parseTokenSet({ value: tokens }) });
    },
    // The reason is not stored: callers may pass provider text, and status must stay secret-free.
    // The refresh token is dead after invalid_grant, so the tokens are cleared with the status change.
    async markNeedsReauth({ key }) {
      await fencedWrite(key, { status: "reconnect-required", tokens: null });
    },
    async tryAcquireRefreshLease({ key }) {
      const recentLoads = takeRecentLoads(key);
      const generation = await readGeneration({ key });
      if (recentLoads.some(entry => entry.generation !== generation)) return false;
      const record = await open(key);
      const leaseExpiresAtMs = record?.meta.leaseExpiresAtMs ?? null;
      if (record?.meta.leaseHolder && leaseExpiresAtMs !== null && leaseExpiresAtMs > clock.nowMs()) return false;
      const holder = randomUUID();
      if (!await claimLease(key, { record, generation, holder })) return false;
      held.set(key, { holder, generation });
      return true;
    },
    async releaseRefreshLease({ key }) {
      const lease = held.get(key);
      if (lease === undefined) return;
      held.delete(key);
      const record = await open(key);
      if (record === null || record.meta.leaseHolder !== lease.holder) return;
      try {
        await vault.patchMeta({ ...identity(key), expectedRevision: record.revision, patch: { leaseHolder: null, leaseExpiresAtMs: null } });
      } catch (error) {
        // A concurrent writer changed the row; the lease then lapses on its own expiry.
        if (!isConflict(error)) throw error;
      }
    },
    async delete({ key }) {
      loads.delete(key);
      for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt += 1) {
        if (await deleteOnce(key)) return;
      }
      throw new OAuthTokenStoreError({ code: "write-conflict" });
    },
  };
}
