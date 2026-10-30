import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, UUID } from "@jini-ai/core/primitives";

import { addMoney, money, type Money } from "../money/money.js";
import {
  CommerceCheckoutValidationError,
  CommerceCurrencyMismatchError,
  CommercePriceNotFoundError,
  CommerceProductNotFoundError,
} from "./errors.js";
import type { CommerceOrderRepoPort, CommercePriceRepoPort, CommerceProductRepoPort } from "./ports.js";
import type { CommerceOrderItemRecord, CommerceOrderRecord } from "./types.js";

/**
 * @file `checkout.ts` — the original Commerce order-placement path (2026-08-12
 * swarm-consensus debate, section 5).
 *
 * Purpose:
 * Creates a `pending` order snapshotting one price at purchase time. Deliberately does not call
 * any payment provider — `CommercePaymentRuntimePort` (`contracts.ts`) still excludes charge/
 * refund/webhook methods by design (F1 in the debate's context packet: "A Commerce status
 * request therefore cannot move money... through this boundary"). This proves the SQLite dialect
 * really writes a commerce row end to end, which the debate's own repository audit found no code
 * path did before this slice; moving money was explicitly deferred to a later slice.
 * Phase 1 now composes `checkout()` -> `payOrder()` -> `PaymentsPort.createIntent`: checkout
 * still owns the pending snapshot, payOrder reserves/binds its payment, and the shared
 * `settleOrderPayment` verifies evidence before marking the order paid.
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
 * straight into `totalAmount`, a financial figure. */
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

/** One line of an order total: a unit amount and how many of it. */
export interface OrderLine {
  unitAmount: Money;
  quantity: number;
}

const invalidLine = (reason: string) =>
  new CommerceCheckoutValidationError({ message: reason, fieldErrors: [{ field: "quantity", reason }] });

/** `unitAmount × quantity`, refusing a product past the safe-integer range rather than rounding.
 * `orderTotal` is public, so each line is validated here, not only by `checkout()` (L8 review):
 * quantity is a positive integer and the unit amount is normalized Money (UPPERCASE, ≥ 0). */
function lineTotal({ unitAmount, quantity }: OrderLine, _optional: Record<string, never> = {}): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw invalidLine("quantity must be a positive integer");
  let unit: Money;
  try {
    unit = money(unitAmount, { allowZero: true });
  } catch (error) {
    throw new CommerceCheckoutValidationError({ message: `invalid unit amount: ${(error as Error).message}`, fieldErrors: [{ field: "unitAmount", reason: (error as Error).message }] });
  }
  const minorUnits = unit.minorUnits * quantity;
  if (!Number.isSafeInteger(minorUnits)) {
    throw new CommerceCheckoutValidationError({ message: "line total exceeds the safe integer range", fieldErrors: [{ field: "quantity", reason: "line total exceeds the safe integer range" }] });
  }
  return { minorUnits, currency: unit.currency };
}

/**
 * An order's total over its lines, with `addMoney`'s safe-integer check on every sum. Non-empty
 * by type, so the total always has a currency.
 *
 * @throws {CommerceCurrencyMismatchError} the lines are not all in one currency — an order is
 *   charged in exactly one currency, so mixing is refused, never converted.
 * @throws {CommerceCheckoutValidationError} a line or the sum leaves the safe-integer range.
 * @complexity Time: O(n) in `lines.length`. Space: O(1).
 */
export function orderTotal({ lines }: { lines: readonly [OrderLine, ...OrderLine[]] }, _optional: Record<string, never> = {}): Money {
  const [first, ...rest] = lines;
  let total = lineTotal(first);
  for (const line of rest) {
    const next = lineTotal(line);
    if (next.currency !== total.currency) throw new CommerceCurrencyMismatchError({ expected: total.currency, actual: next.currency });
    total = addMoneySafely({ a: total, b: next });
  }
  return total;
}

/** `addMoney`, with its out-of-range `RangeError` surfaced as the checkout's typed validation error. */
function addMoneySafely({ a, b }: { a: Money; b: Money }, _optional: Record<string, never> = {}): Money {
  try {
    return addMoney({ a, b });
  } catch {
    throw new CommerceCheckoutValidationError({ message: "order total exceeds the safe integer range", fieldErrors: [{ field: "quantity", reason: "order total exceeds the safe integer range" }] });
  }
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
 * @throws {CommerceCheckoutValidationError} the order total leaves the safe-integer range.
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

  const totalAmount = orderTotal({ lines: [{ unitAmount: price.unitAmount, quantity }] });
  const now = clockNowIso({ clock: deps.clock });
  const orderId = deps.idGen.newId();

  const order: CommerceOrderRecord = {
    id: orderId,
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    status: "pending",
    totalAmount,
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
    unitAmount: price.unitAmount,
    quantity,
    createdAt: now,
  };

  await deps.orders.placeOrder({ order, items: [item] });

  return { order, items: [item] };
}
