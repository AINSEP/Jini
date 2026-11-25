import type { AdminWebhookDeliveryResponse, AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import type { QueryKey } from "@jini-ai/core/fetch";
import { formatTimestamp } from "@jini-ai/core/text";

type Empty = Record<string, never>;

/**
 * @file Pure logic for the `integrations` feature — everything that computes a value rather than
 * rendering one.
 *
 * Follows the same convention `features/posts/rules.ts` establishes for this app: the bar for
 * landing here is "does it compute something", not "is it rendered". The row-action menu below
 * used to be an array literal built inline inside a `DataTable` cell — logic reachable only by
 * rendering a table and opening a popover, which is how its `status === "paused"` label branch
 * ended up untested.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): two entirely separate top-level namespaces, not a
 * shared grandparent — `use-integration-deliveries.hooks.ts`'s delivery log is a distinct,
 * read-only sub-resource with no method overlap with subscription CRUD (same split
 * `integrations-port.hooks.ts` already makes with its own two ports), and no subscription write
 * (create/pause/delete) needs to invalidate a delivery log. Same "separate namespaces, no shared
 * prefix" shape `@jini-ai/admin/forms` rules.ts's `KEYS` uses for `forms` vs `form-submissions`.
 */
export const KEYS = {
  list: ["integrations", "list"] as QueryKey,
  deliveries: ({ subscriptionId }: { subscriptionId: string }, _optional = {}): QueryKey => ["integration-deliveries", subscriptionId],
};

/** This screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s
 *  `TAXONOMY_RESOURCE` for why this is a plain colocated constant rather than a shared registry.
 *  Agent-writable via `webhooks_create_subscription`/`webhooks_pause_subscription`/
 *  `webhooks_delete_subscription` (`apps/website/src/features/webhooks/agent-tools.ts` — the
 *  website domain is named "webhooks", this admin feature is named "integrations"; both name the
 *  same `WebhookSubscriptionRecord` resource). No sibling constant for the deliveries log
 *  (`use-integration-deliveries.hooks.ts`): no Webhooks agent tool writes a delivery row — deliveries
 *  are recorded only by the outbound delivery worker itself, which nothing in this catalog drives. */
export const WEBHOOKS_RESOURCE = "webhooks";

/** Parses the comma-separated topics field into a trimmed, blank-free list.
 *
 * @complexity Time: O(n) in the length of `raw`; space: O(k) for the k resulting topics.
 * @overallScore 100
 */
export function parseTopics({ raw }: { raw: string }, _optional = {}): string[] {
  return raw
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

/** The callbacks a webhook subscription's row menu needs. Passed in rather than imported so this
 *  module stays free of state and navigation, and so a test can assert exactly which one a given
 *  row wires up — same shape as `posts/rules.ts`'s `PostRowMenuHandlers`. */
export interface IntegrationRowMenuHandlers {
  onTogglePause: (subscription: AdminWebhookSubscriptionResponse) => void;
  onDelete: (subscription: AdminWebhookSubscriptionResponse) => void;
}

/**
 * The row-action menu for one webhook subscription.
 *
 * The branch is the reason this is exported: the "Pause"/"Resume" label depends on
 * `subscription.status`, and that was previously only reachable by rendering the table and
 * opening the menu. "Delete" is marked `destructive` and only OPENS the confirmation; the delete
 * itself is `useIntegrations().onDelete`, gated on `ConfirmDialog`.
 *
 * Withholding the menu entirely for a `disabled` subscription (rendering `—` instead) stays in
 * `Integrations.tsx` — that decision is made before this function is ever called, not inside it.
 *
 * @complexity Time/space: O(1) — exactly two entries, no iteration.
 * @overallScore 100
 */
export function integrationRowMenuItems(
  { subscription, handlers, locale, translate: t }: { subscription: AdminWebhookSubscriptionResponse; handlers: IntegrationRowMenuHandlers; locale: string; translate: (required: { locale: string; key: string }, options?: Empty) => string },
  _optional = {},
): { key: string; label: string; onSelect: () => void; destructive?: boolean }[] {
  return [
    {
      key: "pause",
      label: subscription.status === "paused" ? t({ locale: locale, key: "Resume" }) : t({ locale: locale, key: "Pause" }),
      onSelect: () => handlers.onTogglePause(subscription),
    },
    {
      key: "delete",
      label: t({ locale: locale, key: "Delete" }),
      destructive: true,
      onSelect: () => handlers.onDelete(subscription),
    },
  ];
}

/** Best available timestamp for the delivery log's "Timestamp" column: delivered time, else
 *  created time.
 *
 * @complexity Time/space: O(1).
 * @overallScore 100
 */
export function displayTimestamp({ delivery, viewerTimeZone }: { delivery: AdminWebhookDeliveryResponse; viewerTimeZone: string }, _optional: Empty = {}): string {
  return formatTimestamp({ iso: delivery.deliveredAt ?? delivery.createdAt }, { viewerTimeZone: viewerTimeZone });
}

/**
 * `useIntegrations`'s page-level error banner — deliberately excludes the CREATE write's own
 * failure, which shows inside the create form itself (`formError`, derived directly from
 * `createMutation.error` in the hook) rather than this page-level channel, matching the
 * pre-migration `onCreate`/`onTogglePause`/`onDelete` catch blocks' own separate `setFormError`
 * vs `setError` split.
 *
 * Precedence: an active toggle/delete failure outranks a background list-refresh failure, same
 * shape as `Jini redirects/rules.ts`'s `visibleRedirectsError`. The list error only surfaces before
 * `subscriptions` has ever loaded.
 *
 * @complexity Time/space: O(1) — three fixed checks, no iteration.
 */
export function visibleIntegrationsError(params: {
  toggleError: Error | null;
  deleteError: Error | null;
  listError: Error | null;
  hasSubscriptions: boolean;
  locale: string;
  translate: (required: { locale: string; key: string }, options?: Empty) => string;
  describeApiError: (required: { e: unknown; fallback: string }, options?: Empty) => string;
}, _optional: Empty = {}): string | null {
  if (params.toggleError) return params.describeApiError({ e: params.toggleError, fallback: params.translate({ locale: params.locale, key: "failed to update subscription" }) });
  if (params.deleteError) return params.describeApiError({ e: params.deleteError, fallback: params.translate({ locale: params.locale, key: "failed to delete subscription" }) });
  if (params.hasSubscriptions) return null;
  return params.listError ? params.describeApiError({ e: params.listError, fallback: params.translate({ locale: params.locale, key: "failed to load integrations" }) }) : null;
}
