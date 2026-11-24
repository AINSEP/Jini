import assert from "node:assert/strict";
import { test } from "vitest";

import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import { adaptWebhookHttpClient, enqueueDelivery, processDueDeliveries } from "../delivery.js";
import { InMemoryDeliveryEnvelopeStore, InMemoryWebhookDeliveryRepo, InMemoryWebhookSubscriptionRepo } from "../repo.memory.js";
import { createFixedSecretSigner, verifySignature } from "../signing.js";
import { createSubscription } from "../subscriptions.js";

/** A host's own header vocabulary: the binding must put exactly these names on the wire. */
const HOST_HEADERS = { signature: "acme-signature", deliveryId: "acme-delivery-id", eventId: "acme-event-id" };

function recordingClient(): { calls: HttpRequest[]; send(request: HttpRequest): Promise<HttpResponse> } {
  const calls: HttpRequest[] = [];
  return { calls, send: async request => { calls.push(request); return { status: 200, headers: {}, bodyText: "ok" }; } };
}

test("processDueDeliveries signs and POSTs with the host's injected header names and ISO clock", async () => {
  const clock = { nowIso: () => new Date().toISOString() };
  let next = 0;
  const idGenerator = { newId: () => `id-${++next}` };
  const subscriptionRepo = new InMemoryWebhookSubscriptionRepo({ assertVersionedWrite });
  const deliveryRepo = new InMemoryWebhookDeliveryRepo();
  const envelopeStore = new InMemoryDeliveryEnvelopeStore();
  const { subscription } = await createSubscription({
    deps: { clock, repo: subscriptionRepo, idGenerator, isAllowedTarget: async () => true },
    input: { workspaceId: "workspace-1", ownerPrincipalId: "principal-1", label: "Endpoint", targetUrl: "https://example.com/hooks", topics: ["post.published"], createdByPrincipalId: "principal-1" },
  });
  const secret = Buffer.from("shared-secret");
  const signer = createFixedSecretSigner({ secrets: new Map([[subscription.id, secret]]) });
  const { enqueued } = await enqueueDelivery({
    deps: { subscriptionRepo, deliveryRepo, envelopeStore, idGenerator, clock },
    input: { event: { id: "event-1", name: "post.published", workspaceId: "workspace-1", occurredAt: clock.nowIso(), payload: { id: "post-1" } } },
  });
  const httpClient = recordingClient();

  const result = await processDueDeliveries({ deps: { deliveryRepo, subscriptionRepo, envelopeStore, httpClient, signer, clock, headers: HOST_HEADERS } });

  assert.equal(result.delivered, 1);
  const request = httpClient.calls[0]!;
  assert.equal(request.headers["acme-delivery-id"], enqueued[0]!.id);
  assert.equal(request.headers["acme-event-id"], "event-1");
  assert.equal(verifySignature({ secret, rawBody: request.body as string, header: request.headers["acme-signature"]!, toleranceSeconds: 300 }), true);
});

test("the HTTP adapter refuses a per-request redirect control instead of ignoring it", () => {
  const adapted = adaptWebhookHttpClient({ httpClient: recordingClient() });
  const request: HttpRequest = { method: "POST", url: "https://example.com/hooks", headers: {}, timeoutMs: 5000, body: "{}" };
  assert.throws(() => adapted.send({ request }, { redirect: "follow" }), /does not support per-request redirect controls/);
});
