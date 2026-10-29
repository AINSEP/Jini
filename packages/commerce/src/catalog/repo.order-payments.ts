/** Atomic reservation and binding guards keep concurrent dispatches pinned to one scope. */
import type { StorageKernel } from "@jini-ai/db/kernel";
import { sameScope } from "../payments/contract/scope.js";
import { decodeMinor, encodeMinor } from "../payments/ledger/rows.js";
import type { CommerceKernel } from "./database.js";
import type { BindOrderPaymentResult, CommerceOrderPaymentRepoPort, ReserveOrderPaymentResult } from "./ports.js";

/**
 * @param required.kernel - Borrowed host kernel, with the association schema already migrated.
 * @returns A repository whose storage errors propagate; reserve/bind never overwrite ownership.
 * @complexity O(log n) indexed database work per call, at most two statements; O(1) application space.
 * @example const orderPayments = commerceOrderPaymentRepoFor({ kernel });
 */
export function commerceOrderPaymentRepoFor<DB>({ kernel }: { kernel: StorageKernel<DB> }, _optional: Record<string, never> = {}): CommerceOrderPaymentRepoPort {
  const storage = kernel as unknown as CommerceKernel;
  const findByOrder: CommerceOrderPaymentRepoPort["findByOrder"] = async (required, _optional = {}) => {
    const row = await storage.run(db => db.selectFrom("commerce_order_payments").selectAll()
      .where("workspace_id", "=", required.workspaceId).where("order_id", "=", required.orderId).executeTakeFirst());
    return row ? { workspaceId: row.workspace_id, orderId: row.order_id, siteId: row.site_id, providerId: row.provider_id,
      providerAccountId: row.provider_account_id, mode: row.mode, amount: { minorUnits: decodeMinor({ value: row.amount_minor }), currency: row.currency },
      paymentId: row.payment_id, createdAt: row.created_at } : null;
  };
  return { findByOrder,
    reserve: async (record, _optional = {}) => storage.transaction<ReserveOrderPaymentResult>(async () => {
      // The unique order key arbitrates before any read, including concurrent test/live requests.
      const inserted = await storage.run(db => db.insertInto("commerce_order_payments").values({
        workspace_id: record.workspaceId, order_id: record.orderId, site_id: record.siteId, provider_id: record.providerId,
        provider_account_id: record.providerAccountId, mode: record.mode, amount_minor: encodeMinor({ value: record.amount.minorUnits }),
        currency: record.amount.currency, payment_id: null, created_at: record.createdAt,
      }).onConflict(oc => oc.columns(["workspace_id", "order_id"]).doNothing()).executeTakeFirstOrThrow());
      if (Number(inserted.numInsertedOrUpdatedRows) > 0) return "reserved";
      // A conflict guarantees an existing reservation; this port has no deletion operation.
      const existing = (await findByOrder(record))!;
      return sameScope({ a: existing, b: record }) && existing.amount.minorUnits === record.amount.minorUnits
        && existing.amount.currency === record.amount.currency ? "same_scope" : "conflict";
    }),
    bind: async (required, _optional = {}) => storage.transaction<BindOrderPaymentResult>(async () => {
      // The NULL predicate, rather than a prior read, prevents a competing payment replacing one.
      const updated = await storage.run(db => db.updateTable("commerce_order_payments").set({ payment_id: required.paymentId })
        .where("workspace_id", "=", required.workspaceId).where("order_id", "=", required.orderId)
        .where("payment_id", "is", null).executeTakeFirstOrThrow());
      if (Number(updated.numUpdatedRows) > 0) return "bound";
      const existing = await findByOrder(required);
      if (!existing) return "not_found";
      return existing.paymentId === required.paymentId ? "already_bound" : "conflict";
    }),
  };
}
