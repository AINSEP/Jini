import { assertVaultReplacement, vaultGroupKey, VaultError, type VaultBatchOp, type VaultBatchResult, type VaultDefaultQuery, type VaultSingletonQuery, type VaultMeta, type VaultOptions, type VaultQuery, type VaultRecord, type VaultRepoPort } from "./vault.types.js";

/** Single-turn mutations are atomic in JS; clones prevent callers bypassing CAS through aliases. */
export class InMemoryVaultRepo implements VaultRepoPort {
  private rows = new Map<string, VaultRecord>();
  private singletons = new Map<string, Set<string>>();
  constructor(_required: VaultOptions, _options: VaultOptions = {}) {}
  private key(input: { workspaceId: string; id: string }): string { return JSON.stringify([input.workspaceId, input.id]); }

  async find(input: { workspaceId: string; id: string }, _options: VaultOptions = {}): Promise<VaultRecord | null> {
    return structuredClone(this.rows.get(this.key(input)) ?? null);
  }
  private singletonKey(input: VaultSingletonQuery): string {
    return JSON.stringify([input.workspaceId, input.kind, input.ownerKey !== undefined, input.ownerKey ?? null,
      input.principalId !== undefined, input.principalId ?? null]);
  }
  /** Index all four optional scope combinations; copy sets so batch staging never mutates live indexes. */
  private indexSingleton({ record, remove }: { record: VaultRecord; remove: boolean }, _options: VaultOptions = {}): void {
    for (const ownerKey of [undefined, record.ownerKey]) for (const principalId of [undefined, record.principalId]) {
      const scope = this.singletonKey({ workspaceId: record.workspaceId, kind: record.kind, ownerKey, principalId });
      const ids = new Set(this.singletons.get(scope));
      if (remove) ids.delete(this.key(record));
      else ids.add(this.key(record));
      if (ids.size) this.singletons.set(scope, ids);
      else this.singletons.delete(scope);
    }
  }
  /** Indexed singleton selection; clone only the selected row, ignoring provider/default. */
  async findOne(input: VaultSingletonQuery, _options: VaultOptions = {}): Promise<VaultRecord | null> {
    const id = this.singletons.get(this.singletonKey(input))?.values().next().value;
    return structuredClone(id === undefined ? null : this.rows.get(id)!);
  }
  /** Stage through the same mutation owner, then publish once. No await can expose partial rows
   * or let a concurrent writer be lost between snapshot and swap. O(n + ops*n) fixture work.
   */
  async applyBatch({ ops }: { ops: readonly VaultBatchOp[] }, _options: VaultOptions = {}): Promise<VaultBatchResult[]> {
    const staged = new InMemoryVaultRepo({});
    staged.rows = new Map(this.rows);
    staged.singletons = new Map(this.singletons);
    const results = ops.map(op => {
      if ("put" in op) return staged.putRecord(op.put);
      if ("delete" in op) return staged.deleteRecord(op.delete);
      return staged.patchRecord(op.patchMeta);
    });
    this.rows = staged.rows;
    this.singletons = staged.singletons;
    return results;
  }
  /** O(n) memory scan, n stored rows; clones only the default, never its siblings. */
  async findDefault(input: VaultDefaultQuery, _options: VaultOptions = {}): Promise<VaultRecord | null> {
    for (const row of this.rows.values()) {
      if (row.isDefault && row.workspaceId === input.workspaceId && row.kind === input.kind && row.ownerKey === input.ownerKey &&
        row.principalId === input.principalId && row.provider === input.provider) return structuredClone(row);
    }
    return null;
  }
  async list(input: VaultQuery, _options: VaultOptions = {}): Promise<VaultRecord[]> {
    return structuredClone([...this.rows.values()].filter(row => row.workspaceId === input.workspaceId && row.kind === input.kind &&
      row.ownerKey === input.ownerKey && row.principalId === input.principalId && (input.provider === undefined || row.provider === input.provider))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  async put(input: { record: VaultRecord; expectedRevision: number | null }, _options: VaultOptions = {}): Promise<VaultRecord> {
    return this.putRecord(input);
  }
  /** Synchronous mutation owner shared with batch staging; default moves never re-seal. */
  private putRecord(input: { record: VaultRecord; expectedRevision: number | null }, _options: VaultOptions = {}): VaultRecord {
    const { record } = input;
    const key = this.key(record);
    const existing = this.rows.get(key) ?? null;
    assertVaultReplacement({ ...input, existing });
    const groupKey = vaultGroupKey({ record });
    let hasGroup = false;
    for (const row of this.rows.values()) if (vaultGroupKey({ record: row }) === groupKey) {
      hasGroup = true;
      if (row.id !== record.id && row.label === record.label) throw new VaultError({ code: "conflict" });
    }
    const saved = structuredClone({ ...record, isDefault: record.isDefault || !hasGroup });
    // Clear first, matching a SQL partial UNIQUE index; no transient duplicate default is required.
    if (saved.isDefault) for (const row of this.rows.values()) {
      if (row.id !== saved.id && row.isDefault && vaultGroupKey({ record: row }) === groupKey) {
        this.rows.set(this.key(row), { ...row, isDefault: false, revision: row.revision + 1 });
      }
    }
    this.rows.set(key, saved);
    if (!existing) this.indexSingleton({ record: saved, remove: false });
    if (existing?.isDefault && vaultGroupKey({ record: existing }) !== groupKey) this.promote({ record: existing });
    return structuredClone(saved);
  }
  async patchMeta(input: { workspaceId: string; id: string; expectedRevision: number; patch: VaultMeta; updatedAt: string }, _options: VaultOptions = {}): Promise<VaultRecord> {
    return this.patchRecord(input);
  }
  /** Clone merged metadata before mutating the staged/live map so failures leave it intact. */
  private patchRecord(input: { workspaceId: string; id: string; expectedRevision: number; patch: VaultMeta; updatedAt: string }, _options: VaultOptions = {}): VaultRecord {
    const key = this.key(input);
    const existing = this.rows.get(key);
    if (existing?.revision !== input.expectedRevision) throw new VaultError({ code: "conflict" });
    const saved = { ...existing, meta: structuredClone({ ...existing.meta, ...input.patch }), updatedAt: input.updatedAt, revision: existing.revision + 1 };
    this.rows.set(key, saved);
    return structuredClone(saved);
  }
  async delete(input: { workspaceId: string; id: string; expectedRevision: number }, _options: VaultOptions = {}): Promise<boolean> {
    return this.deleteRecord(input);
  }
  /** Synchronous CAS delete shares promotion with provider moves and batch staging. */
  private deleteRecord(input: { workspaceId: string; id: string; expectedRevision: number }, _options: VaultOptions = {}): boolean {
    const key = this.key(input);
    const existing = this.rows.get(key);
    if (!existing) return false;
    if (existing.revision !== input.expectedRevision) throw new VaultError({ code: "conflict" });
    this.rows.delete(key);
    this.indexSingleton({ record: existing, remove: true });
    if (existing.isDefault) this.promote({ record: existing });
    return true;
  }
  /** O(n) winner scan; promotion changes only default/revision, matching SQL. */
  private promote({ record }: { record: VaultRecord }, _options: VaultOptions = {}): void {
    const groupKey = vaultGroupKey({ record });
    let promoted: Pick<VaultRecord, "id" | "updatedAt"> | undefined;
    // SQL BINARY/C compares UTF-8 bytes; JS's UTF-16 order differs for supplementary IDs.
    for (const row of this.rows.values()) {
      if (vaultGroupKey({ record: row }) === groupKey && (!promoted || row.updatedAt > promoted.updatedAt ||
        (row.updatedAt === promoted.updatedAt && Buffer.compare(Buffer.from(row.id), Buffer.from(promoted.id)) > 0))) {
        promoted = { id: row.id, updatedAt: row.updatedAt };
      }
    }
    if (promoted) {
      const promotedKey = this.key({ workspaceId: record.workspaceId, id: promoted.id });
      const row = this.rows.get(promotedKey)!;
      this.rows.set(promotedKey, { ...row, isDefault: true, revision: row.revision + 1 });
    }
  }
}
