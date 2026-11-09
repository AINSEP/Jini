import type { CredentialSetProjectScope, CredentialSetRecord, CredentialSetRepoPort } from "@jini-ai/core/contracts/credentials";
import type { VaultPutRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { CredentialSetRowByLabel, CredentialSetVaultPolicy } from "./host.js";

/**
 * @file Credential-set repository over a host-supplied vault. Owner, metadata parser, label order
 * and canonical errors are required host inputs (`CredentialSetVaultPolicy`); nothing here names a
 * product owner. Rows keep their stored kind, so legacy envelopes keep authenticating.
 * Provenance: moved unchanged (EXTRACT-S8 C1 move) from the first host's credential-set seam file
 * `sets/vault-repo.ts` at its commit 43a0e5d4; earlier history lives in that host's repository.
 */

/** @agent-note Exact expected vault context for a credential-set row: the trusted host owner, null
 *  principal and binding. `kind` defaults to the unified `vendor` kind; pass `custom` only for a
 *  legacy row being read or rewritten under its own stored kind. */
export function credentialSetVaultScope({ workspaceId, id, kind = "vendor", ownerKey }: { workspaceId: string; id?: string; kind?: "vendor" | "custom"; ownerKey: string }, _options = {}) {
  return { workspaceId, kind, ownerKey, principalId: null, binding: null,
    ...(id === undefined ? {} : { id }) };
}

function isCustomCredentialRow({ row }: { row: VaultPutRecord }, _options = {}): boolean {
  return row.kind === "custom" || (row.kind === "vendor" && row.meta.credentialType === "custom");
}

/**
 * @agent-note Converts one vault row into a credential-set record, rejecting any row outside the
 * trusted ownership with the canonical `context` error and a row without an envelope with
 * `invalid-record`. Username belongs exclusively to metadata after normalization; no sealed fallback
 * can resurrect an explicit clear. The private envelope/revision are attached non-enumerable and
 * never become a public summary field.
 */
export function credentialSetVaultRecord<C extends string>({ row, expectedRevision, policy }: { row: VaultPutRecord; expectedRevision?: number | null; policy: CredentialSetVaultPolicy }, _options = {}): CredentialSetRecord<C> {
  const wrongOwner = !isCustomCredentialRow({ row }) || row.ownerKey !== policy.ownerKey;
  if (wrongOwner || row.principalId !== null || row.binding !== null || row.provider !== null) {
    throw policy.vaultErrors.create({ code: "context" });
  }
  const meta = policy.parseMeta({ kind: row.kind as "vendor" | "custom", meta: row.meta, provider: row.provider });
  if (!row.sealed) throw policy.vaultErrors.create({ code: "invalid-record" });
  const record: CredentialSetRecord<C> = { workspaceId: row.workspaceId, id: row.id, label: row.label,
    category: meta.category as C, baseUrl: meta.baseUrl as string,
    worksFor: meta.worksFor as string[], additionalHosts: meta.additionalHosts as string[], ...(meta.username == null ? {} : { username: meta.username as string }),
    sealed: row.sealed, createdAt: row.createdAt, updatedAt: row.updatedAt };
  Object.defineProperty(record, "vaultRecord", { value: { ...row, meta } });
  if (expectedRevision !== undefined) Object.defineProperty(record, "vaultExpectedRevision", { value: expectedRevision });
  return record;
}

/**
 * @agent-note Fixed owner/provider scope keeps labels unique across the workspace in both adapters.
 * Every write is one CAS `put`/`delete` on the SAME `vault` passed in (`repo.vault === vault`); no
 * write path opens a sealed envelope. `findRowByLabel`, when supplied, must be the vault's own
 * indexed, authorization-preserving lookup.
 */
export class CredentialSetVaultRepo<C extends string = string> implements CredentialSetRepoPort<C> {
  readonly vault: VaultRepoPort;
  readonly project?: CredentialSetProjectScope<C>;
  readonly findByLabel?: (input: { workspaceId: string; label: string }) => Promise<CredentialSetRecord<C> | null>;
  /** Host policy, stored non-enumerable (not a `#private` field) so prototype-derived wrappers
   *  (`Object.create(repo)`) keep working exactly as with the historical class. */
  declare private readonly policy: CredentialSetVaultPolicy;
  /** @param optional.project The project store this site's rows fall back to. */
  constructor({ vault, policy }: { vault: VaultRepoPort; policy: CredentialSetVaultPolicy }, optional: { project?: CredentialSetProjectScope<C>; findRowByLabel?: CredentialSetRowByLabel } = {}) {
    this.vault = vault;
    Object.defineProperty(this, "policy", { value: policy });
    const findRowByLabel = optional.findRowByLabel;
    if (findRowByLabel) this.findByLabel = async input => {
      const row = await findRowByLabel(input);
      return row && isCustomCredentialRow({ row }) ? credentialSetVaultRecord<C>({ row, policy }) : null;
    };
    if (optional.project) this.project = optional.project;
  }
  async findById(input: { workspaceId: string; id: string }): Promise<CredentialSetRecord<C> | null> {
    const row = await this.vault.find(input);
    if (!row || !isCustomCredentialRow({ row })) return null;
    return credentialSetVaultRecord<C>({ row, policy: this.policy });
  }
  async listByWorkspace(input: { workspaceId: string }): Promise<CredentialSetRecord<C>[]> {
    const ownerKey = this.policy.ownerKey;
    // Label order, as before the vault (the label index drove the scan); the vault lists by id.
    const unified = await this.vault.list(credentialSetVaultScope({ ...input, ownerKey }));
    // This is a read bridge, not a kind rewrite: the stored kind still authenticates old envelopes.
    const legacy = await this.vault.list(credentialSetVaultScope({ ...input, kind: "custom", ownerKey }));
    return [...unified.filter(row => row.meta.credentialType === "custom"), ...legacy].sort((a, b) => this.policy.compareLabels(a, b))
      .map(row => credentialSetVaultRecord<C>({ row, policy: this.policy }));
  }
  async insert(record: CredentialSetRecord<C>): Promise<void> { await this.write({ record, expectedRevision: null }); }
  async update(record: CredentialSetRecord<C>): Promise<void> {
    if (record.vaultExpectedRevision !== undefined) {
      await this.write({ record, expectedRevision: record.vaultExpectedRevision });
      return;
    }
    const existing = await this.findById(record);
    if (!existing) return;
    await this.write({ record, expectedRevision: existing.vaultRecord!.revision,
      existing: existing.vaultRecord! });
  }
  /** Prepared records carry the caller's CAS; sealed DTO compatibility preserves hints only when
   * the envelope is unchanged. Label conflicts keep the host's historical raw UNIQUE error contract.
   */
  private async write({ record, expectedRevision, existing }: CompatibilityWrite<C>, _options = {}): Promise<void> {
    const policy = this.policy;
    const prepared = preparedVaultRow({ record, policy });
    const row = prepared ?? compatibilityVaultRow({ record, expectedRevision, policy, ...(existing ? { existing } : {}) });
    try { await this.vault.put({ record: row, expectedRevision }); }
    catch (error) {
      if (policy.vaultErrors.codeOf(error) === "conflict" && (await this.listByWorkspace(record)).some(other => other.id !== record.id && other.label === record.label)) {
        throw policy.labelConflict({});
      }
      throw error;
    }
  }
  async delete(input: { workspaceId: string; id: string }): Promise<void> {
    const row = await this.findById(input);
    if (row) await this.vault.delete({ ...input, expectedRevision: row.vaultRecord!.revision });
  }
}

type CompatibilityWrite<C extends string> = { record: CredentialSetRecord<C>; expectedRevision: number | null; existing?: VaultPutRecord };

function compatibilityVaultRow<C extends string>({ record, expectedRevision, existing, policy }: CompatibilityWrite<C> & { policy: CredentialSetVaultPolicy }, _options = {}): VaultPutRecord {
  const kind = existing?.kind === "custom" ? "custom" : "vendor";
  return { ...credentialSetVaultScope({ ...record, kind, ownerKey: policy.ownerKey }), id: record.id, provider: null, label: record.label,
    sealed: record.sealed, isDefault: existing?.isDefault ?? false, revision: (expectedRevision ?? 0) + 1,
    ...compatibilityTokenHints({ record, ...(existing ? { existing } : {}) }),
    meta: compatibilityVaultMeta({ record, kind, policy, ...(existing ? { existing } : {}) }),
    createdAt: existing?.createdAt ?? record.createdAt, updatedAt: record.updatedAt };
}

function compatibilityVaultMeta<C extends string>({ record, existing, kind, policy }: Pick<CompatibilityWrite<C>, "record" | "existing"> & { kind: "vendor" | "custom"; policy: CredentialSetVaultPolicy }, _options = {}) {
  return policy.parseMeta({ kind, meta: { ...existing?.meta, credentialType: "custom",
    worksFor: [...(record.worksFor ?? existing?.meta.worksFor as string[] ?? [])],
    category: record.category, baseUrl: record.baseUrl,
    additionalHosts: [...record.additionalHosts], username: record.username ?? null } });
}

function compatibilityTokenHints<C extends string>({ record, existing }: Pick<CompatibilityWrite<C>, "record" | "existing">, _options = {}): Pick<VaultPutRecord, "last4" | "tokenLength"> {
  const sealed = existing?.sealed;
  let unchanged = false;
  if (sealed != null) {
    const sameContent = sealed.keyId === record.sealed.keyId && sealed.ciphertext === record.sealed.ciphertext;
    unchanged = sameContent && sealed.nonce === record.sealed.nonce && sealed.alg === record.sealed.alg;
  }
  return { last4: unchanged ? existing!.last4 : null, tokenLength: unchanged ? existing!.tokenLength : null };
}

function preparedVaultRow<C extends string>({ record, policy }: { record: CredentialSetRecord<C>; policy: CredentialSetVaultPolicy }, _options = {}): VaultPutRecord | undefined {
  const prepared = record.vaultExpectedRevision === undefined ? undefined : record.vaultRecord;
  if (prepared) {
    credentialSetVaultRecord({ row: prepared, policy });
    if (prepared.workspaceId !== record.workspaceId || prepared.id !== record.id) throw policy.vaultErrors.create({ code: "context" });
  }
  return prepared;
}
