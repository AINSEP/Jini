import type { UUID } from "@jini-ai/core/primitives";
import type { PaymentScope } from "../payments/contract/scope.js";
import { orderTotal } from "./checkout.js";
import { CommerceCheckoutValidationError, CommerceOrderNotFoundError, CommercePriceNotFoundError } from "./errors.js";
import type { CommerceOrderRepoPort, CommercePriceRepoPort } from "./ports.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord, CommercePriceRecord } from "./types.js";

export interface LoadPayableOrderDeps { orders: CommerceOrderRepoPort; prices: CommercePriceRepoPort; }
interface LoadPayableOrderInput { workspaceId: UUID; orderId: UUID; scope: PaymentScope; }

/** Validate ownership before loading any further order data. */
function validateOrder({ order, input }: { order: CommerceOrderRecord; input: LoadPayableOrderInput }, _optional: Record<string, never> = {}): void {
  if (order.status !== "pending") throw new CommerceCheckoutValidationError({ message: "order is not pending" });
  if (order.workspaceId !== input.workspaceId || input.scope.workspaceId !== input.workspaceId) {
    throw new CommerceCheckoutValidationError({ message: "order workspace differs from payment scope" });
  }
  if (order.provider !== input.scope.providerId) throw new CommerceCheckoutValidationError({ message: "order provider differs from payment scope" });
}

/** Load the single one-time item and validate its purchase-time total; current prices never reprice it. */
export async function loadPayableOrder({ deps, input }: { deps: LoadPayableOrderDeps; input: LoadPayableOrderInput }, _optional: Record<string, never> = {}): Promise<{
  order: CommerceOrderRecord; item: CommerceOrderItemRecord; price: CommercePriceRecord;
}> {
  const order = await deps.orders.findById({ workspaceId: input.workspaceId, id: input.orderId });
  if (!order) throw new CommerceOrderNotFoundError(`order '${input.orderId}' was not found`);
  validateOrder({ order, input });
  const items = await deps.orders.listItems({ workspaceId: input.workspaceId, orderId: input.orderId });
  if (items.length !== 1) throw new CommerceCheckoutValidationError({ message: "order must contain exactly one item" });
  const item = items[0]!; // The length check above establishes the single-item contract.
  const price = await deps.prices.findById({ workspaceId: input.workspaceId, id: item.priceId });
  if (!price) throw new CommercePriceNotFoundError(`price '${item.priceId}' was not found`);
  if (price.billingInterval !== undefined) throw new CommerceCheckoutValidationError({ message: "recurring prices are not supported" });
  const total = orderTotal({ lines: [item] });
  if (total.minorUnits !== order.totalAmount.minorUnits || total.currency !== order.totalAmount.currency) {
    throw new CommerceCheckoutValidationError({ message: "order total differs from its item snapshot" });
  }
  return { order, item, price };
}
