import type { Insertable, Selectable } from "kysely";

import type { CommerceDatabase as ContentDatabase } from "./database.js";
import type { CommerceWebhookEventRepoPort } from "./ports.js";
import type {
  CommerceBillingInterval,
  CommerceOrderItemRecord,
  CommerceOrderRecord,
  CommerceOrderStatus,
  CommercePriceRecord,
  CommercePriceStatus,
  CommerceProductImageRecord,
  CommerceProductKind,
  CommerceProductRecord,
  CommerceProductSpec,
  CommerceProductStatus,
} from "./types.js";

/**
 * @file Row mapping for the `commerce_*` tables, shared by every dialect: the columns are the
 * generated `ContentDatabase` types (snake_case, money as integer minor units, JSON as compact
 * text). Neutral on purpose — no repo, no driver.
 */

type Tables = ContentDatabase;
export type CommerceProductRow = Selectable<Tables["commerce_products"]>;
export type CommerceProductImageRow = Selectable<Tables["commerce_product_images"]>;
export type CommercePriceRow = Selectable<Tables["commerce_prices"]>;
export type CommerceOrderRow = Selectable<Tables["commerce_orders"]>;
export type CommerceOrderItemRow = Selectable<Tables["commerce_order_items"]>;

/** One `commerce_products` row as a {@link CommerceProductRecord}; NULL columns become `undefined`. */
export function toProductRecord(row: CommerceProductRow, _optional: Record<string, never> = {}): CommerceProductRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    kind: row.kind as CommerceProductKind,
    status: row.status as CommerceProductStatus,
    description: row.description ?? undefined,
    grantsMemberTierId: row.grants_member_tier_id ?? undefined,
    specs: row.specs_json == null ? undefined : (JSON.parse(row.specs_json) as CommerceProductSpec[]),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/** The `commerce_products` row `save` upserts (compact JSON specs). */
export function toProductRow(record: CommerceProductRecord, _optional: Record<string, never> = {}): Insertable<Tables["commerce_products"]> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    name: record.name,
    slug: record.slug,
    kind: record.kind,
    status: record.status,
    description: record.description ?? null,
    grants_member_tier_id: record.grantsMemberTierId ?? null,
    specs_json: record.specs == null ? null : JSON.stringify(record.specs),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

export function toProductImageRecord(row: CommerceProductImageRow, _optional: Record<string, never> = {}): CommerceProductImageRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    productId: row.product_id,
    mediaId: row.media_id,
    position: row.position,
    createdAt: row.created_at,
  };
}

export function toProductImageRow(record: CommerceProductImageRecord, _optional: Record<string, never> = {}): Insertable<Tables["commerce_product_images"]> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    product_id: record.productId,
    media_id: record.mediaId,
    position: record.position,
    created_at: record.createdAt,
  };
}

export function toPriceRecord(row: CommercePriceRow, _optional: Record<string, never> = {}): CommercePriceRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    productId: row.product_id,
    unitAmountCents: row.unit_amount_cents,
    compareAtAmountCents: row.compare_at_amount_cents ?? undefined,
    currency: row.currency,
    billingInterval: (row.billing_interval as CommerceBillingInterval | null) ?? undefined,
    status: row.status as CommercePriceStatus,
    createdAt: row.created_at,
    version: row.version,
  };
}

export function toPriceRow(record: CommercePriceRecord, _optional: Record<string, never> = {}): Insertable<Tables["commerce_prices"]> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    product_id: record.productId,
    unit_amount_cents: record.unitAmountCents,
    compare_at_amount_cents: record.compareAtAmountCents ?? null,
    currency: record.currency,
    billing_interval: record.billingInterval ?? null,
    status: record.status,
    created_at: record.createdAt,
    version: record.version,
  };
}

export function toOrderRecord(row: CommerceOrderRow, _optional: Record<string, never> = {}): CommerceOrderRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    status: row.status as CommerceOrderStatus,
    currency: row.currency,
    totalAmountCents: row.total_amount_cents,
    provider: row.provider,
    providerCustomerRef: row.provider_customer_ref ?? undefined,
    providerPaymentRef: row.provider_payment_ref ?? undefined,
    providerEventAt: row.provider_event_at ?? undefined,
    placedAt: row.placed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function toOrderRow(record: CommerceOrderRecord, _optional: Record<string, never> = {}): Insertable<Tables["commerce_orders"]> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    member_id: record.memberId,
    status: record.status,
    currency: record.currency,
    total_amount_cents: record.totalAmountCents,
    provider: record.provider,
    provider_customer_ref: record.providerCustomerRef ?? null,
    provider_payment_ref: record.providerPaymentRef ?? null,
    provider_event_at: record.providerEventAt ?? null,
    placed_at: record.placedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

export function toOrderItemRecord(row: CommerceOrderItemRow, _optional: Record<string, never> = {}): CommerceOrderItemRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    orderId: row.order_id,
    priceId: row.price_id,
    productId: row.product_id,
    description: row.description,
    unitAmountCents: row.unit_amount_cents,
    quantity: row.quantity,
    currency: row.currency,
    createdAt: row.created_at,
  };
}

export function toOrderItemRow(record: CommerceOrderItemRecord, _optional: Record<string, never> = {}): Insertable<Tables["commerce_order_items"]> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    order_id: record.orderId,
    price_id: record.priceId,
    product_id: record.productId,
    description: record.description,
    unit_amount_cents: record.unitAmountCents,
    quantity: record.quantity,
    currency: record.currency,
    created_at: record.createdAt,
  };
}

/** The inbound event `applyProviderEvent` records, always as `"received"` (the repo sets the outcome). */
type InboundEvent = Parameters<CommerceWebhookEventRepoPort["applyProviderEvent"]>[0]["event"];

export function toWebhookEventRow(event: InboundEvent, _optional: Record<string, never> = {}): Insertable<Tables["commerce_webhook_events"]> {
  return {
    id: event.id,
    workspace_id: event.workspaceId,
    provider: event.provider,
    event_id: event.eventId,
    event_type: event.eventType,
    event_occurred_at: event.eventOccurredAt,
    payload_json: event.payload,
    status: "received",
    received_at: event.receivedAt,
  };
}
