import { describe, expect, it } from "vitest";
import { integrationsDeliveriesRoute } from "../deliveries.js";
import { fakeDelivery, fakeSubscription, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** Repos that record every read, so a test can prove what was (not) asked. */
function makeDeps(options: { subscription?: ReturnType<typeof fakeSubscription> | null; deliveries?: ReturnType<typeof fakeDelivery>[] } = {}) {
  const reads = { findById: [] as unknown[], listBySubscription: [] as unknown[] };
  const deps = {
    workspaceId: WORKSPACE_ID,
    webhookSubscriptionRepo: { findById: async (input: unknown) => { reads.findById.push(input); return options.subscription === undefined ? fakeSubscription() : options.subscription; } },
    webhookDeliveryRepo: { listBySubscription: async (input: unknown) => { reads.listBySubscription.push(input); return options.deliveries ?? []; } },
  };
  return { deps, reads };
}

describe("integrationsDeliveriesRoute", () => {
  it("keeps the method and path, with no status or body cap of its own", () => {
    expect(integrationsDeliveriesRoute.method).toBe("get");
    expect(integrationsDeliveriesRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions/:subscriptionId/deliveries");
    expect(integrationsDeliveriesRoute.successStatus).toBeUndefined();
    expect(integrationsDeliveriesRoute.maxBodyBytes).toBeUndefined();
  });

  it("reads :subscriptionId, falling back to an empty id", () => {
    expect(integrationsDeliveriesRoute.parse(raw({ subscriptionId: "sub-1" }))).toEqual({ ok: true, value: { subscriptionId: "sub-1", limit: 50 } });
    expect(integrationsDeliveriesRoute.parse(raw({}))).toEqual({ ok: true, value: { subscriptionId: "", limit: 50 } });
  });

  const limits: [unknown, number][] = [
    [undefined, 50], ["Infinity", 50], ["0", 50], ["-1", 50], ["abc", 50], ["", 50], [["1", "2"], 50], [{ a: "1" }, 50],
    ["1", 1], ["2.9", 2], ["200", 200], ["201", 200], ["999", 200],
  ];
  for (const [rawLimit, expected] of limits) {
    it(`clamps ?limit=${JSON.stringify(rawLimit)} to ${expected}`, () => {
      expect(integrationsDeliveriesRoute.parse(raw({ subscriptionId: "s" }, undefined, { limit: rawLimit }))).toEqual({ ok: true, value: { subscriptionId: "s", limit: expected } });
    });
  }

  it("authorizes admin.integrations.manage for that subscription, then reads the log bounded by the parsed limit and projects every delivery", async () => {
    const first = fakeDelivery({ id: "d-new", createdAt: "2026-10-05T00:00:00.000Z" });
    const second = fakeDelivery({ id: "d-old", createdAt: "2026-10-01T00:00:00.000Z", status: "dead", deadAt: "2026-10-02T00:00:00.000Z", lastError: "boom" });
    const { deps, reads } = makeDeps({ deliveries: [first, second] });
    const { authorize, calls } = recordingAuthorize();
    const result = await integrationsDeliveriesRoute.handle({ input: { subscriptionId: "sub-1", limit: 7 }, deps, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "webhook_subscription", entityId: "sub-1" }]);
    expect(reads.findById).toEqual([{ workspaceId: WORKSPACE_ID, id: "sub-1" }]);
    expect(reads.listBySubscription).toEqual([{ workspaceId: WORKSPACE_ID, subscriptionId: "sub-1", limit: 7 }]);
    // The repo orders newest-first before limiting; sorting here after the limit would leave the wrong rows on the page.
    expect(result.ok && result.value.deliveries.map((delivery) => delivery.id)).toEqual(["d-new", "d-old"]);
    expect(result).toMatchObject({ ok: true, value: { deliveries: [{ id: "d-new", subscriptionId: "sub-1", status: "delivered" }, { id: "d-old", status: "dead", deadAt: "2026-10-02T00:00:00.000Z", lastError: "boom" }] } });
    expect(JSON.stringify(result)).not.toContain("workspaceId");
  });

  it("answers an unknown subscription with a code-less 404 and reads no deliveries", async () => {
    const { deps, reads } = makeDeps({ subscription: null });
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => integrationsDeliveriesRoute.handle({ input: { subscriptionId: "ghost", limit: 50 }, deps, authorize }))).toEqual({
      status: 404, body: { error: "webhook subscription 'ghost' was not found" },
    });
    expect(reads.listBySubscription).toEqual([]);
  });

  it("answers an empty log as an empty list", async () => {
    const { deps } = makeDeps({ deliveries: [] });
    const { authorize } = recordingAuthorize();
    expect(await integrationsDeliveriesRoute.handle({ input: { subscriptionId: "sub-1", limit: 50 }, deps, authorize })).toEqual({ ok: true, value: { deliveries: [] } });
  });

  it("rethrows a repo failure unchanged for the host's 500", async () => {
    const failure = new Error("injected read failure");
    const { deps } = makeDeps();
    deps.webhookDeliveryRepo.listBySubscription = async () => { throw failure; };
    const { authorize } = recordingAuthorize();
    await expect(integrationsDeliveriesRoute.handle({ input: { subscriptionId: "sub-1", limit: 50 }, deps, authorize })).rejects.toBe(failure);
  });

  it("reads nothing when authorization refuses, and fails closed without an authorizer", async () => {
    const { deps, reads } = makeDeps();
    const { authorize } = recordingAuthorize(["admin.integrations.manage"]);
    await expect(integrationsDeliveriesRoute.handle({ input: { subscriptionId: "sub-1", limit: 50 }, deps, authorize })).rejects.toThrow("denied");
    await expect(integrationsDeliveriesRoute.handle({ input: { subscriptionId: "sub-1", limit: 50 }, deps })).rejects.toThrow(/no authorizer/);
    expect(reads.findById).toEqual([]);
    expect(reads.listBySubscription).toEqual([]);
  });
});
