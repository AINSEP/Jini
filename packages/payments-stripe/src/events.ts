/**
 * @file Verified Stripe Event (https://docs.stripe.com/api/events/object) → `WebhookFact`s.
 *
 * Every fact is keyed by the PaymentIntent id, because that is the `providerRef` the kernel holds
 * for a payment. `payment_intent.*` events carry the intent, and `charge.refunded` carries the
 * charge with `amount_captured` and its refunds, so both become evidence. Refund and dispute
 * events (`refund.*`, `charge.refund.updated`, `charge.dispute.*`) become facts WITHOUT evidence:
 * their objects say nothing about how much was captured, so the ingest worker `retrieve`s the full
 * snapshot instead (coordinator decision, L6a).
 *
 * An object we cannot read in full still yields a fact without evidence when its intent id is
 * known. An event with no intent id (a charge made without a PaymentIntent) yields no fact; an
 * event type we do not handle yields none either.
 */
import type { PaymentEvidence, WebhookFact } from "@jini-ai/commerce/payments/kernel";
import { moneyFromStripe } from "./amounts.js";
import { isRecord, optionalCount, optionalString, idOf, type JsonObject } from "./json.js";
import { intentEvidence, readAll, refundEvidence } from "./objects.js";

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

type Translation = { readonly providerRef: string; readonly evidence?: PaymentEvidence } | undefined;

function fromIntent(object: JsonObject): Translation {
  const providerRef = optionalString(object.id);
  const evidence = intentEvidence({ intent: object });
  return providerRef === undefined ? undefined : { providerRef, ...(evidence === undefined ? {} : { evidence }) };
}

// No `captured` on these objects: guessing it from "a refund exists" overstates a partial capture, so retrieve.
function idsOnly(object: JsonObject): Translation {
  const providerRef = idOf(object.payment_intent);
  return providerRef === undefined ? undefined : { providerRef };
}

/** `charge.refunded` carries a Charge; its `refunds` list is present only when Stripe includes it. */
function fromChargeRefunded(object: JsonObject): Translation {
  const providerRef = idOf(object.payment_intent);
  if (providerRef === undefined) return undefined;
  const list = isRecord(object.refunds) && Array.isArray(object.refunds.data) ? object.refunds.data : undefined;
  const refunds = list === undefined ? undefined : readAll({ items: list, read: (refund) => refundEvidence({ refund }) });
  const captured = moneyFromStripe({ amount: object.amount_captured, currency: object.currency });
  if (refunds === undefined || captured === undefined) return { providerRef };
  // A refund exists only on a captured charge, so the intent is `succeeded`.
  return { providerRef, evidence: { providerRef, status: "succeeded", captured, refunds, disputes: [] } };
}

/** Ordered event-type routes; the first match translates the object. */
const ROUTES: ReadonlyArray<readonly [(type: string) => boolean, (object: JsonObject) => Translation]> = [
  [(type) => type.startsWith("payment_intent."), fromIntent],
  [(type) => type === "charge.refunded", fromChargeRefunded],
  [(type) => type.startsWith("refund.") || type === "charge.refund.updated", idsOnly],
  [(type) => type.startsWith("charge.dispute."), idsOnly],
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
