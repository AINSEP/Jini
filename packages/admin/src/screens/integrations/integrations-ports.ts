import type { AdminWebhookDeliveryResponse, AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";

/** What the integrations (webhook subscriptions) screen needs from its host: list, create, pause/resume and delete
 *  a subscription. The host binds it to its admin API client. */
export interface IntegrationsPort {
  listIntegrationSubscriptions(): Promise<{ subscriptions: AdminWebhookSubscriptionResponse[] }>;
  createIntegrationSubscription(input: {
    label: string;
    targetUrl: string;
    topics: string[];
  }, optional?: Record<string, never>): Promise<{ subscription: AdminWebhookSubscriptionResponse }>;
  pauseIntegrationSubscription(target: {
    id: string;
    paused: boolean;
  }): Promise<{ subscription: AdminWebhookSubscriptionResponse }>;
  deleteIntegrationSubscription(required: { id: string }, optional?: Record<string, never>): Promise<{ subscription: AdminWebhookSubscriptionResponse }>;
}

/** What the webhook deliveries drawer needs from its host: one subscription's delivery log. */
export interface IntegrationDeliveriesPort {
  listIntegrationDeliveries(required: { subscriptionId: string }, optional?: Record<string, never>): Promise<{ deliveries: AdminWebhookDeliveryResponse[] }>;
}
