import type { AdminWebhookDeliveryResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { KEYS } from "../rules.js";

type Empty = Record<string, never>;

export interface IntegrationDeliveriesPort {
  listIntegrationDeliveries(required: { subscriptionId: string }, optional?: Record<string, never>): Promise<{ deliveries: AdminWebhookDeliveryResponse[] }>;
}

/**
 * @file Everything the delivery-log screen does, so `IntegrationDeliveries.tsx` is only markup.
 *
 * Extracted verbatim — same error strings. A second hook file rather than folding into
 * `use-integrations.hooks.ts`: `IntegrationDeliveries` is a distinct component with its own
 * lifecycle (re-fetches whenever `subscriptionId` changes), per this feature's "one hook file per
 * component" convention.
 *
 * `port` is injected — see `integration-deliveries-port.hooks.ts` — rather than importing
 * `lib/api` directly, so a test can describe a subscription's delivery log against
 * `createFakeIntegrationDeliveriesPort` instead of stubbing global `fetch`.
 * The host `useWiredIntegrationDeliveries` binds the port and translator for the subscription
 * that `IntegrationDeliveries.tsx` mounts.
 *
 * `t` (2026-08-11, standing i18n rule — see `use-integrations.hooks.ts`'s own file header for the
 * full rationale): injected in the required arguments. UNLIKE `useIntegrations`, no raw
 * `locale` is threaded — `IntegrationDeliveries.tsx` calls `t({ key })` bound-style,
 * it never passes `locale` to a helper that needs it directly.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the load is one `useFetchQuery` keyed on
 * `KEYS.deliveries({ subscriptionId })` — a query cannot commit a response belonging to a prior key,
 * which eliminates the load race an external audit flagged at this file's old line 46 (a plain
 * `.then()`/`.catch()` effect with no cancellation guard, so a `subscriptionId` change mid-flight
 * could commit a stale response) by construction.
 */

export interface IntegrationDeliveriesController {
  deliveries: AdminWebhookDeliveryResponse[] | null;
  error: string | null;
  /** Bound translator — `key` already resolved against the caller's locale, so
   *  `IntegrationDeliveries.tsx` never imports `useAdminLocale`/`integrations-i18n` itself. See
   *  this file's header. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}


export function useIntegrationDeliveries(
  { subscriptionId, port, t, queryHooks: { useFetchQuery }, describeApiError }: { subscriptionId: string; port: IntegrationDeliveriesPort; queryHooks: Pick<FetchQueryAdapter, "useFetchQuery">; describeApiError: (required: { e: unknown; fallback: string }, options?: Empty) => string; t: (required: { key: string }, optional?: Record<string, never>) => string },
  _optional = {},
): IntegrationDeliveriesController {
  const list = useFetchQuery({
    key: KEYS.deliveries({ subscriptionId }),
    fetch: () => port.listIntegrationDeliveries({ subscriptionId }),
  });

  const deliveries = list.data?.deliveries ?? null;
  const error = list.error ? describeApiError({ e: list.error, fallback: "failed to load deliveries" }) : null;

  return { deliveries, error, t };
}

