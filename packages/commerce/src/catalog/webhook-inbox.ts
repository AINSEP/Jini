import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort, UUID } from "@jini-ai/core/primitives";

import type { ApplyProviderEventResult, CommerceWebhookEventRepoPort } from "./ports.js";
import type { CommerceOrderStatus } from "./types.js";

/**
 * @file `webhook-inbox.ts` — provider webhook ingestion (2026-08-12 swarm-consensus debate,
 * section 5: "idempotency AND ordering — they are different problems").
 *
 * Purpose:
 * `ingestProviderEvent` is the thin service boundary over `CommerceWebhookEventRepoPort
 * .applyProviderEvent` (`repo.ts`), which owns the actual atomic guard: `(provider,
 * eventId)` UNIQUE stops replay; a single `UPDATE ... WHERE providerEventAt < ?` inside the same
 * transaction stops a chronologically-older event from overwriting a newer one that already
 * landed. Neither alone is sufficient — see the repo port's own doc.
 *
 * Deliberately excludes signature verification. There is no live payment-provider adapter
 * anywhere in this codebase yet (`CommercePaymentRuntimePort.listProviders()` has no composed
 * runtime — see `contracts.ts`/`status.ts`), so there is no provider-specific signing secret to
 * verify against and no route wiring this into an HTTP endpoint yet either. A real provider
 * adapter (Stripe or otherwise) MUST verify the request signature before calling this function —
 * `ingestProviderEvent` trusts `event` completely, exactly like `handleVerifiedCommerceEvent`'s
 * own naming in the debate's Round 3 offload made explicit ("Signature verification occurs
 * before this call").
 *
 * `projection.status`/`orderId` are caller-supplied, not derived here, for the same reason: this
 * slice has no live provider to ask "what is this object's authoritative current state" — a real
 * adapter's `ProviderProjectionPort`-equivalent (debate Round 3) owns that translation. This
 * module's job stops at "apply an already-decided projection exactly once, in order."
 */

export interface InboundProviderEvent {
  workspaceId: UUID;
  provider: string;
  eventId: string;
  eventType: string;
  /** The provider's own event timestamp (ISO-8601), e.g. Stripe's `event.created`. This becomes
   * the new ordering cursor if the event is applied. */
  eventOccurredAt: string;
  /** Full, opaque provider payload — stored whole for audit/replay, never parsed here. */
  payload: string;
}

export interface OrderProjection {
  orderId: UUID;
  status: CommerceOrderStatus;
}

export interface IngestProviderEventDeps {
  webhookEvents: CommerceWebhookEventRepoPort;
  clock: ClockPort;
  idGen: IdGeneratorPort;
}

export interface IngestProviderEventRequired {
  deps: IngestProviderEventDeps;
  event: InboundProviderEvent;
  /** The order this event's projection applies to, and the state it should move to if the event
   * is not a duplicate or stale. */
  projection: OrderProjection;
}

/**
 * Records `event` in the webhook inbox and, if it is neither a replay nor out of order, applies
 * `projection` to `projection.orderId` — all inside one atomic transaction (see file header).
 *
 * @returns `"duplicate"` — `(event.provider, event.eventId)` was already recorded; nothing
 *   changed. `"stale"` — a new event, but chronologically older than what is already applied to
 *   the order; recorded as `"ignored"` in the inbox, the order is untouched. `"applied"` — the
 *   order's `status`/ordering cursor were updated.
 *
 * @complexity Time: O(1) — one insert, at most one conditional update, one status update, inside
 *   a single DB transaction. Space: O(1).
 */
export async function ingestProviderEvent(
  required: IngestProviderEventRequired, _optional: Record<string, never> = {}
): Promise<ApplyProviderEventResult> {
  const { deps, event, projection } = required;
  const now = clockNowIso({ clock: deps.clock });

  return deps.webhookEvents.applyProviderEvent({
    event: {
      id: deps.idGen.newId(),
      workspaceId: event.workspaceId,
      provider: event.provider,
      eventId: event.eventId,
      eventType: event.eventType,
      eventOccurredAt: event.eventOccurredAt,
      payload: event.payload,
      status: "received",
      receivedAt: now,
    },
    orderId: projection.orderId,
    projection: {
      status: projection.status,
      providerEventAt: event.eventOccurredAt,
      updatedAt: now,
    },
    processedAt: now,
  });
}
