import { describe, expect, test, vi } from "vitest";

import { createWebhookReceiver } from "../../ingest/receive.js";
import { createInboxWorker } from "../../ingest/worker.js";
import { LIPAY, USD, recordingAlerts, world } from "./harness.js";

/** @file C-1: a lost intent response stays unresolved until an operator or signed evidence settles it. */
const AGE = 60_000;
const request = { scope: LIPAY, amount: USD(10_000), idempotencyKey: "order:lost", reference: "order-lost" };

/** The fake charges successfully but drops its response, leaving the kernel without a provider ref. */
async function lostResponse({ ledgerKind }: { ledgerKind: "memory" | "sqlite" }, _optional = {}) {
  const alerts = recordingAlerts();
  const w = await world({ ledgerKind, alerts });
  const dispatch = vi.spyOn(w.lipay.provider, "createIntent");
  const retrieve = vi.spyOn(w.lipay.provider, "retrieve");
  w.lipay.server.script({ op: "createIntent", behaviours: ["timeout"] });
  const first = await w.service.createIntent(request);
  expect(first).toMatchObject({ ok: false, error: { code: "TRANSPORT_ERROR", retryable: true }, payment: { status: "unknown", next: null } });
  if (first.ok || !first.payment) throw new Error("expected an unresolved payment");
  expect((await w.read(first.payment.id)).payment).toMatchObject({ intentStatus: "unknown", providerRef: null, capturedMinor: 0 });
  return { w, alerts, dispatch, retrieve, payment: first.payment };
}

for (const ledgerKind of ["memory", "sqlite"] as const) {
  describe(`lost response on ${ledgerKind}`, () => {
    test("replays without dispatch, ages with an alert, and can be resolved with an operator audit", async () => {
      const { w, alerts, dispatch, retrieve, payment } = await lostResponse({ ledgerKind });
      expect(await w.service.createIntent(request)).toMatchObject({ ok: true, replayed: true, payment });
      w.tick(AGE * 2);
      expect((await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 })).payments)
        .toEqual({ scanned: 1, settled: 0, failed: 0, left: 1, errors: 0 });
      expect(alerts.raised).toEqual([{
        kind: "unknown-aged", workspaceId: "ws", mode: "test", paymentId: payment.id,
        detail: `payment ${payment.id} is unknown: no provider reference (the provider never answered)`,
      }]);
      expect(await w.service.createIntent(request)).toMatchObject({ ok: true, replayed: true, payment: { id: payment.id, status: "unknown", next: null } });
      const before = await w.read(payment.id);
      expect(before.payment).toMatchObject({ intentStatus: "unknown", status: "unknown", providerRef: null, capturedMinor: 0 });
      expect(before.attempts).toEqual([expect.objectContaining({ op: "intent", outcome: "unknown", operationKey: "intent:order:lost" })]);
      expect(before.outbox).toEqual([]);
      expect(await w.operator.resolveUnknown({ scope: LIPAY, paymentId: payment.id, outcome: "succeeded", actor: "operator-1", reason: "provider dashboard confirms charge" }))
        .toMatchObject({ ok: true, payment: { id: payment.id, status: "succeeded", captured: USD(10_000) } });
      const after = await w.read(payment.id);
      expect(after.actions).toEqual([expect.objectContaining({ action: "resolve-unknown", outcome: "succeeded", actor: "operator-1", reason: "provider dashboard confirms charge" })]);
      expect(after.evidence.map(row => [row.source, row.observedStatus])).toEqual([["operator", "succeeded"]]);
      expect(after.outbox).toEqual(["payment.succeeded"]);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(retrieve).not.toHaveBeenCalled();
    });

    test("a late signed webhook finds the unbound payment by correlation and settles through the worker", async () => {
      const { w, dispatch, retrieve, payment } = await lostResponse({ ledgerKind });
      w.tick(AGE * 2);
      await w.operator.reconcileUnknown({ olderThanMs: AGE, limit: 10 });
      const receiver = createWebhookReceiver({ ...w.deps, endpoints: { resolve: async () => LIPAY } });
      const resolved = await receiver.resolveEndpoint({ path: { siteId: LIPAY.siteId, providerId: LIPAY.providerId, endpointId: "configured" } });
      if (!resolved.ok) throw new Error("expected configured endpoint");
      const signed = w.lipay.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "late-success" });
      const delivery = { endpoint: resolved.endpoint, ...signed };
      expect(await receiver.receive({ ...delivery, rawBody: Buffer.concat([signed.rawBody, Buffer.from(" ")]) }))
        .toMatchObject({ status: 400, body: { code: "SIGNATURE_INVALID" } });
      expect(await receiver.receive(delivery)).toEqual({ status: 200, body: { received: 1, duplicates: 0, ignored: false } });
      const worker = createInboxWorker(w.deps);
      expect(await worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 1, parked: 0, dead: 0, quarantined: 0 });
      const after = await w.read(payment.id);
      expect(after.payment).toMatchObject({ id: payment.id, providerRef: "ch_1", intentStatus: "succeeded", status: "succeeded", capturedMinor: 10_000 });
      expect(after.evidence.map(row => [row.source, row.subjectRef, row.observedStatus])).toEqual([["webhook", "ch_1", "succeeded"]]);
      expect(after.actions).toEqual([]);
      expect(after.outbox).toEqual(["payment.succeeded"]);
      expect(await receiver.receive(delivery)).toEqual({ status: 200, body: { received: 0, duplicates: 1, ignored: false } });
      expect(await worker.runOnce({ limit: 10 })).toEqual({ seen: 0, applied: 0, parked: 0, dead: 0, quarantined: 0 });
      expect((await w.read(payment.id)).outbox).toEqual(["payment.succeeded"]);
      expect(await w.service.createIntent(request)).toMatchObject({ ok: true, replayed: true, payment: { id: payment.id, status: "succeeded" } });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0].req).toMatchObject({ correlationId: payment.id, amount: request.amount });
      expect(retrieve).not.toHaveBeenCalled();
    });
  });
}
