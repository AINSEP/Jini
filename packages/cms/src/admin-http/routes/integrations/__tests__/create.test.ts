import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it } from "vitest";
import { integrationsCreateRoute, type WebhookSubscriptionCreateFn } from "../create.js";
import { fakeSubscription, fakeSubscriptionDto, FakeNotFoundError, FakeValidationError, isValidationError, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const PRINCIPAL = { id: "operator-7" };
const BODY = { label: "Orders", targetUrl: "https://hooks.example.com/orders", topics: ["post.published"] };

function makeDeps(createSubscription: WebhookSubscriptionCreateFn) {
  return { workspaceId: WORKSPACE_ID, createSubscription, isValidationError };
}

describe("integrationsCreateRoute", () => {
  it("keeps the method, path and 201 success status, with no body cap of its own", () => {
    expect(integrationsCreateRoute.method).toBe("post");
    expect(integrationsCreateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions");
    expect(integrationsCreateRoute.successStatus).toBe(201);
    expect(integrationsCreateRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses label, targetUrl and topics off the untyped body", () => {
    expect(integrationsCreateRoute.parse(raw({}, BODY))).toEqual({ ok: true, value: BODY });
  });

  it("coerces every field the way the service's own validation expects, and never throws on a malformed shape", () => {
    expect(integrationsCreateRoute.parse(raw({}, { label: 7, targetUrl: null, topics: [1, "b"] }))).toEqual({
      ok: true, value: { label: "7", targetUrl: "", topics: ["1", "b"] },
    });
    // A non-array topics value is not refused here: it becomes no topics, which the service rejects with its own 400.
    expect(integrationsCreateRoute.parse(raw({}, { label: "x", topics: "not-an-array" }))).toEqual({ ok: true, value: { label: "x", targetUrl: "", topics: [] } });
    expect(integrationsCreateRoute.parse(raw({}, { label: "x", topics: { 0: "a" } }))).toEqual({ ok: true, value: { label: "x", targetUrl: "", topics: [] } });
  });

  it("falls back to empty fields when there is no body at all", () => {
    for (const body of [undefined, null, {}]) {
      expect(integrationsCreateRoute.parse(raw({}, body))).toEqual({ ok: true, value: { label: "", targetUrl: "", topics: [] } });
    }
  });

  it("authorizes admin.integrations.manage on webhook_subscription with no entity id, creates through the injected service and answers 201's envelope", async () => {
    const asked: unknown[] = [];
    const created = fakeSubscription({ id: "new-1", label: "Orders" });
    const { authorize, calls } = recordingAuthorize();
    const result = await integrationsCreateRoute.handle({
      input: BODY, deps: makeDeps(async (input) => { asked.push(input); return { subscription: created }; }), context: PRINCIPAL, authorize,
    }, { signal });
    expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "webhook_subscription" }]);
    // The signed-in operator, not a fixed placeholder, is who the host records as owner and creator.
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, actorPrincipalId: "operator-7", ...BODY }]);
    expect(result).toEqual({ ok: true, value: { subscription: fakeSubscriptionDto({ id: "new-1" }) } });
  });

  it("refuses to create when no one is signed in, rather than stamping a made-up owner", async () => {
    const { authorize } = recordingAuthorize();
    let created = 0;
    const createSubscription: WebhookSubscriptionCreateFn = async () => { created += 1; return { subscription: fakeSubscription() }; };
    await expect(integrationsCreateRoute.handle({ input: BODY, deps: makeDeps(createSubscription), authorize })).rejects.toThrow(/no authenticated principal/);
    expect(created).toBe(0);
  });

  it("never lets attribution or secret-adjacent record fields reach the wire", async () => {
    const { authorize } = recordingAuthorize();
    const result = await integrationsCreateRoute.handle({ input: BODY, deps: makeDeps(async () => ({ subscription: fakeSubscription() })), context: PRINCIPAL, authorize });
    expect(JSON.stringify(result)).not.toMatch(/owner-secret|creator-secret|ownerPrincipalId|createdByPrincipalId|workspaceId/);
  });

  it("maps the host's validation failure to a code-less 400 carrying its own message", async () => {
    const { authorize } = recordingAuthorize();
    const createSubscription: WebhookSubscriptionCreateFn = async () => { throw new FakeValidationError("label is required"); };
    expect(await refusalOf(() => integrationsCreateRoute.handle({ input: BODY, deps: makeDeps(createSubscription), context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "label is required" },
    });
  });

  it("rethrows what create never mapped (not-found, a version conflict, anything else) for the host's 500", async () => {
    const { authorize } = recordingAuthorize();
    const conflict = new RecordVersionConflictError({ recordKind: "webhook", recordId: "x", expectedVersion: 1, currentVersion: 2 });
    for (const failure of [new FakeNotFoundError("gone"), conflict, new Error("injected insert failure")]) {
      const createSubscription: WebhookSubscriptionCreateFn = async () => { throw failure; };
      await expect(integrationsCreateRoute.handle({ input: BODY, deps: makeDeps(createSubscription), context: PRINCIPAL, authorize })).rejects.toBe(failure);
    }
  });

  it("creates nothing when authorization refuses", async () => {
    let created = 0;
    const { authorize } = recordingAuthorize(["admin.integrations.manage"]);
    await expect(integrationsCreateRoute.handle({ input: BODY, deps: makeDeps(async () => { created += 1; return { subscription: fakeSubscription() }; }), authorize })).rejects.toThrow("denied admin.integrations.manage");
    expect(created).toBe(0);
  });

  it("fails closed when the mount has no authorizer", async () => {
    let created = 0;
    await expect(integrationsCreateRoute.handle({ input: BODY, deps: makeDeps(async () => { created += 1; return { subscription: fakeSubscription() }; }) })).rejects.toThrow(/no authorizer/);
    expect(created).toBe(0);
  });
});
