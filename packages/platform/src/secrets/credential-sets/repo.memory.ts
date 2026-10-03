import type { VendorCredentialSetRecord, VendorCredentialSetRepoPort } from "./types.js";

/** In-memory repository preserving label uniqueness and group default promotion. */
export class InMemoryVendorCredentialSetRepo implements VendorCredentialSetRepoPort {
  constructor(_required: Record<string, never>) {}
  private readonly rows = new Map<string, VendorCredentialSetRecord>();

  private static rowKey(workspaceId: string, id: string): string {
    return `${workspaceId}::${id}`;
  }

  private assertLabelAvailable(workspaceId: string, vendorId: string, label: string, excludingId?: string): void {
    for (const row of this.rows.values()) {
      if (row.workspaceId !== workspaceId || row.vendorId !== vendorId || row.label !== label) continue;
      if (excludingId !== undefined && row.id === excludingId) continue;
      throw new Error(`UNIQUE constraint failed: vendor_credential_sets.workspace_id, vendor_credential_sets.vendor_id, vendor_credential_sets.label`);
    }
  }

  private clearOtherDefaults(workspaceId: string, vendorId: string, keepId: string): void {
    for (const [key, row] of this.rows) {
      if (row.workspaceId !== workspaceId || row.vendorId !== vendorId || row.id === keepId || !row.isDefault) continue;
      this.rows.set(key, { ...row, isDefault: false });
    }
  }

  async insert(record: VendorCredentialSetRecord): Promise<void> {
    this.assertLabelAvailable(record.workspaceId, record.vendorId, record.label);
    this.rows.set(InMemoryVendorCredentialSetRepo.rowKey(record.workspaceId, record.id), { ...record });
    if (record.isDefault) this.clearOtherDefaults(record.workspaceId, record.vendorId, record.id);
  }

  async update(record: VendorCredentialSetRecord): Promise<void> {
    this.assertLabelAvailable(record.workspaceId, record.vendorId, record.label, record.id);
    this.rows.set(InMemoryVendorCredentialSetRepo.rowKey(record.workspaceId, record.id), { ...record });
    if (record.isDefault) this.clearOtherDefaults(record.workspaceId, record.vendorId, record.id);
  }

  async findById(input: { workspaceId: string; id: string }): Promise<VendorCredentialSetRecord | null> {
    return this.rows.get(InMemoryVendorCredentialSetRepo.rowKey(input.workspaceId, input.id)) ?? null;
  }

  async findDefaultByVendor(input: { workspaceId: string; vendorId: string }): Promise<VendorCredentialSetRecord | null> {
    for (const row of this.rows.values()) {
      if (row.workspaceId === input.workspaceId && row.vendorId === input.vendorId && row.isDefault) return row;
    }
    return null;
  }

  async listByVendor(input: { workspaceId: string; vendorId: string }): Promise<VendorCredentialSetRecord[]> {
    return [...this.rows.values()].filter((row) => row.workspaceId === input.workspaceId && row.vendorId === input.vendorId);
  }

  async listByWorkspace(input: { workspaceId: string }): Promise<VendorCredentialSetRecord[]> {
    return [...this.rows.values()].filter((row) => row.workspaceId === input.workspaceId);
  }

  async delete(input: { workspaceId: string; id: string }): Promise<void> {
    const key = InMemoryVendorCredentialSetRepo.rowKey(input.workspaceId, input.id);
    const removed = this.rows.get(key);
    this.rows.delete(key);
    if (!removed?.isDefault) return;

    const remaining = [...this.rows.values()].filter((row) => row.workspaceId === removed.workspaceId && row.vendorId === removed.vendorId);
    if (remaining.length === 0) return;
    const promoted = remaining.reduce((latest, row) => (row.updatedAt > latest.updatedAt ? row : latest));
    this.rows.set(InMemoryVendorCredentialSetRepo.rowKey(promoted.workspaceId, promoted.id), { ...promoted, isDefault: true });
  }

  async updateAccountLabel(input: { workspaceId: string; id: string; accountLabel: string }): Promise<void> {
    const key = InMemoryVendorCredentialSetRepo.rowKey(input.workspaceId, input.id);
    const existing = this.rows.get(key);
    if (!existing) return;
    this.rows.set(key, { ...existing, accountLabel: input.accountLabel });
  }
}
