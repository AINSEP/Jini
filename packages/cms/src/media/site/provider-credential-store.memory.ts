import type { VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { IdGenerator } from "@jini-ai/core/primitives";
import { MediaProviderCredentialVaultRepo, type MediaCredentialVaultPolicy } from "./provider-credential-vault.js";

/** Jini stages/publishes batches once, so failed planners cannot expose a half-replaced map. */
export class InMemoryMediaProviderCredentialRepo extends MediaProviderCredentialVaultRepo {
  private readonly providerWrites: { acquire(kind: "exclusive"): Promise<void>; release(kind: "exclusive"): void };
  constructor({ vault, policy, providerWrites, idGen }: {
    vault: VaultRepoPort; policy: MediaCredentialVaultPolicy; idGen: IdGenerator;
    providerWrites: { acquire(kind: "exclusive"): Promise<void>; release(kind: "exclusive"): void };
  }, _optional = {}) { super({ vault, policy, idGen }); this.providerWrites = providerWrites; }

  /** Serialize the host's read/plan/batch with primitive writes, as the SQL writer lock does.
   * Without this, a new provider inserted after the snapshot could evade whole-map tombstones.
   * Jini still owns staged storage and publication; this lock carries no rows or envelopes.
   */
  private async providerWrite<T>({ run }: { run: () => Promise<T> }, _options = {}): Promise<T> {
    await this.providerWrites.acquire("exclusive");
    try { return await run(); } finally { this.providerWrites.release("exclusive"); }
  }
  override upsert(record: Parameters<MediaProviderCredentialVaultRepo["upsert"]>[0]): Promise<void> {
    return this.providerWrite({ run: () => super.upsert(record) });
  }
  override replaceWorkspace(input: Parameters<MediaProviderCredentialVaultRepo["replaceWorkspace"]>[0]) {
    return this.providerWrite({ run: () => super.replaceWorkspace(input) });
  }
}
