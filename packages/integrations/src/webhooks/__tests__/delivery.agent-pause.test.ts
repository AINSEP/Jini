import assert from "node:assert/strict";
import { test } from "vitest";

import { enqueueDelivery, processDueDeliveries } from "../delivery.js";
import { createFixedSecretSigner } from "../signing.js";
import { createSubscription } from "../subscriptions.js";
import type { WebhookSubscriptionRecord } from "../types.js";
import {
  InMemoryDeliveryEnvelopeStore,
  InMemoryWebhookDeliveryRepo,
  InMemoryWebhookSubscriptionRepo,
  RecordingHttpClient,
} from "./memory-fixtures.js";

/*
 * Owner decision: when the host's agent (assistant) switch is off, deliveries for subscriptions
 * an AGENT created are paused — kept pending, never failed, dead-lettered or deleted — while
 * subscriptions a person created keep delivering. A row with no recorded creator predates the
 * column and counts as person-created, so nothing an owner made is ever paused.
 */
const headers = { signature: "sig", deliveryId: "delivery-id", eventId: "event-id" };
const vocabulary = { timestampField: "t", signatureField: "v1" };

function makeRig() {
  let time = Date.parse("2026-07-10T00:00:00.000Z");
  let idCounter = 0;
  const agent = { enabled: false };
  const rig = {
    agent,
    clock: { nowMs: () => time },
    advanceMs: (ms: number) => { time += ms; },
    idGenerator: { newId: () => `id-${++idCounter}` },
    subscriptionRepo: new InMemoryWebhookSubscriptionRepo(),
    deliveryRepo: new InMemoryWebhookDeliveryRepo(),
    envelopeStore: new InMemoryDeliveryEnvelopeStore(),
    httpClient: new RecordingHttpClient(),
  };
  return rig;
}
type Rig = ReturnType<typeof makeRig>;

async function seed(rig: Rig, label: string, createdByKind?: "person" | "agent") {
  const { subscription } = await createSubscription({
    deps: { clock: rig.clock, repo: rig.subscriptionRepo, idGenerator: rig.idGenerator, isAllowedTarget: async () => true },
    input: {
      workspaceId: "workspace-1", ownerPrincipalId: "principal-1", label,
      targetUrl: `https://example.com/${label}`, topics: ["post.published"], createdByPrincipalId: "principal-1",
    },
  }, createdByKind ? { createdByKind } : {});
  return subscription;
}

/** A subscription row written before creator attribution existed: no `createdByKind` at all. */
async function seedLegacy(rig: Rig): Promise<WebhookSubscriptionRecord> {
  const legacy = await seed(rig, "legacy");
  const { createdByKind: _dropped, ...withoutCreator } = legacy;
  await rig.subscriptionRepo.save(withoutCreator as WebhookSubscriptionRecord);
  return withoutCreator as WebhookSubscriptionRecord;
}

async function publish(rig: Rig, eventId: string) {
  await enqueueDelivery({
    deps: { subscriptionRepo: rig.subscriptionRepo, deliveryRepo: rig.deliveryRepo, envelopeStore: rig.envelopeStore, idGenerator: rig.idGenerator, clock: rig.clock },
    input: { event: { id: eventId, name: "post.published", workspaceId: "workspace-1", occurredAt: "2026-07-10T00:00:00.000Z", payload: {} } },
  });
}

async function tick(rig: Rig, subs: readonly WebhookSubscriptionRecord[]) {
  const signer = createFixedSecretSigner({ secrets: new Map(subs.map((s) => [s.id, Buffer.from("k")])), vocabulary });
  return processDueDeliveries({
    deps: { deliveryRepo: rig.deliveryRepo, subscriptionRepo: rig.subscriptionRepo, envelopeStore: rig.envelopeStore, httpClient: rig.httpClient, signer, headers, clock: rig.clock },
  }, { isAgentEnabled: () => rig.agent.enabled });
}

const urls = (rig: Rig) => rig.httpClient.calls.map((call) => call.request.url);

test("with the assistant off, an agent-created webhook receives no delivery; a person-created one still does", async () => {
  const rig = makeRig();
  const agentSub = await seed(rig, "agent", "agent");
  const personSub = await seed(rig, "person");
  await publish(rig, "event-1");

  const result = await tick(rig, [agentSub, personSub]);

  assert.deepEqual(urls(rig), ["https://example.com/person"]);
  assert.deepEqual(result, { processed: 2, delivered: 1, failed: 0, dead: 0, paused: 1 });
  // Paused, not deleted: the subscription stays active and its delivery stays pending, unattempted.
  assert.equal((await rig.subscriptionRepo.findById({ workspaceId: "workspace-1", id: agentSub.id }))?.status, "active");
  const [held] = await rig.deliveryRepo.listBySubscription({ workspaceId: "workspace-1", subscriptionId: agentSub.id, limit: 10 });
  assert.equal(held?.status, "pending");
  assert.equal(held?.attempts, 0);
  assert.equal(held?.lastError, null);
  assert.equal((await rig.subscriptionRepo.listByWorkspace({ workspaceId: "workspace-1" })).length, 2);
});

test("turning the assistant on again resumes the held agent delivery", async () => {
  const rig = makeRig();
  const agentSub = await seed(rig, "agent", "agent");
  await publish(rig, "event-1");
  await tick(rig, [agentSub]);
  // Several ticks while off: the held row never burns an attempt or dead-letters.
  for (let i = 0; i < 12; i += 1) { rig.advanceMs(10 * 60_000); await tick(rig, [agentSub]); }
  assert.equal(rig.httpClient.calls.length, 0);

  rig.agent.enabled = true;
  rig.advanceMs(10 * 60_000);
  const result = await tick(rig, [agentSub]);

  assert.deepEqual(urls(rig), ["https://example.com/agent"]);
  assert.deepEqual(result, { processed: 1, delivered: 1, failed: 0, dead: 0 });
  const [row] = await rig.deliveryRepo.listBySubscription({ workspaceId: "workspace-1", subscriptionId: agentSub.id, limit: 10 });
  assert.equal(row?.status, "delivered");
  assert.equal(row?.attempts, 1);
});

test("a subscription row with no recorded creator is treated as person-created and keeps delivering", async () => {
  const rig = makeRig();
  const legacy = await seedLegacy(rig);
  assert.equal(legacy.createdByKind, undefined);
  await publish(rig, "event-1");

  await tick(rig, [legacy]);

  assert.deepEqual(urls(rig), ["https://example.com/legacy"]);
});

test("new subscriptions record who created them: person by default, agent when the agent path says so", async () => {
  const rig = makeRig();
  assert.equal((await seed(rig, "default")).createdByKind, "person");
  assert.equal((await seed(rig, "agent", "agent")).createdByKind, "agent");
});

test("without an agent switch wired, agent-created subscriptions deliver as before", async () => {
  const rig = makeRig();
  const agentSub = await seed(rig, "agent", "agent");
  await publish(rig, "event-1");
  const signer = createFixedSecretSigner({ secrets: new Map([[agentSub.id, Buffer.from("k")]]), vocabulary });
  await processDueDeliveries({ deps: { deliveryRepo: rig.deliveryRepo, subscriptionRepo: rig.subscriptionRepo, envelopeStore: rig.envelopeStore, httpClient: rig.httpClient, signer, headers, clock: rig.clock } });
  assert.deepEqual(urls(rig), ["https://example.com/agent"]);
});
