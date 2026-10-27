import { SecretsVaultService, isCopyableKind, type VaultPutInput, type VaultServiceDeps } from "@jini-ai/platform/secrets/credential-sets";
import { VaultError, type VaultContext, type VaultCopyResult, type VaultOptions, type VaultSummary } from "@jini-ai/platform/secrets/credential-sets/contracts";
import type { StorageKernel } from "@jini-ai/db/kernel";
import { SqlSecretsVaultRepo, type SecretsVaultDatabase } from "@jini-ai/db/secrets-vault";

export const OWNER_WORKSPACE_ID = "owner";
/** `workspace_id` is the one site workspace this grant copies to, bound by its first sync; null until then. */
export interface OwnerGrant { entry_id: string; consumer_id: string; workspace_id: string | null; created_at: string }
/** A revoked copy whose target cleanup has not yet succeeded; `attempts` counts failed cleanups.
 * `workspace_id` is the site workspace that holds the copy; only that workspace can settle it.
 */
export interface OwnerRevocation { entry_id: string; consumer_id: string; workspace_id: string; attempts: number; updated_at: string }
/** An entry whose copies may sit at destinations no record names (pre-binding grants, version-1 restores). */
export interface OwnerUnreconciled { entry_id: string }
export interface OwnerStoreDatabase extends SecretsVaultDatabase { owner_grants: OwnerGrant; owner_revocations: OwnerRevocation; owner_unreconciled: OwnerUnreconciled }
export interface OwnerSyncTarget {
  consumerId: string;
  workspaceId: string;
  vault: SecretsVaultService;
}
export type OwnerPutInput = Omit<VaultPutInput, "workspaceId" | "principalId">;
type OwnerEntry = Pick<VaultContext, "kind" | "ownerKey" | "binding"> & { id: string };
type CleanupOutcome = { ok: true } | { ok: false; error: unknown };

/** Syncs stop retrying a site's cleanup after this many failures; an explicit revoke always retries. */
export const OWNER_REVOCATION_AUTO_ATTEMPTS = 5;

/** Deletion is refused while a revoked copy may remain; code stays "conflict" for existing callers. */
export class OwnerRevocationPendingError extends VaultError {
  constructor({ entryId, consumerId }: { entryId: string; consumerId: string }, _options: VaultOptions = {}) {
    super({ code: "conflict" });
    this.name = "OwnerRevocationPendingError";
    this.message = `Owner store: entry ${entryId} may still be copied on consumer "${consumerId}"; revoke it for that consumer again before deleting`;
  }
}

/** Deletion is refused until the owner names every site that may hold an untracked copy; code stays "conflict". */
export class OwnerUnreconciledError extends VaultError {
  constructor({ entryId }: { entryId: string }, _options: VaultOptions = {}) {
    super({ code: "conflict" });
    this.name = "OwnerUnreconciledError";
    this.message = `Owner store: entry ${entryId} may still be copied on sites no record names; reconcile it with each of them before deleting`;
  }
}

/** Fixed owner scope still preserves feature ownership, which the copy contract authenticates. */
export function ownerContext(input: Pick<VaultContext, "kind" | "ownerKey" | "binding">, _options: VaultOptions = {}): VaultContext {
  return { kind: input.kind, ownerKey: input.ownerKey, binding: input.binding,
    workspaceId: OWNER_WORKSPACE_ID, principalId: null };
}

/** Composes the existing vault lifecycle and a consumer grant ledger, never another sealer.
 * Cross-database copies are individually reported by the vault; callers retry failed rows.
 * Failed revocation cleanups are recorded durably and retried by later syncs to that consumer.
 * @example await store.grant({ entryId, consumerId }); await store.syncTo({ target });
 */
export class OwnerStoreService {
  readonly vault: SecretsVaultService;
  readonly repo: SqlSecretsVaultRepo;
  readonly kernel: StorageKernel<OwnerStoreDatabase>;
  private readonly now: VaultServiceDeps["now"];

  constructor(required: { kernel: StorageKernel<OwnerStoreDatabase>; repo?: SqlSecretsVaultRepo } & Omit<VaultServiceDeps, "repo" | "authorize">, _options: VaultOptions = {}) {
    this.kernel = required.kernel;
    this.now = required.now;
    // Defaulted so pre-move direct constructions (kernel only) keep working. Kysely's DB generic is
    // invariant; the vault sees only its table on this same transaction owner.
    this.repo = required.repo ?? new SqlSecretsVaultRepo({ kernel: required.kernel as unknown as StorageKernel<SecretsVaultDatabase> });
    this.vault = new SecretsVaultService({ ...required, repo: this.repo, authorize: async ({ context }) => {
      if (context.workspaceId !== OWNER_WORKSPACE_ID || context.principalId !== null || !isCopyableKind[context.kind]) {
        throw new VaultError({ code: "context" });
      }
    } });
  }

  /** Create/replace through vault validation, CAS and encryption; never returns submitted payloads. */
  put(input: OwnerPutInput, _options: VaultOptions = {}): Promise<VaultSummary> {
    return this.vault.put({ ...input, ...ownerContext(input) });
  }

  /** Metadata-only inventory; distinct scopes reuse the vault's authorization and parsing owner.
   * @complexity O(n + g) rows and g indexed scope queries, for n entries in g scopes.
   */
  async list(_input: VaultOptions, _options: VaultOptions = {}): Promise<VaultSummary[]> {
    const groups = await this.kernel.run(db => db.selectFrom("secrets_vault").select(["kind", "owner_key"])
      .where("workspace_id", "=", OWNER_WORKSPACE_ID).distinct().execute());
    const entries: VaultSummary[] = [];
    for (const group of groups) entries.push(...await this.vault.list({ ...ownerContext({ kind: group.kind, ownerKey: group.owner_key, binding: null }) }));
    return entries;
  }

  /** Validate existence before granting. Idempotent under the same database writer lock.
   * @throws OwnerRevocationPendingError while this consumer's earlier copy awaits cleanup: the pending
   * record names the old destination, so a fresh grant bound elsewhere would leave that copy untracked.
   */
  async grant(input: { entryId: string; consumerId: string }, _options: VaultOptions = {}): Promise<void> {
    if (!input.consumerId) throw new VaultError({ code: "context" });
    await this.kernel.transaction(async () => {
      await this.requireEntry(input);
      const pending = await this.kernel.run(db => db.selectFrom("owner_revocations").select("entry_id")
        .where("entry_id", "=", input.entryId).where("consumer_id", "=", input.consumerId).executeTakeFirst());
      if (pending) throw new OwnerRevocationPendingError(input);
      await this.kernel.run(db => db.insertInto("owner_grants").values({ entry_id: input.entryId,
        consumer_id: input.consumerId, workspace_id: null, created_at: this.now({}) })
        .onConflict(conflict => conflict.columns(["entry_id", "consumer_id"]).doNothing()).execute());
    });
  }

  /** Return only grant metadata, ordered for stable command output. */
  grants(_input: VaultOptions, _options: VaultOptions = {}): Promise<OwnerGrant[]> {
    return this.kernel.run(db => db.selectFrom("owner_grants").selectAll().orderBy("consumer_id").orderBy("entry_id").execute());
  }

  /** Revoked copies whose target cleanup is still outstanding, ordered for stable command output. */
  pendingRevocations(_input: VaultOptions, _options: VaultOptions = {}): Promise<OwnerRevocation[]> {
    return this.kernel.run(db => db.selectFrom("owner_revocations").selectAll().orderBy("consumer_id").orderBy("entry_id").execute());
  }

  /** Source lock orders sync against replacement/revoke; copies keep their immutable entry IDs.
   * Outstanding cleanups for this consumer are retried first (until the automatic cap); their failures
   * stay recorded, not thrown, and every cleanup still outstanding is reported as a "failed" row with
   * reasonCode "conflict" (the code delete refuses with), so a stalled or exhausted cleanup is never silent.
   * Each grant copies to one workspace only: a grant bound elsewhere is reported "failed"/"context", uncopied.
   * @complexity O(r + n + payload bytes) for this consumer's r pending revocations and n granted entries.
   */
  async syncTo({ target }: { target: OwnerSyncTarget }, _options: VaultOptions = {}): Promise<VaultCopyResult[]> {
    // Bound and committed before any copy, so no copy can exist without the workspace that tracks it.
    await this.kernel.run(db => db.updateTable("owner_grants").set({ workspace_id: target.workspaceId })
      .where("consumer_id", "=", target.consumerId).where("workspace_id", "is", null).execute());
    return this.kernel.transaction(async () => {
      const pending = await this.kernel.run(db => db.selectFrom("owner_revocations").select(["entry_id", "attempts"])
        .where("consumer_id", "=", target.consumerId).orderBy("entry_id").execute());
      const results: VaultCopyResult[] = [];
      for (const row of pending) {
        const entry = await this.requireEntry({ entryId: row.entry_id });
        const settled = row.attempts < OWNER_REVOCATION_AUTO_ATTEMPTS && (await this.cleanTarget({ entry, target })).ok;
        if (!settled) results.push({ kind: entry.kind, id: entry.id, status: "failed", reasonCode: "conflict" });
      }
      const grants = await this.kernel.run(db => db.selectFrom("owner_grants").select(["entry_id", "workspace_id"])
        .where("consumer_id", "=", target.consumerId).orderBy("entry_id").execute());
      for (const grant of grants) {
        const entry = await this.requireEntry({ entryId: grant.entry_id });
        if (grant.workspace_id !== target.workspaceId) {
          results.push({ kind: entry.kind, id: entry.id, status: "failed", reasonCode: "context" });
          continue;
        }
        results.push(...await target.vault.copyToSite({ source: this.vault, sourceContext: ownerContext(entry),
          targetContext: { ...ownerContext(entry), workspaceId: target.workspaceId }, ids: [entry.id], overwrite: true }));
      }
      return results;
    });
  }

  /** Revoke centrally even if target cleanup fails. A failed cleanup is recorded as pending, so
   * delete stays refused and later syncs to that consumer retry; retrying removes the same copied ID.
   * The source lock prevents an in-flight sync from republishing after cleanup.
   * @throws VaultError "context", with nothing changed, when the grant is bound to another workspace:
   * that target's empty lookup would prove nothing about the copy, yet would drop the grant tracking it.
   * Target vault failures after the central revocation and pending record have committed.
   */
  async revoke({ entryId, target }: { entryId: string; target: OwnerSyncTarget }, _options: VaultOptions = {}): Promise<void> {
    const outcome = await this.kernel.transaction(async () => {
      const entry = await this.requireEntry({ entryId });
      const grant = await this.kernel.run(db => db.selectFrom("owner_grants").select("workspace_id")
        .where("entry_id", "=", entryId).where("consumer_id", "=", target.consumerId).executeTakeFirst());
      if (grant && grant.workspace_id !== null && grant.workspace_id !== target.workspaceId) throw new VaultError({ code: "context" });
      await this.kernel.run(db => db.deleteFrom("owner_grants").where("entry_id", "=", entryId)
        .where("consumer_id", "=", target.consumerId).execute());
      return this.cleanTarget({ entry, target });
    });
    if (!outcome.ok) throw outcome.error;
  }

  /** Require explicit revocation, and confirmed target cleanup, before deletion so copied values cannot become untracked.
   * @throws OwnerRevocationPendingError while a revoked copy's cleanup is outstanding; OwnerUnreconciledError
   * until a mark from an unbound grant or a version-1 restore is reconciled; VaultError "conflict" while granted.
   */
  async delete(input: { entryId: string; expectedRevision: number }, _options: VaultOptions = {}): Promise<boolean> {
    return this.kernel.transaction(async () => {
      const grant = await this.kernel.run(db => db.selectFrom("owner_grants").select("entry_id")
        .where("entry_id", "=", input.entryId).executeTakeFirst());
      if (grant) throw new VaultError({ code: "conflict" });
      const pending = await this.kernel.run(db => db.selectFrom("owner_revocations").select("consumer_id")
        .where("entry_id", "=", input.entryId).orderBy("consumer_id").executeTakeFirst());
      if (pending) throw new OwnerRevocationPendingError({ entryId: input.entryId, consumerId: pending.consumer_id });
      const unreconciled = await this.kernel.run(db => db.selectFrom("owner_unreconciled").select("entry_id")
        .where("entry_id", "=", input.entryId).executeTakeFirst());
      if (unreconciled) throw new OwnerUnreconciledError(input);
      const entry = await this.repo.find({ workspaceId: OWNER_WORKSPACE_ID, id: input.entryId });
      if (!entry) return false;
      return this.vault.delete({ ...ownerContext(entry), id: entry.id, expectedRevision: input.expectedRevision });
    });
  }

  /** Clear an unreconciled mark once the copy is gone from every site the owner names; no record lists
   * them, so the owner must. Revoke grants first, because a granted copy is already tracked by its binding.
   * A failed cleanup is recorded as pending (which also blocks deletion) and the mark stays until a pass succeeds.
   * @throws VaultError "conflict" while the entry is still granted; the first target failure otherwise.
   * @complexity O(t) target lookups and deletes for t named sites.
   */
  async reconcile({ entryId, targets }: { entryId: string; targets: OwnerSyncTarget[] }, _options: VaultOptions = {}): Promise<void> {
    const failure = await this.kernel.transaction(async () => {
      const entry = await this.requireEntry({ entryId });
      const grant = await this.kernel.run(db => db.selectFrom("owner_grants").select("entry_id")
        .where("entry_id", "=", entryId).executeTakeFirst());
      if (grant) throw new VaultError({ code: "conflict" });
      let first: Extract<CleanupOutcome, { ok: false }> | undefined;
      for (const target of targets) {
        const outcome = await this.cleanTarget({ entry, target });
        if (!outcome.ok) first ??= outcome;
      }
      if (!first) await this.kernel.run(db => db.deleteFrom("owner_unreconciled").where("entry_id", "=", entryId).execute());
      return first;
    });
    if (failure) throw failure.error;
  }

  /** Delete this entry's copy from one consumer and settle its pending record either way.
   * A target in a different workspace than the recorded one is refused untouched: its empty
   * lookup would prove nothing about the workspace that actually holds the copy.
   */
  private async cleanTarget({ entry, target }: { entry: OwnerEntry; target: OwnerSyncTarget }): Promise<CleanupOutcome> {
    const key = { entry_id: entry.id, consumer_id: target.consumerId };
    const recorded = await this.kernel.run(db => db.selectFrom("owner_revocations").select("workspace_id")
      .where("entry_id", "=", key.entry_id).where("consumer_id", "=", key.consumer_id).executeTakeFirst());
    if (recorded && recorded.workspace_id !== target.workspaceId) return { ok: false, error: new VaultError({ code: "context" }) };
    try {
      const scope = { ...ownerContext(entry), workspaceId: target.workspaceId };
      // Metadata-only lookup: a copy the target can no longer decrypt must still be deleted.
      const copied = (await target.vault.list(scope)).find(summary => summary.id === entry.id);
      if (copied) await target.vault.delete({ ...scope, id: entry.id, expectedRevision: copied.revision });
    } catch (error) {
      // Committing revocation must not depend on another database's availability; the durable
      // pending row keeps the leftover copy tracked until a retry confirms it is gone.
      const updated_at = this.now({});
      await this.kernel.run(db => db.insertInto("owner_revocations").values({ ...key, workspace_id: target.workspaceId, attempts: 1, updated_at })
        .onConflict(conflict => conflict.columns(["entry_id", "consumer_id"])
          .doUpdateSet(eb => ({ attempts: eb("owner_revocations.attempts", "+", 1), updated_at }))).execute());
      return { ok: false, error };
    }
    await this.kernel.run(db => db.deleteFrom("owner_revocations").where("entry_id", "=", key.entry_id)
      .where("consumer_id", "=", key.consumer_id).execute());
    return { ok: true };
  }

  /** Resolve the fixed owner row; grants never infer ownership from caller-supplied context. */
  private async requireEntry({ entryId }: { entryId: string }) {
    const entry = await this.repo.find({ workspaceId: OWNER_WORKSPACE_ID, id: entryId });
    if (!entry || entry.principalId !== null || !isCopyableKind[entry.kind]) throw new VaultError({ code: "context" });
    return entry;
  }
}
