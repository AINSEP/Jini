/**
 * @file `AdminIntegrationsPort` — outbound webhook subscriptions and their delivery history.
 *
 * "Integrations" here specifically means outbound webhooks (a subscription that fires HTTP calls
 * to a target URL when a topic occurs), not a broader per-provider connector concept — the
 * reference implementation has exactly one integration mechanism. A host that later adds other
 * integration kinds (inbound, OAuth-connected third parties, ...) would need a wider port; this
 * one should not be stretched to cover those by convention alone.
 *
 * ## `deleteIntegrationSubscription` is a soft delete
 *
 * Unlike `AdminMediaPort.deleteMedia` (a genuine hard purge), the reference implementation's subscription "delete" sets
 * `status: "disabled"` and stamps a disabled timestamp for audit durability — the row is never
 * removed, and the response echoes the now-disabled subscription rather than a bare
 * acknowledgement. Do not render this action as irreversible in a panel; it is closer in spirit to
 * `AdminIdentityPort.disableUser` than to a real delete. (No `restoreIntegrationSubscription`
 * exists on the reference server to undo it from the admin UI, so a panel still should not promise
 * a reachable undo — only that the underlying data was not destroyed.)
 */

/** A summary of a subscription's most recent delivery attempt — the `lastDelivery` field embedded
 *  on `AdminIntegrationSubscription`, kept intentionally thin (the full record is
 *  `AdminIntegrationDelivery`, fetched separately via `listIntegrationDeliveries`). */
export interface AdminIntegrationDeliverySummary {
  readonly id: string;
  readonly status: "pending" | "delivering" | "delivered" | "failed" | "dead" | "canceled";
  readonly attempts: number;
  readonly lastResponseStatus: number | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
}

export interface AdminIntegrationSubscription {
  readonly id: string;
  readonly label: string;
  readonly targetUrl: string;
  readonly topics: readonly string[];
  readonly status: "active" | "paused" | "disabled";
  /** Increments whenever the signing secret rotates; a host may expose this so an operator can
   *  confirm a receiving endpoint has picked up the latest secret. */
  readonly secretVersion: number;
  readonly previousSecretVersion: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly disabledAt: string | null;
  readonly lastDelivery: AdminIntegrationDeliverySummary | null;
}

/** One delivery attempt's full record, as listed by `listIntegrationDeliveries`. */
export interface AdminIntegrationDelivery {
  readonly id: string;
  readonly subscriptionId: string;
  /** The source event this delivery is carrying — distinct from `id`, since one event can produce
   *  more than one delivery attempt (retries). */
  readonly eventId: string;
  readonly topic: string;
  readonly status: AdminIntegrationDeliverySummary["status"];
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastResponseStatus: number | null;
  readonly lastError: string | null;
  /** Which secret version signed this attempt's payload — lets a receiving endpoint mid-rotation
   *  determine which key to verify against. */
  readonly signedWithVersion: number | null;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly deadAt: string | null;
}

export interface AdminIntegrationsPort {
  listIntegrationSubscriptions(): Promise<readonly AdminIntegrationSubscription[]>;
  createIntegrationSubscription(input: {
    label: string;
    targetUrl: string;
    topics: readonly string[];
  }): Promise<AdminIntegrationSubscription>;
  pauseIntegrationSubscription(id: string, input: { paused: boolean }): Promise<AdminIntegrationSubscription>;
  /** Soft delete — see the file header. */
  deleteIntegrationSubscription(id: string): Promise<AdminIntegrationSubscription>;
  listIntegrationDeliveries(subscriptionId: string): Promise<readonly AdminIntegrationDelivery[]>;
}
