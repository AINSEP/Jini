import type { PaymentMode, WebhookFact } from "@jini-ai/commerce/payments/kernel";
import { readSession } from "./session-reading.js";

export type Translation = { kind: "facts"; facts: readonly WebhookFact[] } | { kind: "ignored" } | { kind: "malformed"; reason: string };
interface EventEnvelope { id: string; type: string; created: number; livemode: unknown; object: Record<string, unknown> }

/** Narrows untrusted JSON to records, never arrays or primitives. O(1) time/space. */
function record({ value }: { value: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Reads the event's required envelope fields without coercion; null means malformed. O(1). */
function readEnvelope({ event }: { event: unknown }, _optional: Record<string, never> = {}): EventEnvelope | null {
  const envelope = record({ value: event }) ?? {};
  const data = record({ value: envelope.data }) ?? {};
  const { id, type, created } = envelope;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof type !== "string" || type.length === 0) return null;
  if (typeof created !== "number") return null;
  const object = record({ value: data.object });
  if (object === null) return null;
  return { id, type, created, livemode: envelope.livemode, object };
}

/** Classifies an already signature-verified event without I/O or input mutation.
 * @returns Stable inbox facts, ignored foreign/unsupported events, or a malformed reason.
 * @complexity O(n) in the session's currency text; constant fields and at most one fact.
 * @example translateStripeEvent({ event, mode: ctx.account.mode }) */
export function translateStripeEvent(
  { event, mode }: { event: unknown; mode: PaymentMode }, _optional: Record<string, never> = {}
): Translation {
  const supportedEvents = new Set(["checkout.session.completed", "checkout.session.expired",
    "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"]);
  const envelope = readEnvelope({ event });
  if (envelope === null || !Number.isFinite(envelope.created * 1000)) return { kind: "malformed", reason: "invalid event envelope" };
  if (envelope.livemode !== (mode === "live")) return { kind: "malformed", reason: "event mode differs from account" };
  if (!supportedEvents.has(envelope.type)) return { kind: "ignored" };
  const reading = readSession({ object: envelope.object, mode }, { eventType: envelope.type });
  if (reading.kind === "foreign") return { kind: "ignored" };
  if (reading.kind === "malformed") return reading;
  const providerRef = reading.kind === "id_only" ? reading.sessionId : reading.evidence.providerRef;
  const fact = { providerEventId: envelope.id, providerRef, occurredAt: envelope.created * 1000 };
  if (reading.kind === "id_only") return { kind: "facts", facts: [fact] };
  return { kind: "facts", facts: [{ ...fact, evidence: reading.evidence }] };
}
