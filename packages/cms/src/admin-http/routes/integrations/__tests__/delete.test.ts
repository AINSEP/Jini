import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it } from "vitest";
import { integrationsDeleteRoute, type WebhookSubscriptionDeleteFn } from "../delete.js";
import { fakeSubscription, fakeSubscriptionDto, FakeNotFoundError, FakeValidationError, isNotFoundError, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function makeDeps(deleteSubscription: WebhookSubscriptionDeleteFn) {
  return { workspaceId: WORKSPACE_ID, deleteSubscription, isNotFoundError };
}

describe("integrationsDeleteRoute", () => {
  it("keeps the method, path and default 200, and reads :subscriptionId, falling back to an empty id", () => {
    expect(integrationsDeleteRoute.method).toBe("delete");
    expect(integrationsDeleteRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions/:subscriptionId");
    expect(integrationsDeleteRoute.successStatus).toBeUndefined();
    expect(integrationsDeleteRoute.maxBodyBytes).toBeUndefined();
    expect(integrationsDeleteRoute.parse(raw({ subscriptionId: "sub-1" }))).toEqual({ ok: true, value: { subscriptionId: "sub-1" } });
    expect(integrationsDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { subscriptionId: "" } });
  });

  it("authorizes admin.integrations.manage for that subscription, deletes through the injected service and echoes the disabled subscription", async () => {
    const asked: unknown[] = [];
    const disabled = fakeSubscription({ status: "disabled", disabledAt: "2026-10-04T00:00:00.000Z", version: 4 });
    const { authorize, calls } = recordingAuthorize();
    const result = await integrationsDeleteRoute.handle({
      input: { subscriptionId: "sub-1" }, deps: makeDeps(async (input) => { asked.push(input); return { subscription: disabled }; }), authorize,
    }, { signal });
    expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "webhook_subscription", entityId: "sub-1" }]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, subscriptionId: "sub-1" }]);
    expect(result).toEqual({ ok: true, value: { subscription: fakeSubscriptionDto({ status: "disabled", disabledAt: "2026-10-04T00:00:00.000Z", version: 4 }) } });
  });

  it("maps the host's not-found failure to a code-less 404 carrying its own message", async () => {
    const { authorize } = recordingAuthorize();
    const deleteSubscription: WebhookSubscriptionDeleteFn = async () => { throw new FakeNotFoundError("webhook subscription 'sub-1' was not found"); };
    expect(await refusalOf(() => integrationsDeleteRoute.handle({ input: { subscriptionId: "sub-1" }, deps: makeDeps(deleteSubscription), authorize }))).toEqual({
      status: 404, body: { error: "webhook subscription 'sub-1' was not found" },
    });
  });

  it("maps a lost compare-and-set to the shared 409 version-conflict body, details included", async () => {
    const { authorize } = recordingAuthorize();
    const conflict = new RecordVersionConflictError({ recordKind: "webhook", recordId: "sub-1", expectedVersion: 3, currentVersion: 4 });
    const deleteSubscription: WebhookSubscriptionDeleteFn = async () => { throw conflict; };
    expect(await refusalOf(() => integrationsDeleteRoute.handle({ input: { subscriptionId: "sub-1" }, deps: makeDeps(deleteSubscription), authorize }))).toEqual({
      status: 409,
      body: { error: conflict.message, code: "VERSION_CONFLICT", details: { recordKind: "webhook", recordId: "sub-1", expectedVersion: 3, currentVersion: 4 } },
    });
  });

  it("rethrows what delete never mapped (a validation failure, anything else) for the host's 500", async () => {
    const { authorize } = recordingAuthorize();
    for (const failure of [new FakeValidationError("nope"), new Error("injected save failure")]) {
      const deleteSubscription: WebhookSubscriptionDeleteFn = async () => { throw failure; };
      await expect(integrationsDeleteRoute.handle({ input: { subscriptionId: "sub-1" }, deps: makeDeps(deleteSubscription), authorize })).rejects.toBe(failure);
    }
  });

  it("deletes nothing when authorization refuses, and fails closed without an authorizer", async () => {
    let deleted = 0;
    const deps = makeDeps(async () => { deleted += 1; return { subscription: fakeSubscription() }; });
    const { authorize } = recordingAuthorize(["admin.integrations.manage"]);
    await expect(integrationsDeleteRoute.handle({ input: { subscriptionId: "sub-1" }, deps, authorize })).rejects.toThrow("denied");
    await expect(integrationsDeleteRoute.handle({ input: { subscriptionId: "sub-1" }, deps })).rejects.toThrow(/no authorizer/);
    expect(deleted).toBe(0);
  });
});
