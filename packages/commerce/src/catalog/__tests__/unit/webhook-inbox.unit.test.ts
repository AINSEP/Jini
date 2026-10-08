import assert from "node:assert/strict";
import test from "node:test";

import type { ApplyProviderEventResult, CommerceWebhookEventRepoPort } from "../../ports.js";
import { ingestProviderEvent, type InboundProviderEvent, type OrderProjection } from "../../webhook-inbox.js";

type ApplyProviderEventInput = Parameters<CommerceWebhookEventRepoPort["applyProviderEvent"]>[0];

test("ingestProviderEvent: delegates correctly to CommerceWebhookEventRepoPort with mapped fields and timestamps", async () => {
  let capturedInput: ApplyProviderEventInput | undefined;
  const mockRepo: CommerceWebhookEventRepoPort = {
    async applyProviderEvent(input: ApplyProviderEventInput): Promise<ApplyProviderEventResult> {
      capturedInput = input;
      return "applied";
    },
  };

  const fixedNow = "2026-08-12T13:00:00.000Z";
  const mockClock = { nowMs: () => Date.parse(fixedNow) };
  const mockIdGen = { newId: () => "evt-row-mock-123" };

  const event: InboundProviderEvent = {
    workspaceId: "ws-100",
    provider: "stripe",
    eventId: "evt_test_123",
    eventType: "payment_intent.succeeded",
    eventOccurredAt: "2026-08-12T12:00:00.000Z",
    payload: '{"test":true}',
  };

  const projection: OrderProjection = {
    orderId: "order-999",
    status: "paid",
  };

  const result = await ingestProviderEvent({
    deps: {
      webhookEvents: mockRepo,
      clock: mockClock,
      idGen: mockIdGen,
    },
    event,
    projection,
  });

  assert.equal(result, "applied");
  assert.ok(capturedInput);
  assert.deepEqual(capturedInput, {
    event: {
      id: "evt-row-mock-123",
      workspaceId: "ws-100",
      provider: "stripe",
      eventId: "evt_test_123",
      eventType: "payment_intent.succeeded",
      eventOccurredAt: "2026-08-12T12:00:00.000Z",
      payload: '{"test":true}',
      status: "received",
      receivedAt: fixedNow,
    },
    orderId: "order-999",
    projection: {
      status: "paid",
      providerEventAt: "2026-08-12T12:00:00.000Z",
      updatedAt: fixedNow,
    },
    processedAt: fixedNow,
  });
});

test("ingestProviderEvent: passes through duplicate and stale results", async () => {
  for (const outcome of ["duplicate", "stale"] as const) {
    const mockRepo: CommerceWebhookEventRepoPort = {
      async applyProviderEvent(): Promise<ApplyProviderEventResult> {
        return outcome;
      },
    };

    const result = await ingestProviderEvent({
      deps: {
        webhookEvents: mockRepo,
        clock: { nowMs: () => Date.parse("2026-08-12T13:00:00.000Z") },
        idGen: { newId: () => "id-1" },
      },
      event: {
        workspaceId: "ws-1",
        provider: "stripe",
        eventId: "evt_1",
        eventType: "charge.captured",
        eventOccurredAt: "2026-08-12T12:00:00.000Z",
        payload: "{}",
      },
      projection: { orderId: "order-1", status: "paid" },
    });

    assert.equal(result, outcome);
  }
});
