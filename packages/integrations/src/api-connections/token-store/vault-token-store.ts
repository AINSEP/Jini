/** @file `OAuthTokenStore` backed by the platform secrets vault.
 * Exists so OAuth connections reuse the vault's sealing, AAD binding and revision CAS instead
 * of a second secret store. It adds three guarantees the OAuth refresher relies on:
 * - a durable refresh lease (vault metadata + CAS), so only one process refreshes at a time;
 * - fencing: a write is refused once the connection's generation moved on (disconnect,
 *   account switch, reconnect) or a newer attempt took the lease, so a late refresh cannot
 *   resurrect tokens;
 * - owner binding: every read must match the expected workspace/plugin/connection/client.
 * A sign-in install is not a refresh, so it takes no lease: it is fenced by the generation the
 * caller moved the connection to, and never overwrites a newer generation's tokens. */
import { randomUUID } from "node:crypto";
import type { Clock } from "@jini-ai/core/primitives";
import type { OAuthTokenSet, OAuthTokenStore } from "@jini-ai/core/contracts/oauth";
import type { VaultContext, VaultIdentity, VaultMeta, VaultSummary } from "@jini-ai/core/contracts/vault";
import type { ApiConnectionTokenStore } from "../ports.js";
import { OAuthTokenStoreError } from "./errors.js";
import { buildRecordMeta, buildTokenPayload, parseTokenPayload, parseTokenSet, readRecordMeta, readReplaceableGeneration,
  type OAuthConnectionOwner, type OAuthConnectionStatus, type OAuthTokenPayload, type OAuthTokenRecordMeta } from "./record.js";

/** A crashed holder's lease frees itself after this long; longer than any single token request. */
const LEASE_TTL_MS = 30_000;
/** Loads older than this cannot belong to a refresh that is about to take the lease. */
const LOAD_OBSERVATION_WINDOW_MS = 60_000;
/** Disconnect and install must win over concurrent lease writes; each retry re-reads the newest revision. */
const WRITE_ATTEMPTS = 3;

/** The vault operations this store uses; `SecretsVaultService` satisfies it.
 * @agent-note Fulfilled by the host's real secrets vault service (the same instance the record store and archive use); exactly
 * these four operations, with their CAS `expectedRevision` semantics and conflict errors unchanged. */
export interface OAuthTokenVaultPort {
  get(input: VaultIdentity): Promise<{ summary: VaultSummary; payload: VaultMeta | null } | null>;
  put(input: VaultContext & { id?: string; expectedRevision: number | null; provider: string | null; label: string; meta: unknown;
    payload?: VaultMeta | null | undefined }): Promise<VaultSummary>;
  patchMeta(input: VaultIdentity & { expectedRevision: number; patch: VaultMeta }): Promise<VaultSummary>;
  delete(input: VaultIdentity & { expectedRevision: number }): Promise<boolean>;
}
/** Current generation of a connection. The host bumps it on disconnect, switch and reconnect. */
export type ReadConnectionGeneration = (requiredArgs: { readonly key: string }) => Promise<number>;

export interface VaultOAuthTokenStoreDeps {
  readonly vault: OAuthTokenVaultPort;
  /** Where rows live. The kind's metadata parser must be `parseOAuthTokenVaultMeta`. */
  readonly vaultScope: VaultContext;
  readonly owner: OAuthConnectionOwner;
  readonly readGeneration: ReadConnectionGeneration;
  readonly clock: Clock;
  /** @agent-note Required real vault-conflict classifier from the host (`error instanceof VaultError && error.code === "conflict"`
   * for the vault service bound above); it decides lease-lost mapping, CAS retries and lease refusal, so it must recognise exactly
   * that service's conflict error and nothing else. */
  readonly isVaultConflict: (error: unknown) => boolean;
}
/** `OAuthTokenStore` plus install and disconnect. Refresh writes (`persist`, `markNeedsReauth`)
 * require the lease; `install` is fenced by its generation instead. */
export type VaultOAuthTokenStore = Required<OAuthTokenStore> & Pick<ApiConnectionTokenStore, "install" | "loadForRevocation" | "delete">;

interface OpenedRecord { readonly revision: number; readonly meta: OAuthTokenRecordMeta; readonly payload: OAuthTokenPayload }
interface InstallTarget { readonly revision: number | null; readonly generation: number | null; readonly meta: OAuthTokenRecordMeta }
interface HeldLease { readonly holder: string; readonly generation: number }
interface LoadObservation { readonly generation: number; readonly atMs: number }


interface StoreCtx {
  readonly deps: VaultOAuthTokenStoreDeps;
  // Leases this instance holds, with the generation recorded at acquisition (the write fence).
  readonly held: Map<string, HeldLease>;
  // Generations recent loads returned; a lease is refused if any differs from the live one,
  // because the refresher would then be refreshing tokens of a connection that has moved on.
  readonly loads: Map<string, LoadObservation[]>;
}

const identity = ({ deps }: StoreCtx, { key }: { key: string }): VaultIdentity => ({ ...deps.vaultScope, id: key });

async function openRecord(ctx: StoreCtx, { key }: { key: string }): Promise<OpenedRecord | null> {
  const found = await ctx.deps.vault.get(identity(ctx, { key }));
  if (found === null) return null;
  const meta = readRecordMeta({ meta: found.summary.meta });
  return { revision: found.summary.revision, meta, payload: parseTokenPayload({ payload: found.payload, key, owner: ctx.deps.owner }) };
}
function recentLoadsOf(ctx: StoreCtx, { key }: { key: string }): LoadObservation[] {
  const nowMs = ctx.deps.clock.nowMs();
  return (ctx.loads.get(key) ?? []).filter(entry => nowMs - entry.atMs < LOAD_OBSERVATION_WINDOW_MS);
}
function observeLoad(ctx: StoreCtx, { key, generation }: { key: string; generation: number }): void {
  ctx.loads.set(key, [...recentLoadsOf(ctx, { key }), { generation, atMs: ctx.deps.clock.nowMs() }]);
}
function takeRecentLoads(ctx: StoreCtx, { key }: { key: string }): LoadObservation[] {
  const recent = recentLoadsOf(ctx, { key });
  ctx.loads.delete(key);
  return recent;
}
async function writeRecord(ctx: StoreCtx, { key, required }: {
  key: string;
  required: { revision: number | null; meta: OAuthTokenRecordMeta; payload: VaultMeta };
}): Promise<void> {
  // The vault keeps labels unique per scope, and one scope holds several rows per connection
  // (main and staged keys, other plugins' connections), so the label is the unique, non-secret key.
  await ctx.deps.vault.put({ ...identity(ctx, { key }), expectedRevision: required.revision, provider: null,
    label: key, meta: buildRecordMeta({ meta: required.meta }), payload: required.payload });
}
// Every token write re-proves the lease and the generation immediately before the CAS write.
async function fencedWrite(ctx: StoreCtx, { key, required }: {
  key: string;
  required: { status: OAuthConnectionStatus; tokens: OAuthTokenSet | null };
}): Promise<void> {
  const { deps } = ctx;
  const lease = ctx.held.get(key);
  if (lease === undefined) throw new OAuthTokenStoreError({ code: "lease-not-held" });
  if (await deps.readGeneration({ key }) !== lease.generation) throw new OAuthTokenStoreError({ code: "stale-generation" });
  const record = await openRecord(ctx, { key });
  if (record === null || record.meta.leaseHolder !== lease.holder) throw new OAuthTokenStoreError({ code: "lease-lost" });
  const payload = buildTokenPayload({ key, owner: deps.owner, generation: lease.generation, tokens: required.tokens });
  try {
    await writeRecord(ctx, {
      key,
      required: { revision: record.revision, meta: { ...record.meta, status: required.status }, payload },
    });
  } catch (error) {
    throw deps.isVaultConflict(error) ? new OAuthTokenStoreError({ code: "lease-lost" }, { cause: error }) : error;
  }
}
async function claimLease(ctx: StoreCtx, { key, required }: {
  key: string;
  required: { record: OpenedRecord | null; generation: number; holder: string };
}): Promise<boolean> {
  const { deps } = ctx;
  const leaseFields = { leaseHolder: required.holder, leaseExpiresAtMs: deps.clock.nowMs() + LEASE_TTL_MS };
  try {
    if (required.record === null) {
      await writeRecord(ctx, {
        key,
        required: { revision: null, meta: { status: "active", ...leaseFields },
        payload: buildTokenPayload({ key, owner: deps.owner, generation: required.generation, tokens: null }) },
      });
    } else {
      await deps.vault.patchMeta({ ...identity(ctx, { key }), expectedRevision: required.record.revision, patch: leaseFields });
    }
    return true;
  } catch (error) {
    if (deps.isVaultConflict(error)) return false;
    throw error;
  }
}
// Lease fields are kept: a refresher holding the lease for an older generation is refused by
// its own generation check or by this write's revision change, and then releases as usual.
// The row an install replaces; see `readReplaceableGeneration` for which rows qualify.
async function openInstallTarget(ctx: StoreCtx, { key }: { key: string }): Promise<InstallTarget> {
  const found = await ctx.deps.vault.get(identity(ctx, { key }));
  if (found === null) return { revision: null, generation: null, meta: { status: "active", leaseHolder: null, leaseExpiresAtMs: null } };
  return { revision: found.summary.revision, generation: readReplaceableGeneration({ payload: found.payload, key, owner: ctx.deps.owner }),
    meta: readRecordMeta({ meta: found.summary.meta }) };
}
async function installOnce(ctx: StoreCtx, { key, required }: {
  key: string;
  required: { tokens: OAuthTokenSet; generation: number };
}): Promise<boolean> {
  const { deps } = ctx;
  if (await deps.readGeneration({ key }) !== required.generation) throw new OAuthTokenStoreError({ code: "stale-generation" });
  const target = await openInstallTarget(ctx, { key });
  // The live generation moved on after the check above and a newer install already landed.
  if (target.generation !== null && target.generation > required.generation) throw new OAuthTokenStoreError({ code: "stale-generation" });
  try {
    await writeRecord(ctx, {
      key,
      required: { revision: target.revision, meta: { ...target.meta, status: "active" },
      payload: buildTokenPayload({ key, owner: deps.owner, generation: required.generation, tokens: required.tokens }) },
    });
    return true;
  } catch (error) {
    if (deps.isVaultConflict(error)) return false;
    throw error;
  }
}
// Needs only the revision: a row this owner can no longer open (another client id, malformed)
// must still be removable, or a disconnect could never clear it.
async function deleteOnce(ctx: StoreCtx, { key }: { key: string }): Promise<boolean> {
  const found = await ctx.deps.vault.get(identity(ctx, { key }));
  if (found === null) return true;
  try {
    await ctx.deps.vault.delete({ ...identity(ctx, { key }), expectedRevision: found.summary.revision });
    return true;
  } catch (error) {
    if (ctx.deps.isVaultConflict(error)) return false;
    throw error;
  }
}
async function tryAcquireRefreshLease(ctx: StoreCtx, { key }: { key: string }): Promise<boolean> {
  const { deps } = ctx;
  const recentLoads = takeRecentLoads(ctx, { key });
  const generation = await deps.readGeneration({ key });
  if (recentLoads.some(entry => entry.generation !== generation)) return false;
  const record = await openRecord(ctx, { key });
  const leaseExpiresAtMs = record?.meta.leaseExpiresAtMs ?? null;
  if (record?.meta.leaseHolder && leaseExpiresAtMs !== null && leaseExpiresAtMs > deps.clock.nowMs()) return false;
  const holder = randomUUID();
  if (!await claimLease(ctx, { key, required: { record, generation, holder } })) return false;
  ctx.held.set(key, { holder, generation });
  return true;
}
async function releaseRefreshLease(ctx: StoreCtx, { key }: { key: string }): Promise<void> {
  const lease = ctx.held.get(key);
  if (lease === undefined) return;
  ctx.held.delete(key);
  const record = await openRecord(ctx, { key });
  if (record === null || record.meta.leaseHolder !== lease.holder) return;
  try {
    await ctx.deps.vault.patchMeta({ ...identity(ctx, { key }), expectedRevision: record.revision, patch: { leaseHolder: null, leaseExpiresAtMs: null } });
  } catch (error) {
    // A concurrent writer changed the row; the lease then lapses on its own expiry.
    if (!ctx.deps.isVaultConflict(error)) throw error;
  }
}
async function loadCurrent(ctx: StoreCtx, { key }: { key: string }): Promise<OAuthTokenSet | null> {
  const generation = await ctx.deps.readGeneration({ key });
  const record = await openRecord(ctx, { key });
  // Tokens sealed under an older generation belong to a disconnected or switched account.
  if (record === null || record.payload.generation !== generation) return null;
  observeLoad(ctx, { key, generation });
  return record.payload.tokens;
}
async function installTokens(ctx: StoreCtx, { key, tokens, generation }: {
  key: string;
  tokens: OAuthTokenSet;
  generation: number;
}): Promise<void> {
  const parsed = parseTokenSet({ value: tokens });
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    if (await installOnce(ctx, { key, required: { tokens: parsed, generation } })) return;
  }
  throw new OAuthTokenStoreError({ code: "write-conflict" });
}
async function deleteTokens(ctx: StoreCtx, { key }: { key: string }): Promise<void> {
  ctx.loads.delete(key);
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    if (await deleteOnce(ctx, { key })) return;
  }
  throw new OAuthTokenStoreError({ code: "write-conflict" });
}

/** Creates the store for one connection owner.
 * @throws OAuthTokenStoreError `configuration` when the vault scope names another workspace. */
export function createVaultOAuthTokenStore(
  deps: VaultOAuthTokenStoreDeps,
  _optionalArgs: Record<string, never> = {},
): VaultOAuthTokenStore {
  if (deps.vaultScope.workspaceId !== deps.owner.workspaceId) throw new OAuthTokenStoreError({ code: "configuration" });
  const ctx: StoreCtx = { deps, held: new Map(), loads: new Map() };
  return {
    load: ({ key }) => loadCurrent(ctx, { key }),
    // Generation-agnostic on purpose: a disconnect disables the credential by moving the
    // generation, and only that disabled credential can still revoke the grant. Not recorded as a
    // load, so it never feeds the refresh-lease decision.
    async loadForRevocation({ key }) {
      const record = await openRecord(ctx, { key });
      return record?.payload.tokens ?? null;
    },
    async persist({ key, tokens }) {
      await fencedWrite(ctx, { key, required: { status: "active", tokens: parseTokenSet({ value: tokens }) } });
    },
    install: ({ key, tokens, generation }) => installTokens(ctx, { key, tokens, generation }),
    // The reason is not stored: callers may pass provider text, and status must stay secret-free.
    // The refresh token is dead after invalid_grant, so the tokens are cleared with the status change.
    async markNeedsReauth({ key }) {
      await fencedWrite(ctx, { key, required: { status: "reconnect-required", tokens: null } });
    },
    tryAcquireRefreshLease: ({ key }) => tryAcquireRefreshLease(ctx, { key }),
    releaseRefreshLease: ({ key }) => releaseRefreshLease(ctx, { key }),
    delete: ({ key }) => deleteTokens(ctx, { key }),
  };
}
