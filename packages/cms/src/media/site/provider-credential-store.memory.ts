import type { VaultRepoPort } from "@jini-ai/core/contracts/vault";
import { MediaProviderCredentialVaultRepo, type MediaCredentialVaultPolicy } from "./provider-credential-vault.js";

/** Jini stages/publishes batches once, so failed planners cannot expose a half-replaced map. */
export class InMemoryMediaProviderCredentialRepo extends MediaProviderCredentialVaultRepo {
  private readonly withWrite: <T>(required: { run: () => Promise<T> }, optional?: Record<string, never>) => Promise<T>;
  constructor({ vault, policy, withWrite }: {
    vault: VaultRepoPort; policy: MediaCredentialVaultPolicy;
    withWrite<T>(required: { run: () => Promise<T> }, optional?: Record<string, never>): Promise<T>;
  }, _optional = {}) { super({ vault, policy }); this.withWrite = withWrite; }

  /** Serialize the host's read/plan/batch with primitive writes, as the SQL writer lock does.
   * Without this, a new provider inserted after the snapshot could evade whole-map tombstones.
   * Jini still owns staged storage and publication; this lock carries no rows or envelopes.
   */
  override upsert(record: Parameters<MediaProviderCredentialVaultRepo["upsert"]>[0]): Promise<void> {
    return this.withWrite({ run: () => super.upsert(record) });
  }
  override replaceWorkspace(input: Parameters<MediaProviderCredentialVaultRepo["replaceWorkspace"]>[0]) {
    return this.withWrite({ run: () => super.replaceWorkspace(input) });
  }
}
