import { nowIso } from "@jini-ai/core/primitives";
import { expect, test } from "vitest";
import { createFixedSecretSigner, processDueDeliveries, signPayload, verifySignature, type WebhookHeaderVocabulary } from "../index.js";
import { createSubscription } from "../subscriptions.js";
import { enqueueDelivery } from "../delivery.js";
import { InMemoryWebhookSubscriptionRepo, InMemoryWebhookDeliveryRepo, InMemoryDeliveryEnvelopeStore, RecordingHttpClient } from "./memory-fixtures.js";

const secret = Buffer.from("fixture-signing-secret");
const rawBody = '{"hello":"world"}';
const timestampSeconds = 1_700_000_000;
const vocabulary = { timestampField: "timestamp", signatureField: "digest" };

test("custom signing vocabulary retains the pinned HMAC content and verifies", () => {
  const baseline = signPayload({ secret, rawBody, timestampSeconds, vocabulary: { timestampField: "t", signatureField: "v1" } });
  const treatment = signPayload({ secret, rawBody, timestampSeconds, vocabulary });
  expect(baseline).toBe("t=1700000000,v1=4cfe58cf6c629d8bede73d8c70ff603f10629066e09469e95caddd27210eef16");
  expect(treatment).toBe("timestamp=1700000000,digest=4cfe58cf6c629d8bede73d8c70ff603f10629066e09469e95caddd27210eef16");
  expect(verifySignature({ secret, rawBody, header: treatment, vocabulary, nowSeconds: timestampSeconds, toleranceSeconds: 0 })).toBe(true);
  expect(verifySignature({ secret, rawBody, header: treatment, vocabulary: { timestampField: "t", signatureField: "v1" }, nowSeconds: timestampSeconds, toleranceSeconds: 0 })).toBe(false);
});

test("verification rejects invalid clock/tolerance and malformed digest values", () => {
  const header = signPayload({ secret, rawBody, timestampSeconds, vocabulary });
  for (const [nowSeconds, toleranceSeconds] of [[NaN, 300], [timestampSeconds, -1], [timestampSeconds, NaN]]) {
    expect(verifySignature({ secret, rawBody, header, vocabulary, nowSeconds: nowSeconds!, toleranceSeconds: toleranceSeconds! })).toBe(false);
  }
  for (const digest of ["zz", "a", "abcd", ""]) {
    expect(verifySignature({ secret, rawBody, header: `timestamp=${timestampSeconds},digest=${digest}`, vocabulary, nowSeconds: timestampSeconds, toleranceSeconds: 0 })).toBe(false);
  }
});

async function deliver(headers: WebhookHeaderVocabulary) {
  let nextId = 0;
  const clock = { nowMs: () => timestampSeconds * 1000 };
  const idGenerator = { newId: () => `row-${++nextId}` };
  const subscriptionRepo = new InMemoryWebhookSubscriptionRepo();
  const deliveryRepo = new InMemoryWebhookDeliveryRepo();
  const envelopeStore = new InMemoryDeliveryEnvelopeStore();
  const { subscription } = await createSubscription({ deps: { repo: subscriptionRepo, clock, idGenerator, isAllowedTarget: async () => true }, input: { workspaceId: "workspace", ownerPrincipalId: "owner", createdByPrincipalId: "owner", label: "hook", targetUrl: "https://receiver.example/hook", topics: ["record.created"] } });
  await enqueueDelivery({ deps: { subscriptionRepo, deliveryRepo, envelopeStore, clock, idGenerator }, input: { event: { id: "event", workspaceId: "workspace", name: "record.created", occurredAt: nowIso({ clock }), payload: { value: 1 } } } });
  const signer = createFixedSecretSigner({ secrets: new Map([[subscription.id, secret]]), vocabulary });
  const httpClient = new RecordingHttpClient();
  const result = await processDueDeliveries({ deps: { subscriptionRepo, deliveryRepo, envelopeStore, clock, signer, httpClient, headers } });
  expect(result.delivered).toBe(1);
  return httpClient.calls[0]!.request;
}

test("two hosts change HTTP header vocabulary independently and use the injected signing clock", async () => {
  const baseline = await deliver({ signature: "first-signature", deliveryId: "first-delivery", eventId: "first-event" });
  const treatment = await deliver({ signature: "second-signature", deliveryId: "second-delivery", eventId: "second-event" });
  expect(baseline.headers["first-signature"]).toMatch(/^timestamp=1700000000,digest=/);
  expect(treatment.headers["first-signature"]).toBeUndefined();
  expect(treatment.headers["second-event"]).toBe("event");
  expect(verifySignature({ secret, rawBody: treatment.body!, header: treatment.headers["second-signature"]!, vocabulary, nowSeconds: timestampSeconds, toleranceSeconds: 0 })).toBe(true);
});
