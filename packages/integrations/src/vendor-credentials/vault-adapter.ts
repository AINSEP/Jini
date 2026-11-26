import { VaultError, type VaultRepoPort, type VaultRecord, type VaultSummary, type VaultMeta, type VaultMetaParsers, type VaultContext, type VaultIdentity, type VaultQuery, type KeyringPort, type SecretSealerPort, type SealedSecret } from "@jini-ai/core/contracts/vault";
import type { SecretsVaultService } from "@jini-ai/core/contracts/site/secrets-credential-sets";
import type { CredentialTokenHint } from "@jini-ai/core/contracts/site/secrets-credential-token";
import type { CredentialVaultBinding, SourceControlCredentialSetRecord } from "@jini-ai/core/contracts/site/source-control-credentials";
import type { VendorCredentialProjectScope, VendorCredentialSetRecord, VendorCredentialSetRepoPort } from "@jini-ai/core/contracts/site/vendor-credentials";
import type { Clock } from "@jini-ai/core/primitives";

type CredentialSetRecord = SourceControlCredentialSetRecord | VendorCredentialSetRecord;
type Kind = "vendor" | "source-control";

export interface CredentialVaultServiceArgs {
  repo: VaultRepoPort; metaParsers: VaultMetaParsers;
  authorize: (required: { action: "put" | "get" | "list" | "rotate" | "delete"; context: VaultContext | VaultIdentity | VaultQuery }) => Promise<void>;
  keyring: Pick<KeyringPort, "activeKey">; sealer: SecretSealerPort;
  now: (required: Record<string, never>) => string; newId: (required: Record<string, never>) => string;
}

export interface CredentialVaultAdapterPolicy {
  ownerKey: string; acceptedKinds: readonly string[]; metaParsers: VaultMetaParsers;
  openService: (required: CredentialVaultServiceArgs, optional?: Record<string, never>) => SecretsVaultService;
}

export function toVendorCredentialRecord({ row, meta, provider, sealed }: {
  row: VaultRecord; meta: VaultMeta; provider: string; sealed: SealedSecret;
}, _optional: Record<string, never> = {}): VendorCredentialSetRecord {
  return { workspaceId: row.workspaceId, id: row.id, label: row.label, sealed,
    vendorId: provider, credentialType: "vendor", worksFor: meta.worksFor as string[], tokenTail: credentialHint({ record: row })?.last4 ?? "",
    isDefault: row.isDefault, accountLabel: (meta.accountLabel ?? null) as string | null, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function toSourceControlCredentialRecord({ row, meta, provider, sealed }: {
  row: VaultRecord; meta: VaultMeta; provider: string; sealed: SealedSecret;
}, _optional: Record<string, never> = {}): SourceControlCredentialSetRecord {
  return { workspaceId: row.workspaceId, id: row.id, label: row.label, sealed,
    providerId: provider, isDefault: row.isDefault, accountLabel: (meta.accountLabel ?? null) as string | null, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** the host's historical DTOs retain their fields; vault revisions and hints are adapter details. */
export class CredentialSetVaultAdapter<R extends CredentialSetRecord> {
  readonly vault: VaultRepoPort;
  /** the host's vault/scope/hint policy, carried by every repo the composition root builds (site and project halves
   *  alike). `open` takes the repo it opens explicitly, never `this`: a wrapper (the abort guard around a save)
   *  passes itself, so its guarded vault is the one written. */
  readonly credentialVault: CredentialVaultBinding;
  constructor({ vault, kind, policy, projectRecord }: {
    vault: VaultRepoPort; kind: Kind; policy: CredentialVaultAdapterPolicy;
    projectRecord: (required: { row: VaultRecord; meta: VaultMeta; provider: string; sealed: SealedSecret }) => R;
  }, _optional: Record<string, never> = {}) {
    this.vault = vault;
    this.kind = kind;
    this.policy = policy;
    this.projectRecord = projectRecord;
    this.credentialVault = createCredentialVaultBinding({ policy });
  }
  private readonly kind: Kind;
  private readonly policy: CredentialVaultAdapterPolicy;
  private readonly projectRecord: (required: { row: VaultRecord; meta: VaultMeta; provider: string; sealed: SealedSecret }) => R;
  private scope(input: { workspaceId: string; provider?: string }, _options = {}) {
    return { workspaceId: input.workspaceId, kind: this.kind, ownerKey: this.policy.ownerKey, principalId: null, binding: null,
      ...(input.provider === undefined ? {} : { provider: input.provider }) };
  }
  private owns({ row }: { row: VaultRecord }, _options = {}) {
    return row.kind === this.kind && row.ownerKey === this.policy.ownerKey && row.principalId === null && row.binding === null;
  }
  private record({ row }: { row: VaultRecord | null }, _options = {}): R | null {
    if (!row || !this.owns({ row })) return null;
    const meta = this.policy.metaParsers[this.kind]({ meta: row.meta, provider: row.provider });
    if (this.kind === "vendor" && meta.credentialType !== "vendor") return null;
    if (!row.sealed || row.provider === null) throw new VaultError({ code: "invalid-record" });
    // Keep the hint out of sealed-row DTO enumeration; public store summaries opt in explicitly.
    const record = this.projectRecord({ row, meta, provider: row.provider, sealed: row.sealed });
    Object.defineProperty(record, "tokenHint", { value: credentialHint({ record: row }), enumerable: false });
    return record;
  }
  async findById(input: { workspaceId: string; id: string }, _options = {}): Promise<R | null> {
    return this.record({ row: await this.vault.find(input) });
  }
  async findDefaultByProvider(input: { workspaceId: string; providerId: string }, _options = {}): Promise<R | null> {
    if (!this.vault.findDefault) throw new VaultError({ code: "invalid-record" });
    return this.record({ row: await this.vault.findDefault({ ...this.scope(input), provider: input.providerId }) });
  }
  async listByProvider(input: { workspaceId: string; providerId: string }, _options = {}): Promise<R[]> {
    return (await this.vault.list(this.scope({ ...input, provider: input.providerId }))).flatMap(row => { const record = this.record({ row }); return record ? [record] : []; });
  }
  async listByWorkspace(input: { workspaceId: string }, _options = {}): Promise<R[]> {
    return (await this.vault.list(this.scope(input))).flatMap(row => { const record = this.record({ row }); return record ? [record] : []; });
  }
  /** Compatibility for callers holding sealed DTOs; the Jini repo owns defaults and CAS. */
  async insert(record: R, _options = {}): Promise<void> { await this.write({ record, expectedRevision: null }); }
  async update(record: R, _options = {}): Promise<void> {
    const existing = await this.vault.find(record);
    if (!existing || !this.record({ row: existing })) return;
    await this.write({ record, expectedRevision: existing.revision, existing });
  }
  private writeMeta({ record, existing, provider }: { record: R; existing: VaultRecord | undefined; provider: string }, _options = {}) {
    return this.policy.metaParsers[this.kind]({ meta: {
      ...existing?.meta,
      ...(this.kind === "vendor" ? { credentialType: "vendor", worksFor:
        ("worksFor" in record ? record.worksFor : undefined) ?? existing?.meta.worksFor ?? [provider] } : {}),
      accountLabel: record.accountLabel,
    } });
  }
  private async write({ record, expectedRevision, existing }: { record: R; expectedRevision: number | null; existing?: VaultRecord }, _options = {}): Promise<void> {
    const provider = "vendorId" in record ? record.vendorId : record.providerId;
    const sameEnvelope = existing?.sealed?.ciphertext === record.sealed.ciphertext && existing.sealed.nonce === record.sealed.nonce;
    await this.vault.put({ expectedRevision, record: { ...this.scope(record), id: record.id,
      provider, label: record.label, sealed: record.sealed,
      meta: this.writeMeta({ record, existing, provider }),
      last4: sameEnvelope ? existing.last4 : null,
      tokenLength: sameEnvelope ? existing.tokenLength : null,
      isDefault: record.isDefault, revision: (expectedRevision ?? 0) + 1, createdAt: record.createdAt, updatedAt: record.updatedAt } });
  }
  async delete(input: { workspaceId: string; id: string }, _options = {}): Promise<void> {
    const row = await this.vault.find(input);
    if (row && this.record({ row })) await this.vault.delete({ ...input, expectedRevision: row.revision });
  }
  /** Preserve the old missing/stale-probe no-op and updatedAt semantics. Jini's targeted JSON
   * patch increments revision, so a rotation racing the probe cannot be overwritten. */
  async updateAccountLabel(input: { workspaceId: string; id: string; accountLabel: string; expectedSealed?: SealedSecret }, _options = {}): Promise<void> {
    const row = await this.vault.find(input);
    if (!row) return;
    const record = this.record({ row });
    if (!record) return;
    const expectedSealed = input.expectedSealed;
    if (expectedSealed && (["keyId", "ciphertext", "nonce", "alg"] as const).some(key =>
      record.sealed[key] !== expectedSealed[key])) return;
    const meta = this.policy.metaParsers[this.kind]({ meta: { ...row.meta, accountLabel: input.accountLabel }, provider: row.provider });
    try {
      if (meta.accountLabel == null) throw new VaultError({ code: "invalid-meta" });
      await this.vault.patchMeta({ ...input, expectedRevision: row.revision, patch: { accountLabel: meta.accountLabel }, updatedAt: row.updatedAt });
    } catch (error) {
      if (!(error instanceof VaultError && error.code === "conflict")) throw error;
      // A deleted/rotated row is a completed stale probe, never an instruction to recreate it.
    }
  }
}

export function createCredentialVaultBinding({ policy }: { policy: CredentialVaultAdapterPolicy }, _optional: Record<string, never> = {}): CredentialVaultBinding {
  const open: CredentialVaultBinding["open"] = (required: { repo: { vault?: VaultRepoPort }; sealer?: SecretSealerPort;
  keyring?: KeyringPort; clock?: Clock; idGen?: { newId(): string }; storageError: () => Error }, _options = {}): SecretsVaultService => {
  if (!required.repo.vault) throw new VaultError({ code: "invalid-record" });
  const protect = async <T>({ operation }: { operation: () => Promise<T> }, _optional = {}): Promise<T> => {
    try { return await operation(); } catch { throw required.storageError(); }
  };
  return policy.openService({ repo: required.repo.vault, metaParsers: policy.metaParsers,
    authorize: async ({ context }) => {
      if (!policy.acceptedKinds.includes(context.kind) || context.ownerKey !== policy.ownerKey || context.principalId !== null) throw new VaultError({ code: "context" });
    },
    keyring: { activeKey: (options: Parameters<KeyringPort["activeKey"]>[0]) => protect({ operation: () => {
      if (!required.keyring) throw required.storageError();
      return required.keyring.activeKey(options);
    } }) },
    sealer: { seal: input => protect({ operation: () => {
      if (!required.sealer) throw required.storageError();
      return required.sealer.seal({ plaintext: input.plaintext, key: input.key, aad: input.aad });
    } }), open: (input, options) => protect({ operation: () => {
      if (!required.sealer) throw required.storageError();
      return required.sealer.open(input, options);
    } }) },
    now: () => new Date(required.clock?.nowMs() ?? 0).toISOString(),
    newId: () => { if (!required.idGen) { throw new VaultError({ code: "invalid-record" }); } return required.idGen.newId(); },
  });
  };
  return { open, scope: required => credentialScope({ ...required, ownerKey: policy.ownerKey }), hint: credentialHint };
}

export function credentialScope({ workspaceId, kind, ownerKey, id }: { workspaceId: string; kind: Kind | "custom"; ownerKey: string; id?: string }, _optional: Record<string, never> = {}): VaultContext & { id?: string } {
  return { workspaceId, kind, ownerKey, principalId: null, binding: null, ...(id === undefined ? {} : { id }) };
}
/** Safe read-model hints require no open and never hydrate summaries one credential at a time. */
export function credentialHint({ record }: { record: Pick<VaultSummary, "tokenLength" | "last4"> }, _optional: Record<string, never> = {}): CredentialTokenHint | null {
  return record.tokenLength === null ? null : { length: record.tokenLength, last4: record.tokenLength >= 12 ? record.last4 : null };
}

/** Vendor DTO mapping; default selection/promotion and persistence belong to Jini's vault. */
export class VendorCredentialSetVaultRepo extends CredentialSetVaultAdapter<VendorCredentialSetRecord> implements VendorCredentialSetRepoPort {
  readonly project?: VendorCredentialProjectScope;
  /** @param optional.project The project store this site's rows fall back to (`types.ts`). */
  constructor(required: { vault: VaultRepoPort; policy: CredentialVaultAdapterPolicy }, optional: { project?: VendorCredentialProjectScope } = {}) {
    super({ ...required, kind: "vendor", projectRecord: toVendorCredentialRecord });
    if (optional.project) this.project = optional.project;
  }
  async findDefaultByVendor(input: { workspaceId: string; vendorId: string }, _options = {}) {
    return this.findDefaultByProvider({ workspaceId: input.workspaceId, providerId: input.vendorId });
  }
  async listByVendor(input: { workspaceId: string; vendorId: string }, _options = {}) {
    return this.listByProvider({ workspaceId: input.workspaceId, providerId: input.vendorId });
  }
}
