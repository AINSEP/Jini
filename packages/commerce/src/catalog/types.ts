import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

import type { Money } from "../money/money.js";

/**
 * @file Domain record types for the Commerce first vertical slice (2026-08-12 swarm-consensus
 * debate, section 5). Mirrors `src/members/types.ts`'s convention: type-only definitions for the
 * row/domain shapes this feature owns; no logic here.
 *
 * Scope: catalog (products/prices), orders/order items, and the webhook inbox. Refunds,
 * proration, and carts are explicitly out of scope for this slice — see `README`/the handoff
 * report for what remains.
 */

export type CommerceProductKind = "one_time" | "membership" | "digital";
export type CommerceProductStatus = "active" | "archived";

/**
 * One display attribute pair (theme example: `{label: "Material", value: "Thick premium weight
 * combed cotton"}`). Variable-key, display-only — see `db/schema.sqlite.ts`'s `commerceProducts.specsJson`
 * doc for the column-vs-document call and its recorded promotion trigger.
 */
export interface CommerceProductSpec {
  label: string;
  value: string;
}

/**
 * A sellable thing. Deliberately separate from `MemberTierRecord` (`src/members/types.ts`) —
 * see `db/schema.sqlite.ts`'s `commerceProducts` doc for why the two are not merged.
 */
export interface CommerceProductRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  slug: string;
  kind: CommerceProductKind;
  status: CommerceProductStatus;
  description?: (string) | undefined;
  /** Set only when purchasing this product is how a member obtains a `MemberTierRecord`. */
  grantsMemberTierId?: (UUID) | undefined;
  /** Display-only spec pairs, in author-chosen order. `undefined` = none set. */
  specs?: (CommerceProductSpec[]) | undefined;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

/**
 * One image in a product's gallery, linking to an existing `media` row (never a bespoke image
 * store — see `db/schema.sqlite.ts`'s `commerceProductImages` doc). Alt text, title, and caption live on
 * the referenced `media` row itself, not duplicated here.
 */
export interface CommerceProductImageRecord {
  id: UUID;
  workspaceId: UUID;
  productId: UUID;
  mediaId: UUID;
  /** Gallery display order, ascending. */
  position: number;
  createdAt: ISODateTime;
}

export type CommercePriceStatus = "active" | "archived";
export type CommerceBillingInterval = "month" | "year";

/** One price point for a product. Immutable once referenced by an order — see schema doc. */
export interface CommercePriceRecord {
  id: UUID;
  workspaceId: UUID;
  productId: UUID;
  /** Integer minor units + UPPERCASE ISO-4217 (commerce design §6: one Money representation for
   * catalog and payments, so a catalog checkout passes the payments kernel's currency check). */
  unitAmount: Money;
  /** The struck-through "was" price, when set. `undefined` = not on sale. Same currency as
   * `unitAmount` (one `currency` column per row) and strictly greater when present (DB-enforced). */
  compareAtAmount?: (Money) | undefined;
  /** `undefined` = one-time. `"month"` | `"year"` = recurring. */
  billingInterval?: (CommerceBillingInterval) | undefined;
  status: CommercePriceStatus;
  createdAt: ISODateTime;
  version: number;
}

export type CommerceOrderStatus = "pending" | "paid" | "failed" | "canceled";

/** The financial-truth header row for one checkout. */
export interface CommerceOrderRecord {
  id: UUID;
  workspaceId: UUID;
  memberId: UUID;
  status: CommerceOrderStatus;
  /** Sum of the line totals, safe-integer Money arithmetic (`checkout.ts`'s `orderTotal`). */
  totalAmount: Money;
  provider: string;
  providerCustomerRef?: (string) | undefined;
  providerPaymentRef?: (string) | undefined;
  /** Ordering cursor — the provider event timestamp of the last webhook applied to this order. */
  providerEventAt?: (ISODateTime) | undefined;
  placedAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

/** One line item, snapshotted from a `CommercePriceRecord` at checkout time. */
export interface CommerceOrderItemRecord {
  id: UUID;
  workspaceId: UUID;
  orderId: UUID;
  priceId: UUID;
  productId: UUID;
  description: string;
  /** Snapshot of the price's `unitAmount` at checkout time. */
  unitAmount: Money;
  quantity: number;
  createdAt: ISODateTime;
}

export type CommerceWebhookEventStatus = "received" | "applied" | "ignored" | "failed";

/**
 * One inbound provider webhook event. `payload` is the full, opaque provider payload — the host
 * never parses into it; it exists for audit/replay/debugging only.
 */
export interface CommerceWebhookEventRecord {
  id: UUID;
  workspaceId: UUID;
  provider: string;
  eventId: string;
  eventType: string;
  /** The provider's own event timestamp (e.g. Stripe's `event.created`), not the receive time. */
  eventOccurredAt: ISODateTime;
  payload: string;
  status: CommerceWebhookEventStatus;
  receivedAt: ISODateTime;
  processedAt?: (ISODateTime) | undefined;
  lastError?: (string) | undefined;
}
