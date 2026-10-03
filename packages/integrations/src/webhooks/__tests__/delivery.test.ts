import { nowIso } from "@jini-ai/core/primitives";
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  computeBackoffMs,
  enqueueDelivery,
  MAX_DELIVERY_ATTEMPTS,
  processDueDeliveries,
} from "../delivery.js";
import { RecordingHttpClient } from "./memory-fixtures.js";
import {
  InMemoryDeliveryEnvelopeStore,
  InMemoryWebhookDeliveryRepo,
  InMemoryWebhookSubscriptionRepo,
} from "./memory-fixtures.js";
import { createFixedSecretSigner, verifySignature } from "../signing.js";
import { createSubscription, pauseSubscription } from "../subscriptions.js";
import type { WebhookBeforeDispatchHook } from "../types.js";

const vocabulary = { timestampField: "t", signatureField: "v1" };
const headers = { signature: "receiver-signature", deliveryId: "receiver-delivery-id", eventId: "receiver-event-id" };

function makeRig(options: { nowIso?: string } = {}) {
  let time = Date.parse(options.nowIso ?? "2026-07-10T00:00:00.000Z");
  const clock = { nowMs: () => time };
  const advanceHours = (hours: number) => {
    time += hours * 60 * 60 * 1000;
  };

  let idCounter = 0;
  const idGenerator = { newId: () => `id-${++idCounter}` };

  const subscriptionRepo = new InMemoryWebhookSubscriptionRepo();
  const deliveryRepo = new InMemoryWebhookDeliveryRepo();
  const envelopeStore = new InMemoryDeliveryEnvelopeStore();

  return { clock, advanceHours, idGenerator, subscriptionRepo, deliveryRepo, envelopeStore };
}

async function seedActiveSubscription(rig: ReturnType<typeof makeRig>, secret: Buffer) {
  const { subscription } = await createSubscription({
    deps: {
      clock: rig.clock,
      repo: rig.subscriptionRepo,
      idGenerator: rig.idGenerator,
      isAllowedTarget: async () => true,
    },
    input: {
      workspaceId: "workspace-1",
      ownerPrincipalId: "principal-1",
      label: "Endpoint",
      targetUrl: "https://example.com/hooks",
      topics: ["post.published"],
      createdByPrincipalId: "principal-1",
    },
  });

  const signer = createFixedSecretSigner({ secrets: new Map([[subscription.id, secret]]), vocabulary });
  return { subscription, signer };
}

test("enqueueDelivery enqueues one row per matching active subscription and is idempotent per (event, subscription)", async () => {
  const rig = makeRig();
  const { subscription: subA } = await seedActiveSubscription(rig, Buffer.from("secret-a"));
  await createSubscription({
    deps: {
      clock: rig.clock,
      repo: rig.subscriptionRepo,
      idGenerator: rig.idGenerator,
      isAllowedTarget: async () => true,
    },
    input: {
      workspaceId: "workspace-1",
      ownerPrincipalId: "principal-1",
      label: "Second endpoint",
      targetUrl: "https://example.com/other-hooks",
      topics: ["comment.created"],
      createdByPrincipalId: "principal-1",
    },
  });

  const event = {
    id: "event-1",
    name: "post.published",
    workspaceId: "workspace-1",
    occurredAt: "2026-07-10T00:00:00.000Z",
    payload: { id: "post-1", title: "Hello" },
  };

  const first = await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: { event },
  });

  assert.equal(first.enqueued.length, 1);
  assert.equal(first.enqueued[0]!.subscriptionId, subA.id);
  const second = await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: { event },
  });
  assert.equal(second.enqueued.length, 0);

  const all = await rig.deliveryRepo.listBySubscription({
    workspaceId: "workspace-1",
    subscriptionId: subA.id,
    limit: 100,
  });
  assert.equal(all.length, 1);
});

test("processDueDeliveries signs, POSTs, and marks a successful attempt delivered", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { subscription, signer } = await seedActiveSubscription(rig, secret);

  const { enqueued } = await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: {
      event: {
        id: "event-1",
        name: "post.published",
        workspaceId: "workspace-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        payload: { id: "post-1" },
      },
    },
  });

  const httpClient = new RecordingHttpClient({ responses: [{ status: 200, headers: {}, bodyText: "ok" }] });

  const result = await processDueDeliveries({
    deps: {
      deliveryRepo: rig.deliveryRepo,
      subscriptionRepo: rig.subscriptionRepo,
      envelopeStore: rig.envelopeStore,
      httpClient,
      signer,
      clock: rig.clock,
      headers,
    },
  });

  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.dead, 0);
  assert.equal(httpClient.calls.length, 1);
  assert.equal(httpClient.calls[0]!.request.url, subscription.targetUrl);
  assert.match(httpClient.calls[0]!.request.headers["receiver-signature"]!, /^t=\d+,v1=[0-9a-f]{64}$/);
  const request = httpClient.calls[0]!.request;
  assert.equal(request.method, "POST");
  assert.equal(request.timeoutMs, 10_000);
  assert.equal(request.headers["content-type"], "application/json");
  assert.equal(request.headers["receiver-delivery-id"], enqueued[0]!.id);
  assert.equal(request.headers["receiver-event-id"], "event-1");
  assert.ok(request.body);
  assert.deepEqual(JSON.parse(request.body), {
    deliveryId: enqueued[0]!.id,
    eventId: "event-1",
    topic: "post.published",
    workspaceId: "workspace-1",
    occurredAt: "2026-07-10T00:00:00.000Z",
    data: { id: "post-1" },
  });
  assert.equal(verifySignature({ vocabulary, nowSeconds: Date.parse(nowIso({ clock: rig.clock })) / 1000, secret, rawBody: request.body, header: request.headers["receiver-signature"]!, toleranceSeconds: 300 }), true);

  const deliveries = await rig.deliveryRepo.listBySubscription({
    workspaceId: "workspace-1",
    subscriptionId: subscription.id,
    limit: 10,
  });
  assert.equal(deliveries[0]!.status, "delivered");
  assert.equal(deliveries[0]!.lastResponseStatus, 200);
});

test("a non-2xx response schedules a backoff retry rather than dead-lettering immediately", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { subscription, signer } = await seedActiveSubscription(rig, secret);

  await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: {
      event: {
        id: "event-1",
        name: "post.published",
        workspaceId: "workspace-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        payload: { id: "post-1" },
      },
    },
  });

  const httpClient = new RecordingHttpClient({ responses: [{ status: 500, headers: {}, bodyText: "boom" }] });

  const worker = {
    deps: {
      deliveryRepo: rig.deliveryRepo,
      subscriptionRepo: rig.subscriptionRepo,
      envelopeStore: rig.envelopeStore,
      httpClient,
      signer,
      clock: rig.clock,
      headers,
    },
  };
  const firstAttemptAt = nowIso({ clock: rig.clock });
  const result = await processDueDeliveries(worker, { random: () => 0 });

  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.dead, 0);

  const deliveries = await rig.deliveryRepo.listBySubscription({
    workspaceId: "workspace-1",
    subscriptionId: subscription.id,
    limit: 10,
  });
  assert.equal(deliveries[0]!.status, "pending");
  assert.equal(deliveries[0]!.attempts, 1);
  assert.equal(deliveries[0]!.lastResponseStatus, 500);
  assert.ok(deliveries[0]!.nextAttemptAt > "2026-07-10T00:00:00.000Z");
  assert.equal(deliveries[0]!.nextAttemptAt, new Date(Date.parse(firstAttemptAt) + 150_000).toISOString());
  rig.advanceHours(1);
  const secondAttemptAt = nowIso({ clock: rig.clock });
  const secondResult = await processDueDeliveries(worker, { random: () => 0 });
  assert.equal(secondResult.failed, 1);
  const retried = await rig.deliveryRepo.findById({ workspaceId: "workspace-1", id: deliveries[0]!.id });
  assert.equal(retried?.attempts, 2);
  assert.equal(retried?.nextAttemptAt, new Date(Date.parse(secondAttemptAt) + 300_000).toISOString());
});

for (const status of [199, 204, 299, 301, 302, 404]) {
  test(`HTTP ${status} is ${status >= 200 && status < 300 ? "delivered" : "retried"}`, async () => {
    const rig = makeRig();
    const { signer } = await seedActiveSubscription(rig, Buffer.from("shared-secret"));
    const { enqueued } = await enqueueDelivery({
      deps: { subscriptionRepo: rig.subscriptionRepo, deliveryRepo: rig.deliveryRepo, envelopeStore: rig.envelopeStore, idGenerator: rig.idGenerator, clock: rig.clock },
      input: { event: { id: "event-1", name: "post.published", workspaceId: "workspace-1", occurredAt: nowIso({ clock: rig.clock }), payload: { id: "post-1" } } },
    });
    const httpClient = new RecordingHttpClient({ responses: [{ status, headers: {}, bodyText: "" }] });
    const result = await processDueDeliveries({
      deps: { deliveryRepo: rig.deliveryRepo, subscriptionRepo: rig.subscriptionRepo, envelopeStore: rig.envelopeStore, httpClient, signer, clock: rig.clock, headers },
    });
    const successful = status >= 200 && status < 300;
    assert.deepEqual(result, { delivered: successful ? 1 : 0, failed: successful ? 0 : 1, dead: 0, processed: 1 });
    const row = await rig.deliveryRepo.findById({ workspaceId: "workspace-1", id: enqueued[0]!.id });
    assert.equal(row?.status, successful ? "delivered" : "pending");
    assert.equal(row?.lastResponseStatus, status);
    assert.equal(row?.attempts, 1);
    if (!successful) assert.match(row?.lastError ?? "", new RegExp(`non-2xx response: ${status}`));
  });
}

for (const message of ["connection reset", "request timed out"]) {
  test(`transport failure (${message}) schedules a retry with no response status`, async () => {
    const rig = makeRig();
    const { signer } = await seedActiveSubscription(rig, Buffer.from("shared-secret"));
    const { enqueued } = await enqueueDelivery({
      deps: { subscriptionRepo: rig.subscriptionRepo, deliveryRepo: rig.deliveryRepo, envelopeStore: rig.envelopeStore, idGenerator: rig.idGenerator, clock: rig.clock },
      input: { event: { id: "event-1", name: "post.published", workspaceId: "workspace-1", occurredAt: nowIso({ clock: rig.clock }), payload: { id: "post-1" } } },
    });
    const httpClient = new RecordingHttpClient({ responses: [() => { throw new Error(message); }] });
    const result = await processDueDeliveries({
      deps: { deliveryRepo: rig.deliveryRepo, subscriptionRepo: rig.subscriptionRepo, envelopeStore: rig.envelopeStore, httpClient, signer, clock: rig.clock, headers },
    }, { random: () => 0 });
    assert.equal(result.failed, 1);
    assert.equal(result.delivered, 0);
    assert.equal(result.dead, 0);
    assert.equal(httpClient.calls.length, 1);
    const row = await rig.deliveryRepo.findById({ workspaceId: "workspace-1", id: enqueued[0]!.id });
    assert.equal(row?.status, "pending");
    assert.equal(row?.attempts, 1);
    assert.equal(row?.lastResponseStatus, null);
    assert.equal(row?.lastError, message);
    assert.equal(row?.nextAttemptAt, new Date(Date.parse(nowIso({ clock: rig.clock })) + 150_000).toISOString());
  });
}

test("repeated failures exhaust maxAttempts and transition the delivery to dead", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { subscription, signer } = await seedActiveSubscription(rig, secret);

  await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: {
      event: {
        id: "event-1",
        name: "post.published",
        workspaceId: "workspace-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        payload: { id: "post-1" },
      },
    },
  });

  const httpClient = new RecordingHttpClient({ responses: [{ status: 503, headers: {}, bodyText: "down" }] });
  const maxAttempts = 3;

  let lastResult;
  for (let i = 0; i < maxAttempts; i += 1) {
    lastResult = await processDueDeliveries(
      {
        deps: {
          deliveryRepo: rig.deliveryRepo,
          subscriptionRepo: rig.subscriptionRepo,
          envelopeStore: rig.envelopeStore,
          httpClient,
          signer,
          clock: rig.clock,
          headers,
        },
      },
      { maxAttempts }
    );
    rig.advanceHours(7);
  }

  assert.equal(httpClient.calls.length, maxAttempts);
  assert.equal(lastResult?.dead, 1);
  assert.equal(lastResult?.failed, 0);

  const deliveries = await rig.deliveryRepo.listBySubscription({
    workspaceId: "workspace-1",
    subscriptionId: subscription.id,
    limit: 10,
  });
  assert.equal(deliveries[0]!.status, "dead");
  assert.equal(deliveries[0]!.attempts, maxAttempts);
  assert.ok(deliveries[0]!.deadAt);
});

test("MAX_DELIVERY_ATTEMPTS default is 8 per ADR-036 §4", () => {
  assert.equal(MAX_DELIVERY_ATTEMPTS, 8);
});

test("a throwing beforeDispatch hook fails the attempt (retry) and never reaches the HTTP client", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { subscription, signer } = await seedActiveSubscription(rig, secret);

  await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: {
      event: {
        id: "event-1",
        name: "post.published",
        workspaceId: "workspace-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        payload: { id: "post-1", email: "user@example.com" },
      },
    },
  });

  const httpClient = new RecordingHttpClient();
  const throwingHook: WebhookBeforeDispatchHook = {
    priority: 0,
    handle: async () => {
      throw new Error("redaction filter crashed");
    },
  };

  const result = await processDueDeliveries(
    {
      deps: {
        deliveryRepo: rig.deliveryRepo,
        subscriptionRepo: rig.subscriptionRepo,
        envelopeStore: rig.envelopeStore,
        httpClient,
        signer,
        clock: rig.clock,
        headers,
      },
    },
    { hooks: [throwingHook] }
  );
  assert.equal(httpClient.calls.length, 0);
  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);

  const deliveries = await rig.deliveryRepo.listBySubscription({
    workspaceId: "workspace-1",
    subscriptionId: subscription.id,
    limit: 10,
  });
  assert.equal(deliveries[0]!.status, "pending");
  assert.match(deliveries[0]!.lastError ?? "", /redaction filter crashed/);
});

test("an explicit beforeDispatch veto (send: false) also fails closed without dispatching", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { subscription, signer } = await seedActiveSubscription(rig, secret);

  await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: {
      event: {
        id: "event-1",
        name: "post.published",
        workspaceId: "workspace-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        payload: { id: "post-1" },
      },
    },
  });

  const httpClient = new RecordingHttpClient();
  const vetoingHook: WebhookBeforeDispatchHook = {
    priority: 0,
    handle: async () => ({ send: false }),
  };

  const result = await processDueDeliveries(
    {
      deps: {
        deliveryRepo: rig.deliveryRepo,
        subscriptionRepo: rig.subscriptionRepo,
        envelopeStore: rig.envelopeStore,
        httpClient,
        signer,
        clock: rig.clock,
        headers,
      },
    },
    { hooks: [vetoingHook] }
  );

  assert.equal(httpClient.calls.length, 0);
  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);

  const deliveries = await rig.deliveryRepo.listBySubscription({
    workspaceId: "workspace-1",
    subscriptionId: subscription.id,
    limit: 10,
  });
  assert.match(deliveries[0]!.lastError ?? "", /vetoed/);
});

test("hooks run in priority order and a later hook sees an earlier hook's redacted envelope", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { signer } = await seedActiveSubscription(rig, secret);

  await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: {
      event: {
        id: "event-1",
        name: "post.published",
        workspaceId: "workspace-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        payload: { id: "post-1", email: "user@example.com" },
      },
    },
  });

  const seenBySecondHook: unknown[] = [];
  const redactingHook: WebhookBeforeDispatchHook = {
    priority: 0,
    handle: async ({ envelope }) => ({
      send: true,
      envelope: { ...envelope, data: { ...envelope.data, email: "[redacted]" } },
    }),
  };
  const observingHook: WebhookBeforeDispatchHook = {
    priority: 10,
    handle: async ({ envelope }) => {
      seenBySecondHook.push(envelope.data.email);
      return { send: true };
    },
  };

  const httpClient = new RecordingHttpClient();

  await processDueDeliveries(
    {
      deps: {
        deliveryRepo: rig.deliveryRepo,
        subscriptionRepo: rig.subscriptionRepo,
        envelopeStore: rig.envelopeStore,
        httpClient,
        signer,
        clock: rig.clock,
        headers,
      },
    },
    { hooks: [observingHook, redactingHook] }
  );

  assert.deepEqual(seenBySecondHook, ["[redacted]"]);
  assert.match(httpClient.calls[0]!.request.body ?? "", /\[redacted\]/);
  assert.doesNotMatch(httpClient.calls[0]!.request.body ?? "", /user@example\.com/);
  const request = httpClient.calls[0]!.request;
  assert.ok(request.body);
  assert.equal(verifySignature({ vocabulary, nowSeconds: Date.parse(nowIso({ clock: rig.clock })) / 1000, secret, rawBody: request.body, header: request.headers["receiver-signature"]!, toleranceSeconds: 300 }), true);
});

test("computeBackoffMs stays within [half, full] of the exponential step and respects the cap", () => {
  const lower = computeBackoffMs({ attempts: 1 }, { random: () => 0 });
  const upper = computeBackoffMs({ attempts: 1 }, { random: () => 1 });
  assert.equal(lower, 150_000); // half of 5 minutes
  assert.equal(upper, 300_000); // full 5 minutes
  const fullSteps = [600_000, 1_200_000, 2_400_000, 4_800_000, 9_600_000, 19_200_000, 21_600_000];
  for (const [index, fullStep] of fullSteps.entries()) {
    assert.equal(computeBackoffMs({ attempts: index + 2 }, { random: () => 0 }), fullStep / 2);
    assert.equal(computeBackoffMs({ attempts: index + 2 }, { random: () => 1 }), fullStep);
  }
  const cappedLower = computeBackoffMs({ attempts: 20 }, { random: () => 0 });
  const cappedUpper = computeBackoffMs({ attempts: 20 }, { random: () => 1 });
  assert.equal(cappedLower, 10_800_000); // half of 6 hours
  assert.equal(cappedUpper, 21_600_000); // full 6 hours
});

test("a subscription paused after enqueue fails the attempt without dispatching", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { subscription, signer } = await seedActiveSubscription(rig, secret);

  await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: {
      event: {
        id: "event-1",
        name: "post.published",
        workspaceId: "workspace-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        payload: { id: "post-1" },
      },
    },
  });

  await pauseSubscription({
    deps: {
      clock: rig.clock,
      repo: rig.subscriptionRepo,
      idGenerator: rig.idGenerator,
      isAllowedTarget: async () => true,
    },
    input: { workspaceId: "workspace-1", id: subscription.id },
  });

  const httpClient = new RecordingHttpClient();

  const result = await processDueDeliveries({
    deps: {
      deliveryRepo: rig.deliveryRepo,
      subscriptionRepo: rig.subscriptionRepo,
      envelopeStore: rig.envelopeStore,
      httpClient,
      signer,
      clock: rig.clock,
      headers,
    },
  });

  assert.equal(httpClient.calls.length, 0);
  assert.equal(result.failed, 1);

  const deliveries = await rig.deliveryRepo.listBySubscription({
    workspaceId: "workspace-1",
    subscriptionId: subscription.id,
    limit: 10,
  });
  assert.match(deliveries[0]!.lastError ?? "", /is 'paused', not active/);
});

test("a claimed row whose subscription was hard-removed from the repo fails (subscription not found)", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { subscription, signer } = await seedActiveSubscription(rig, secret);

  await enqueueDelivery({
    deps: {
      subscriptionRepo: rig.subscriptionRepo,
      deliveryRepo: rig.deliveryRepo,
      envelopeStore: rig.envelopeStore,
      idGenerator: rig.idGenerator,
      clock: rig.clock,
    },
    input: {
      event: {
        id: "event-1",
        name: "post.published",
        workspaceId: "workspace-1",
        occurredAt: "2026-07-10T00:00:00.000Z",
        payload: { id: "post-1" },
      },
    },
  });
  const emptySubscriptionRepo = new InMemoryWebhookSubscriptionRepo();
  const httpClient = new RecordingHttpClient();

  const result = await processDueDeliveries({
    deps: {
      deliveryRepo: rig.deliveryRepo,
      subscriptionRepo: emptySubscriptionRepo,
      envelopeStore: rig.envelopeStore,
      httpClient,
      signer,
      clock: rig.clock,
      headers,
    },
  });

  assert.equal(httpClient.calls.length, 0);
  assert.equal(result.failed, 1);

  const deliveries = await rig.deliveryRepo.listBySubscription({
    workspaceId: "workspace-1",
    subscriptionId: subscription.id,
    limit: 10,
  });
  assert.match(deliveries[0]!.lastError ?? "", /was not found/);
});

test("a claimed row with no recorded envelope fails (envelope-store gap)", async () => {
  const rig = makeRig();
  const secret = Buffer.from("shared-secret");
  const { subscription, signer } = await seedActiveSubscription(rig, secret);
  await rig.deliveryRepo.enqueue({ record: {
    id: "delivery-no-envelope",
    workspaceId: "workspace-1",
    subscriptionId: subscription.id,
    eventId: "event-1",
    topic: "post.published",
    status: "pending",
    attempts: 0,
    nextAttemptAt: "2026-07-10T00:00:00.000Z",
    lastResponseStatus: null,
    lastError: null,
    signedWithVersion: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    deliveredAt: null,
    deadAt: null,
  } });

  const httpClient = new RecordingHttpClient();

  const result = await processDueDeliveries({
    deps: {
      deliveryRepo: rig.deliveryRepo,
      subscriptionRepo: rig.subscriptionRepo,
      envelopeStore: rig.envelopeStore,
      httpClient,
      signer,
      clock: rig.clock,
      headers,
    },
  });

  assert.equal(httpClient.calls.length, 0);
  assert.equal(result.failed, 1);

  const delivery = await rig.deliveryRepo.findById({
    workspaceId: "workspace-1",
    id: "delivery-no-envelope",
  });
  assert.match(delivery?.lastError ?? "", /no envelope recorded/);
});
