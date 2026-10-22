import type { StorageKernel } from "@jini-ai/db/kernel";
import type { Generated } from "kysely";
/** Borrowed table contract; this package never creates, drops or reconciles the host's schema. */
export interface CommerceDatabase {
  commerce_order_items: CommerceOrderItemsTable;
  commerce_orders: CommerceOrdersTable;
  commerce_prices: CommercePricesTable;
  commerce_product_images: CommerceProductImagesTable;
  commerce_products: CommerceProductsTable;
  commerce_webhook_events: CommerceWebhookEventsTable;
}
export type CommerceKernel = StorageKernel<CommerceDatabase>;
export interface CommerceOrderItemsTable {
  id: string;
  workspace_id: string;
  order_id: string;
  price_id: string;
  product_id: string;
  description: string;
  unit_amount_cents: number;
  quantity: Generated<number>;
  currency: string;
  created_at: string;
}

export interface CommerceOrdersTable {
  id: string;
  workspace_id: string;
  member_id: string;
  status: string;
  currency: string;
  total_amount_cents: number;
  provider: string;
  provider_customer_ref: string | null;
  provider_payment_ref: string | null;
  provider_event_at: string | null;
  placed_at: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CommercePricesTable {
  id: string;
  workspace_id: string;
  product_id: string;
  unit_amount_cents: number;
  compare_at_amount_cents: number | null;
  currency: string;
  billing_interval: string | null;
  status: string;
  created_at: string;
  version: number;
}

export interface CommerceProductImagesTable {
  id: string;
  workspace_id: string;
  product_id: string;
  media_id: string;
  position: Generated<number>;
  created_at: string;
}

export interface CommerceProductsTable {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  description: string | null;
  grants_member_tier_id: string | null;
  specs_json: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CommerceWebhookEventsTable {
  id: string;
  workspace_id: string;
  provider: string;
  event_id: string;
  event_type: string;
  event_occurred_at: string;
  payload_json: string;
  status: string;
  received_at: string;
  processed_at: string | null;
  last_error: string | null;
}
