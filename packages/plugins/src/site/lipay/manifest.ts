import type { DataModuleDecl } from "@jini-ai/core/contracts/site/db-data-modules";
const LIPAY_PLUGIN_ID = "lipay";
/**
 * The publisher is the HOST's first-party id, not the engine's: it is persisted in `_plugin_identity`
 * and compared strictly on every boot (`checkNamespaceAdoption`), so a site that already minted the
 * `lipay` row under its host's id must keep declaring that id. Changing it is a data migration.
 */
export function createLipayManifest(required: { publisher: string }, _optional: Record<string, never> = {}): DataModuleDecl {
  return {
    pluginId: LIPAY_PLUGIN_ID,
    pluginTier: "tier-2",
    provenance: { sourceUrl: "builtin://lipay", publisher: required.publisher },
    tables: LIPAY_TABLES,
  };
}
const LIPAY_TABLES: DataModuleDecl["tables"] = [
  {
    // One row per payment attempt (the "intent"), provider-agnostic.
    name: "payments",
    columns: [
      { name: "id", type: "TEXT", primaryKey: true },
      { name: "workspace_id", type: "TEXT", notNull: true },
      { name: "provider_id", type: "TEXT", notNull: true },
      // Caller-supplied. The outbound idempotency guard.
      { name: "idempotency_key", type: "TEXT", notNull: true },
      { name: "status", type: "TEXT", notNull: true },
      // Integer minor units. NEVER a float, NEVER "cents": JPY/KRW have zero decimal places,
      // KWD/BHD/JOD have three, so the scale is a property of the currency, not a constant 100.
      { name: "amount_minor", type: "INTEGER", notNull: true },
      { name: "currency", type: "TEXT", notNull: true },
      { name: "amount_refunded_minor", type: "INTEGER", notNull: true },
      // The provider's own charge id. Null until the provider responds.
      { name: "provider_ref", type: "TEXT" },
      // The CALLER's domain reference (order id, invoice id, membership id, …). lipay
      // deliberately never learns what it points at — an `order_id` column would couple
      // payments to one commerce model and lock out a membership or donations plugin.
      { name: "reference", type: "TEXT" },
      { name: "created_at", type: "INTEGER", notNull: true },
      { name: "updated_at", type: "INTEGER", notNull: true },
      { name: "last_error", type: "TEXT" },
    ],
    indexes: [
      // Outbound replay protection: a retried charge with the same key hits this, not the provider.
      { name: "idem", columns: ["workspace_id", "idempotency_key"], unique: true },
      // Webhook → payment correlation. This is the lookup WooCommerce indexed but never exposed,
      // leaving every gateway to reimplement correlation its own way.
      { name: "ref", columns: ["provider_id", "provider_ref"] },
      { name: "wsstatus", columns: ["workspace_id", "status", "created_at"] },
    ],
  },
  {
    // Every inbound provider notification, verified and normalized.
    name: "events",
    columns: [
      { name: "id", type: "TEXT", primaryKey: true },
      { name: "workspace_id", type: "TEXT", notNull: true },
      { name: "provider_id", type: "TEXT", notNull: true },
      // The provider's own event id. THE inbound idempotency key.
      { name: "provider_event_id", type: "TEXT", notNull: true },
      // Null when the event arrives before its payment row can be correlated.
      { name: "payment_id", type: "TEXT" },
      { name: "kind", type: "TEXT", notNull: true },
      { name: "occurred_at", type: "INTEGER", notNull: true },
      { name: "received_at", type: "INTEGER", notNull: true },
      // 0/1 — the declared type set has no BOOLEAN.
      { name: "applied", type: "INTEGER", notNull: true },
      { name: "payload", type: "TEXT", notNull: true },
    ],
    indexes: [
      // Replay of an already-seen event fails at the INSERT, not in a code branch a provider
      // author could forget to write.
      { name: "dedupe", columns: ["provider_id", "provider_event_id"], unique: true },
      { name: "bypayment", columns: ["payment_id", "occurred_at"] },
    ],
  },
  {
    name: "refunds",
    columns: [
      { name: "id", type: "TEXT", primaryKey: true },
      { name: "workspace_id", type: "TEXT", notNull: true },
      { name: "payment_id", type: "TEXT", notNull: true },
      { name: "idempotency_key", type: "TEXT", notNull: true },
      { name: "provider_ref", type: "TEXT" },
      { name: "amount_minor", type: "INTEGER", notNull: true },
      { name: "currency", type: "TEXT", notNull: true },
      { name: "status", type: "TEXT", notNull: true },
      { name: "reason", type: "TEXT" },
      { name: "created_at", type: "INTEGER", notNull: true },
      { name: "updated_at", type: "INTEGER", notNull: true },
    ],
    indexes: [
      { name: "idem", columns: ["workspace_id", "idempotency_key"], unique: true },
      { name: "bypayment", columns: ["payment_id"] },
    ],
  },
];
