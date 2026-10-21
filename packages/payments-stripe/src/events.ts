/**
 * @file Verified Stripe Event (https://docs.stripe.com/api/events/object) → `WebhookFact`s.
 *
 * Every fact is keyed by the PaymentIntent id, because that is the `providerRef` the kernel holds
 * for a payment. Refund and dispute events carry the refund/dispute object, so their evidence is a
 * `PaymentEvidence` for the intent with `status: "succeeded"` — a refund or a dispute exists only
 * on a captured charge — holding the one refund or dispute. Missing refunds are never deleted by
 * the writer, so a one-refund snapshot is safe.
 *
 * An object we cannot read in full still yields a fact WITHOUT evidence when its intent id is
 * known: the ingest worker then calls `retrieve`. An event with no intent id (a charge made
 * without a PaymentIntent) yields no fact; an event type we do not handle yields none either.
 */
import type { PaymentEvidence, WebhookFact } from "@jini-ai/commerce/payments/kernel";
import { moneyFromStripe } from "./amounts.js";
import { isRecord, optionalCount, optionalString, idOf, type JsonObject } from "./json.js";
import { disputeEvidence, intentEvidence, readAll, refundEvidence } from "./objects.js";

/** The envelope fields this module reads. */
export interface StripeEvent {
  readonly id: string;
  readonly type: string;
  /** Unix seconds. */
  readonly created: number;
  readonly livemode: boolean;
  readonly object: JsonObject;
}

/** The envelope, or `undefined` when the body is not a Stripe Event. */
export function parseStripeEvent({ body }: { body: unknown }, _optional: Record<string, never> = {}): StripeEvent | undefined {
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.object)) return undefined;
  const id = optionalString(body.id);
  const type = optionalString(body.type);
  const created = optionalCount(body.created);
  if (id === undefined || type === undefined || created === undefined || typeof body.livemode !== "boolean") return undefined;
  return { id, type, created, livemode: body.livemode, object: body.data.object };
}

/** Evidence for the intent that holds a refund or dispute (see the file header for why `succeeded`). */
function holderEvidence(
  providerRef: string,
  parts: Pick<PaymentEvidence, "refunds" | "disputes"> & Pick<Partial<PaymentEvidence>, "captured">
): PaymentEvidence {
  return { providerRef, status: "succeeded", ...parts };
}

type Translation = { readonly providerRef: string; readonly evidence?: PaymentEvidence } | undefined;

function fromIntent(object: JsonObject): Translation {
  const providerRef = optionalString(object.id);
  const evidence = intentEvidence({ intent: object });
  return providerRef === undefined ? undefined : { providerRef, ...(evidence === undefined ? {} : { evidence }) };
}

function fromRefund(object: JsonObject): Translation {
  const providerRef = idOf(object.payment_intent);
  const refund = refundEvidence({ refund: object });
  if (providerRef === undefined) return undefined;
  return { providerRef, ...(refund === undefined ? {} : { evidence: holderEvidence(providerRef, { refunds: [refund], disputes: [] }) }) };
}

/** `charge.refunded` carries a Charge; its `refunds` list is present only when Stripe includes it. */
function fromChargeRefunded(object: JsonObject): Translation {
  const providerRef = idOf(object.payment_intent);
  if (providerRef === undefined) return undefined;
  const list = isRecord(object.refunds) && Array.isArray(object.refunds.data) ? object.refunds.data : undefined;
  const refunds = list === undefined ? undefined : readAll({ items: list, read: (refund) => refundEvidence({ refund }) });
  const captured = moneyFromStripe({ amount: object.amount_captured, currency: object.currency });
  if (refunds === undefined || captured === undefined) return { providerRef };
  return { providerRef, evidence: holderEvidence(providerRef, { captured, refunds, disputes: [] }) };
}

function fromDispute(object: JsonObject): Translation {
  const providerRef = idOf(object.payment_intent);
  const dispute = disputeEvidence({ dispute: object });
  if (providerRef === undefined) return undefined;
  return { providerRef, ...(dispute === undefined ? {} : { evidence: holderEvidence(providerRef, { refunds: [], disputes: [dispute] }) }) };
}

/** Ordered event-type routes; the first match translates the object. */
const ROUTES: ReadonlyArray<readonly [(type: string) => boolean, (object: JsonObject) => Translation]> = [
  [(type) => type.startsWith("payment_intent."), fromIntent],
  [(type) => type === "charge.refunded", fromChargeRefunded],
  [(type) => type.startsWith("refund.") || type === "charge.refund.updated", fromRefund],
  [(type) => type.startsWith("charge.dispute."), fromDispute],
];

/**
 * The facts one verified event carries (zero or one).
 * @complexity O(r) in the refunds an event lists.
 */
export function stripeEventFacts({ event }: { event: StripeEvent }, _optional: Record<string, never> = {}): WebhookFact[] {
  const translation = ROUTES.find(([matches]) => matches(event.type))?.[1](event.object);
  if (translation === undefined) return [];
  return [{ providerEventId: event.id, occurredAt: event.created * 1000, ...translation }];
}
