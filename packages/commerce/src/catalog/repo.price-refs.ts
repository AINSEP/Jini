/** Price mappings borrow the host schema and use its five-part primary key for atomic upserts. */
import type { StorageKernel } from "@jini-ai/db/kernel";
import type { CommerceKernel } from "./database.js";
import type { CommercePriceProviderRefRepoPort } from "./ports.js";

/**
 * @param required.kernel - Host storage kernel; no schema preparation or connection is owned here.
 * @returns A price-reference repository; database errors propagate to the host.
 * @complexity One indexed lookup/upsert per call, O(log n) database work and O(1) application space.
 * @example const priceRefs = commercePriceProviderRefRepoFor({ kernel });
 */
export function commercePriceProviderRefRepoFor<DB>({ kernel }: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): CommercePriceProviderRefRepoPort {
  const storage = kernel as unknown as CommerceKernel;
  return {
    find: async (required, _optional = {}) => {
      const row = await storage.run(db => db.selectFrom("commerce_price_provider_refs").select("provider_price_ref")
        .where("workspace_id", "=", required.workspaceId).where("price_id", "=", required.priceId)
        .where("provider_id", "=", required.providerId).where("provider_account_id", "=", required.providerAccountId)
        .where("mode", "=", required.mode).executeTakeFirst());
      return row?.provider_price_ref ?? null;
    },
    save: async (record, _optional = {}) => {
      const row = { workspace_id: record.workspaceId, price_id: record.priceId, provider_id: record.providerId,
        provider_account_id: record.providerAccountId, mode: record.mode, provider_price_ref: record.providerPriceRef, created_at: record.createdAt };
      await storage.run(db => db.insertInto("commerce_price_provider_refs").values(row)
        .onConflict(oc => oc.columns(["workspace_id", "price_id", "provider_id", "provider_account_id", "mode"]).doUpdateSet(row)).execute());
    },
  };
}
