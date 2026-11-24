import type { AdminWebhookDeliveryResponse, AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";

/**
 * @file What `useIntegrations` needs from the outside world, as an interface rather than a direct
 * `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and already applied to `features/redirects` and
 * `features/pages`: this file declares, `integrations-dependencies.hooks.ts` binds the real `api`
 * client, and nothing else under `features/integrations/hooks` imports `lib/api` for these four
 * routes.
 *
 * Scoped to `use-integrations.hooks.ts` only — `use-integration-deliveries.hooks.ts` reads a
 * different sub-resource (one subscription's delivery log, read-only) with no method overlap with
 * this one, so it gets its own `IntegrationDeliveriesPort` rather than being folded in here; see
 * that port's own doc comment.
 */
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

/**
 * @file What `useIntegrationDeliveries` needs from the outside world, as an interface rather than
 * a direct `lib/api` import.
 *
 * A separate port from `integrations-port.hooks.ts` rather than folding in: this hook reads a
 * single subscription's delivery log (read-only), a different sub-resource with no method overlap
 * with subscription CRUD — narrowing to what this hook actually consumes, per `page-editor-
 * port.hooks.ts`'s "narrowing here is not a shared contract, it is this hook's own consumption"
 * reasoning, rather than forcing a shared shape neither hook's contract needs.
 */
export interface IntegrationDeliveriesPort {
  listIntegrationDeliveries(required: { subscriptionId: string }, optional?: Record<string, never>): Promise<{ deliveries: AdminWebhookDeliveryResponse[] }>;
}
