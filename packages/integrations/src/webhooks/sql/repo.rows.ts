import type { Generated } from "kysely";

/**
 * @file Stored column shapes of the two webhook tables, copied without schema changes in the
 * generated key order of the host's content database types. The table names are host-owned (see
 * `WebhookTables`).
 */
export interface WebhookDeliveriesTable {
  id: string;
  workspace_id: string;
  subscription_id: string;
  event_id: string;
  topic: string;
  payload_json: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_response_status: number | null;
  last_error: string | null;
  signed_with_version: number | null;
  created_at: string;
  delivered_at: string | null;
  dead_at: string | null;
}

export interface WebhookSubscriptionsTable {
  id: string;
  workspace_id: string;
  owner_principal_id: string;
  label: string;
  target_url: string;
  topics_json: string;
  secret_version: number;
  previous_secret_version: number | null;
  status: string;
  created_by_principal_id: string;
  created_by_plugin_id: string | null;
  /**
   * `agent` | `person`; null on rows written before attribution existed (read as person-made). The
   * host schema must add this nullable column before it wires the agent switch, or a restart would
   * forget which subscriptions an agent created.
   */
  created_by_kind: string | null;
  created_at: string;
  updated_at: string;
  version: Generated<number>;
  disabled_at: string | null;
}
