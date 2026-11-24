/**
 * @file The admin `integrations` webhook wire DTOs: the JSON bodies the webhook subscription/delivery
 * admin routes answer with and an admin client reads. Declared here, once, so the host's response
 * projections and any client read the same shapes. No signing secret is ever part of them: only
 * `secretVersion`/`previousSecretVersion`, which name a key generation, never the key material.
 */

export interface AdminWebhookDeliverySummary {
  id: string;
  status: "pending" | "delivering" | "delivered" | "failed" | "dead" | "canceled";
  attempts: number;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface AdminWebhookSubscriptionResponse {
  id: string;
  label: string;
  targetUrl: string;
  topics: string[];
  status: "active" | "paused" | "disabled";
  secretVersion: number;
  previousSecretVersion: number | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  /** Row version the server always sends; optional so client-built placeholder rows type-check. */
  version?: number;
  /** Most recent delivery attempt for this subscription, or `null` if none has fired yet. */
  lastDelivery: AdminWebhookDeliverySummary | null;
}

export interface AdminWebhookDeliveryResponse {
  id: string;
  subscriptionId: string;
  eventId: string;
  topic: string;
  status: AdminWebhookDeliverySummary["status"];
  attempts: number;
  nextAttemptAt: string;
  lastResponseStatus: number | null;
  lastError: string | null;
  signedWithVersion: number | null;
  createdAt: string;
  deliveredAt: string | null;
  deadAt: string | null;
}
