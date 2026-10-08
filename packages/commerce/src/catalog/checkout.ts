import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, UUID } from "@jini-ai/core/primitives";

import { CommerceCheckoutValidationError, CommercePriceNotFoundError, CommerceProductNotFoundError } from "./errors.js";
import type { CommerceOrderRepoPort, CommercePriceRepoPort, CommerceProductRepoPort } from "./ports.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord } from "./types.js";

/**
 * @file `checkout.ts` — the first (and only, this slice) Commerce checkout path (2026-08-12
 * swarm-consensus debate, section 5).
 *
 * Purpose:
 * Creates a `pending` order snapshotting one price at purchase time. Deliberately does not call
 * any payment provider — `CommercePaymentRuntimePort` (`contracts.ts`) still excludes charge/
 * refund/webhook methods by design (F1 in the debate's context packet: "A Commerce status
 * request therefore cannot move money... through this boundary"). This proves the SQLite dialect
 * really writes a commerce row end to end, which the debate's own repository audit found no code
 * path did before this slice; moving money is explicitly deferred to a later slice.
 *
 * Bypasses `core/commands`' `executeCommand` gateway on purpose, mirroring
 * `src/forms/submit-service.ts`'s justified precedent: a member placing an order is not an admin
 * actor with a permission string (no `authorize()` call fits), the same reasoning that file's own
 * header cites for `submitForm`. Not wired into `server/app.ts`'s boot path this pass, matching
 * every other brand-new adapter in this codebase (e.g. `SqliteMemberRepo`).
 *
 * Deliberately excludes carts (one price per checkout call), discounts/tax, and refunds/
 * proration — see the handoff report for what remains.
 */

/** Resource-bounds pre-check (5a4): a caller-controlled quantity needs an explicit cap even
 * though a legitimate purchase is almost always 1-2 units — an unbounded value multiplies
 * straight into `totalAmountCents`, a financial figure. */
export const MAX_CHECKOUT_QUANTITY = 100;

export interface CheckoutDeps {
  products: CommerceProductRepoPort;
  prices: CommercePriceRepoPort;
  orders: CommerceOrderRepoPort;
  clock: ClockPort;
  idGen: IdGeneratorPort;
}

export interface CheckoutInput {
  workspaceId: UUID;
  memberId: UUID;
  priceId: UUID;
  /** Defaults to 1. Integer, 1..`MAX_CHECKOUT_QUANTITY` inclusive. */
  quantity?: (number) | undefined;
  /** Opaque payment-provider id this order will settle through (e.g. `"stripe"`). Never validated
   * against a live provider registry in this slice — see file header. */
  provider: string;
  providerCustomerRef?: (string) | undefined;
}

export interface CheckoutRequired {
  deps: CheckoutDeps;
  input: CheckoutInput;
}

export interface CheckoutResult {
  order: CommerceOrderRecord;
  items: CommerceOrderItemRecord[];
}

/**
 * Validates -> resolves the active price and its product -> snapshots both into a new `pending`
 * order and one line item -> persists both atomically via `CommerceOrderRepoPort.placeOrder`.
 *
 * @throws {CommerceCheckoutValidationError} `quantity` is out of bounds.
 * @throws {CommercePriceNotFoundError} the price does not exist in this workspace, or is not
 *   `status: "active"`. `findById` is itself workspace-scoped (its query filters on
 *   `workspaceId`), so a price belonging to a different workspace is indistinguishable from a
 *   nonexistent one here — the same "don't leak existence across a tenant boundary" shape
 *   `submitForm`'s own nonexistent/disabled-slug handling uses.
 * @throws {CommerceProductNotFoundError} the price's product does not exist or is not active.
 *
 * @complexity Time: O(1) — two point lookups (`findById`) plus one 2-row write. Space: O(1).
 */
export async function checkout(required: CheckoutRequired, _optional: Record<string, never> = {}): Promise<CheckoutResult> {
  const { deps, input } = required;

  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CHECKOUT_QUANTITY) {
    throw new CommerceCheckoutValidationError({ message: `quantity must be an integer between 1 and ${MAX_CHECKOUT_QUANTITY}`, fieldErrors: [{ field: "quantity", reason: `must be an integer between 1 and ${MAX_CHECKOUT_QUANTITY}` }] }
    );
  }

  const price = await deps.prices.findById({ workspaceId: input.workspaceId, id: input.priceId });
  if (!price || price.status !== "active") {
    throw new CommercePriceNotFoundError(`price '${input.priceId}' was not found`);
  }

  const product = await deps.products.findById({ workspaceId: input.workspaceId, id: price.productId });
  if (!product || product.status !== "active") {
    throw new CommerceProductNotFoundError(`product '${price.productId}' was not found`);
  }

  const now = clockNowIso({ clock: deps.clock });
  const orderId = deps.idGen.newId();

  const order: CommerceOrderRecord = {
    id: orderId,
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    status: "pending",
    currency: price.currency,
    totalAmountCents: price.unitAmountCents * quantity,
    provider: input.provider,
    providerCustomerRef: input.providerCustomerRef,
    placedAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const item: CommerceOrderItemRecord = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    orderId,
    priceId: price.id,
    productId: product.id,
    description: product.name,
    unitAmountCents: price.unitAmountCents,
    quantity,
    currency: price.currency,
    createdAt: now,
  };

  await deps.orders.placeOrder({ order, items: [item] });

  return { order, items: [item] };
}
