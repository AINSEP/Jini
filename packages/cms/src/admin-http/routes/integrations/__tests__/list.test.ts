import { describe, expect, it } from "vitest";
import { integrationsListRoute } from "../list.js";
import { fakeDelivery, fakeSubscription, fakeSubscriptionDto, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

function makeDeps(subscriptions: ReturnType<typeof fakeSubscription>[], deliveriesFor: (subscriptionId: string) => ReturnType<typeof fakeDelivery>[] = () => []) {
  const lookups: unknown[] = [];
  let listed = 0;
  const deps = {
    workspaceId: WORKSPACE_ID,
    webhookSubscriptionRepo: { listByWorkspace: async (input: unknown) => { listed += 1; lookups.push(input); return subscriptions; } },
    webhookDeliveryRepo: { listBySubscription: async (input: { subscriptionId: string }) => { lookups.push(input); return deliveriesFor(input.subscriptionId); } },
  };
  return { deps, lookups, listedCount: () => listed };
}

/** The delivery summary the list embeds (the seven inline fields, no event or topic detail). */
const summary = (delivery: ReturnType<typeof fakeDelivery>) => ({
  id: delivery.id, status: delivery.status, attempts: delivery.attempts, lastResponseStatus: delivery.lastResponseStatus,
  lastError: delivery.lastError, createdAt: delivery.createdAt, deliveredAt: delivery.deliveredAt,
});

describe("integrationsListRoute", () => {
  it("keeps the method and path, with no status or body cap of its own, and parses no input", () => {
    expect(integrationsListRoute.method).toBe("get");
    expect(integrationsListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions");
    expect(integrationsListRoute.successStatus).toBeUndefined();
    expect(integrationsListRoute.maxBodyBytes).toBeUndefined();
    expect(integrationsListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("authorizes admin.integrations.manage with no entity id and answers an empty list without reading deliveries", async () => {
    const { deps, lookups } = makeDeps([]);
    const { authorize, calls } = recordingAuthorize();
    expect(await integrationsListRoute.handle({ input: {}, deps, authorize }, { signal })).toEqual({ ok: true, value: { subscriptions: [] } });
    expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "webhook_subscription" }]);
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID }]);
  });

  it("annotates each subscription with its newest delivery by createdAt, whatever order the repo returns, and null when it has none", async () => {
    const newest = fakeDelivery({ id: "newest", createdAt: "2026-10-19T00:00:00.000Z" });
    const rows = [fakeDelivery({ id: "first", createdAt: "2026-10-02T00:00:00.000Z" }), newest, fakeDelivery({ id: "older", createdAt: "2026-10-01T00:00:00.000Z" })];
    const { deps } = makeDeps([fakeSubscription({ id: "a" }), fakeSubscription({ id: "empty" })], (id) => (id === "empty" ? [] : rows));
    const { authorize } = recordingAuthorize();
    expect(await integrationsListRoute.handle({ input: {}, deps, authorize })).toEqual({
      ok: true, value: { subscriptions: [fakeSubscriptionDto({ id: "a", lastDelivery: summary(newest) }), fakeSubscriptionDto({ id: "empty", lastDelivery: null })] },
    });
  });

  it("keeps the earlier row when two deliveries share a createdAt (a tie never swaps)", async () => {
    const tied = [fakeDelivery({ id: "keep", createdAt: "2026-10-05T00:00:00.000Z" }), fakeDelivery({ id: "tie", createdAt: "2026-10-05T00:00:00.000Z" })];
    const { deps } = makeDeps([fakeSubscription()], () => tied);
    const { authorize } = recordingAuthorize();
    const result = await integrationsListRoute.handle({ input: {}, deps, authorize });
    expect(result.ok && result.value.subscriptions[0]?.lastDelivery?.id).toBe("keep");
  });

  it("bounds each per-subscription delivery lookup at 50 rows, in subscription order", async () => {
    const { deps, lookups } = makeDeps([fakeSubscription({ id: "a" }), fakeSubscription({ id: "b" })]);
    const { authorize } = recordingAuthorize();
    await integrationsListRoute.handle({ input: {}, deps, authorize });
    expect(lookups).toEqual([
      { workspaceId: WORKSPACE_ID },
      { workspaceId: WORKSPACE_ID, subscriptionId: "a", limit: 50 },
      { workspaceId: WORKSPACE_ID, subscriptionId: "b", limit: 50 },
    ]);
  });

  it("never lets attribution fields of the stored rows reach the wire", async () => {
    const { deps } = makeDeps([fakeSubscription()]);
    const { authorize } = recordingAuthorize();
    expect(JSON.stringify(await integrationsListRoute.handle({ input: {}, deps, authorize }))).not.toMatch(/owner-secret|creator-secret|ownerPrincipalId|createdByPrincipalId|workspaceId/);
  });

  it("rethrows a repo failure unchanged for the host's 500", async () => {
    const failure = new Error("injected list failure");
    const { deps } = makeDeps([]);
    deps.webhookSubscriptionRepo.listByWorkspace = async () => { throw failure; };
    const { authorize } = recordingAuthorize();
    await expect(integrationsListRoute.handle({ input: {}, deps, authorize })).rejects.toBe(failure);
  });

  it("reads nothing when authorization refuses, and fails closed without an authorizer", async () => {
    const { deps, listedCount } = makeDeps([fakeSubscription()]);
    const { authorize } = recordingAuthorize(["admin.integrations.manage"]);
    await expect(integrationsListRoute.handle({ input: {}, deps, authorize })).rejects.toThrow("denied");
    await expect(integrationsListRoute.handle({ input: {}, deps })).rejects.toThrow(/no authorizer/);
    expect(listedCount()).toBe(0);
  });
});
