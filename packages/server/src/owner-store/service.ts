import { SecretsVaultService, isCopyableKind, type VaultPutInput, type VaultServiceDeps } from "@jini-ai/platform/secrets/credential-sets";
import { VaultError, type VaultContext, type VaultCopyResult, type VaultOptions, type VaultSummary } from "@jini-ai/platform/secrets/credential-sets/contracts";
import type { StorageKernel } from "@jini-ai/db/kernel";
import { SqlSecretsVaultRepo, type SecretsVaultDatabase } from "@jini-ai/db/secrets-vault";

export const OWNER_WORKSPACE_ID = "owner";
export interface OwnerGrant { entry_id: string; consumer_id: string; created_at: string }
export interface OwnerStoreDatabase extends SecretsVaultDatabase { owner_grants: OwnerGrant }
export interface OwnerSyncTarget {
  consumerId: string;
  workspaceId: string;
  vault: SecretsVaultService;
}
export type OwnerPutInput = Omit<VaultPutInput, "workspaceId" | "principalId">;

/** Fixed owner scope still preserves feature ownership, which the copy contract authenticates. */
export function ownerContext(input: Pick<VaultContext, "kind" | "ownerKey" | "binding">, _options: VaultOptions = {}): VaultContext {
  return { kind: input.kind, ownerKey: input.ownerKey, binding: input.binding,
    workspaceId: OWNER_WORKSPACE_ID, principalId: null };
}

/** Composes the existing vault lifecycle and a consumer grant ledger, never another sealer.
 * Cross-database copies are individually reported by the vault; callers retry failed rows.
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

  /** Validate existence before granting. Idempotent under the same database writer lock. */
  async grant(input: { entryId: string; consumerId: string }, _options: VaultOptions = {}): Promise<void> {
    if (!input.consumerId) throw new VaultError({ code: "context" });
    await this.kernel.transaction(async () => {
      await this.requireEntry(input);
      await this.kernel.run(db => db.insertInto("owner_grants").values({ entry_id: input.entryId,
        consumer_id: input.consumerId, created_at: this.now({}) })
        .onConflict(conflict => conflict.columns(["entry_id", "consumer_id"]).doNothing()).execute());
    });
  }

  /** Return only grant metadata, ordered for stable command output. */
  grants(_input: VaultOptions, _options: VaultOptions = {}): Promise<OwnerGrant[]> {
    return this.kernel.run(db => db.selectFrom("owner_grants").selectAll().orderBy("consumer_id").orderBy("entry_id").execute());
  }

  /** Source lock orders sync against replacement/revoke; copies keep their immutable entry IDs.
   * @complexity O(n + payload bytes) for this consumer's n granted entries.
   */
  async syncTo({ target }: { target: OwnerSyncTarget }, _options: VaultOptions = {}): Promise<VaultCopyResult[]> {
    return this.kernel.transaction(async () => {
      const grants = await this.kernel.run(db => db.selectFrom("owner_grants").select("entry_id")
        .where("consumer_id", "=", target.consumerId).orderBy("entry_id").execute());
      const results: VaultCopyResult[] = [];
      for (const grant of grants) {
        const entry = await this.requireEntry({ entryId: grant.entry_id });
        results.push(...await target.vault.copyToSite({ source: this.vault, sourceContext: ownerContext(entry),
          targetContext: { ...ownerContext(entry), workspaceId: target.workspaceId }, ids: [entry.id], overwrite: true }));
      }
      return results;
    });
  }

  /** Revoke centrally even if target cleanup fails. Retrying removes the same copied ID.
   * The source lock prevents an in-flight sync from republishing after cleanup.
   * @throws Target vault failures after the central revocation has committed.
   */
  async revoke({ entryId, target }: { entryId: string; target: OwnerSyncTarget }, _options: VaultOptions = {}): Promise<void> {
    const outcome = await this.kernel.transaction(async () => {
      const entry = await this.requireEntry({ entryId });
      await this.kernel.run(db => db.deleteFrom("owner_grants").where("entry_id", "=", entryId)
        .where("consumer_id", "=", target.consumerId).execute());
      try {
        const scope = { ...ownerContext(entry), workspaceId: target.workspaceId };
        // Metadata-only lookup: a copy the target can no longer decrypt must still be deleted.
        const copied = (await target.vault.list(scope)).find(summary => summary.id === entryId);
        if (copied) await target.vault.delete({ ...scope, id: entryId, expectedRevision: copied.revision });
        return { ok: true as const };
      } catch (error) {
        // Committing revocation must not depend on another database's availability.
        return { ok: false as const, error };
      }
    });
    if (!outcome.ok) throw outcome.error;
  }

  /** Require explicit revocation before deletion so copied values cannot become untracked. */
  async delete(input: { entryId: string; expectedRevision: number }, _options: VaultOptions = {}): Promise<boolean> {
    return this.kernel.transaction(async () => {
      const grant = await this.kernel.run(db => db.selectFrom("owner_grants").select("entry_id")
        .where("entry_id", "=", input.entryId).executeTakeFirst());
      if (grant) throw new VaultError({ code: "conflict" });
      const entry = await this.repo.find({ workspaceId: OWNER_WORKSPACE_ID, id: input.entryId });
      if (!entry) return false;
      return this.vault.delete({ ...ownerContext(entry), id: entry.id, expectedRevision: input.expectedRevision });
    });
  }

  /** Resolve the fixed owner row; grants never infer ownership from caller-supplied context. */
  private async requireEntry({ entryId }: { entryId: string }) {
    const entry = await this.repo.find({ workspaceId: OWNER_WORKSPACE_ID, id: entryId });
    if (!entry || entry.principalId !== null || !isCopyableKind[entry.kind]) throw new VaultError({ code: "context" });
    return entry;
  }
}
