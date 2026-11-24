// Delivery, deduplication, jitter and hook rationale: ../delivery.ts.
/** Bind the canonical delivery worker to the host's wire headers, ISO clock and outbound HTTP policy.
 * Hook throws/vetoes must fail the attempt before unfiltered data can be sent; they follow the
 * ordinary backoff/dead path because the delivery port has no separate veto terminal state.
 */
import {
  enqueueDelivery as enqueueWebhookDelivery,
  processDueDeliveries as processWebhookDeliveries,
  type EnqueueDeliveryDeps as JiniEnqueueDeps,
  type ProcessDueDeliveriesDeps as JiniProcessDeps,
  type EnqueueDeliveryOptional,
  type ProcessDueDeliveriesOptional,
  type ProcessDueDeliveriesResult,
  type WebhookSourceEvent,
} from "../delivery.js";
import type { WebhookDeliveryRepoPort } from "../ports.js";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";

/** The host's positional outbound HTTP client, structurally: one `send(request)` per call. Its
 *  redirect policy is fixed by host composition (see {@link adaptWebhookHttpClient}). */
export interface HttpClientPort {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export interface EnqueueDeliveryDeps extends Omit<JiniEnqueueDeps, "deliveryRepo" | "clock"> {
  deliveryRepo: WebhookDeliveryRepoPort;
  clock: { nowIso(): string };
}
export interface EnqueueDeliveryRequired { deps: EnqueueDeliveryDeps; input: { event: WebhookSourceEvent }; }
export interface ProcessDueDeliveriesDeps extends Omit<JiniProcessDeps, "deliveryRepo" | "httpClient" | "clock"> {
  deliveryRepo: WebhookDeliveryRepoPort;
  httpClient: HttpClientPort;
  clock: { nowIso(): string };
}
export interface ProcessDueDeliveriesRequired { deps: ProcessDueDeliveriesDeps; }

/** Retain atomic durable enqueue({ record }, { envelope }) and optional dead-letter timestamps.
 * ADR-046 fold-in item 5 (GAP-05/GAP-12): the durable adapter writes the envelope in the SAME
 * INSERT as the delivery row, closing the crash gap. Jini's following envelopeStore.save remains
 * the actual write for memory adapters and a harmless repeated write for co-persisting adapters.
 */

/** Delegate fan-out without changing durable deduplication or envelope co-persistence.
 * @complexity O(matching subscriptions × delivery history), as defined by the existing repo port.
 */
export function enqueueDelivery({ deps, input }: EnqueueDeliveryRequired, optional: EnqueueDeliveryOptional = {}) {
  return enqueueWebhookDelivery({ deps: {
    ...deps,
    clock: { nowMs: () => Date.parse(deps.clock.nowIso()) },
  }, input }, optional);
}

/** Adapt the host's outbound HTTP port to the canonical delivery worker's `send({ request }, options)`.
 * Preserve the signed body bytes; only unwrap the canonical HTTP request object.
 * Redirect policy comes from host composition; unsupported per-call controls fail closed.
 * @throws {Error} When a caller asks for a per-request redirect control.
 * @complexity O(1) per send, plus the wrapped client's own cost.
 */
export function adaptWebhookHttpClient({ httpClient }: { httpClient: HttpClientPort }, _optional: Record<string, never> = {}): JiniProcessDeps["httpClient"] {
  return { send: ({ request }, options = {}) => {
    if (options.redirect !== undefined) throw new Error("webhook HTTP adapter does not support per-request redirect controls");
    return httpClient.send(request);
  } };
}

/** Jini owns claim/retry/hooks/sign/send; host adapters preserve transport and signature headers.
 * Delivery is at least once. Receivers can deduplicate by the host's delivery-id header (`deps.headers.deliveryId`) within the subscription.
 * @complexity O(batch size × bounded envelope bytes), with one bounded HTTP request per delivery.
 */
export function processDueDeliveries({ deps }: ProcessDueDeliveriesRequired, optional: ProcessDueDeliveriesOptional = {}): Promise<ProcessDueDeliveriesResult> {
  return processWebhookDeliveries({ deps: {
    ...deps,
    httpClient: adaptWebhookHttpClient({ httpClient: deps.httpClient }),
    clock: { nowMs: () => Date.parse(deps.clock.nowIso()) },
  } }, optional);
}
