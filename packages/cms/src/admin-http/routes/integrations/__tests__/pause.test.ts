import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it } from "vitest";
import { integrationsPauseRoute, type WebhookSubscriptionPauseFn } from "../pause.js";
import { fakeSubscription, fakeSubscriptionDto, FakeNotFoundError, FakeValidationError, isNotFoundError, isValidationError, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function makeDeps(pauseSubscription: WebhookSubscriptionPauseFn) {
  return { workspaceId: WORKSPACE_ID, pauseSubscription, isNotFoundError, isValidationError };
}
const INPUT = { subscriptionId: "sub-1", paused: true };

describe("integrationsPauseRoute", () => {
  it("keeps the method, path and default 200", () => {
    expect(integrationsPauseRoute.method).toBe("post");
    expect(integrationsPauseRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/integrations/subscriptions/:subscriptionId/pause");
    expect(integrationsPauseRoute.successStatus).toBeUndefined();
    expect(integrationsPauseRoute.maxBodyBytes).toBeUndefined();
  });

  it("reads :subscriptionId (empty when absent) and treats only an explicit boolean paused as a choice", () => {
    expect(integrationsPauseRoute.parse(raw({ subscriptionId: "sub-1" }, { paused: false }))).toEqual({ ok: true, value: { subscriptionId: "sub-1", paused: false } });
    expect(integrationsPauseRoute.parse(raw({ subscriptionId: "sub-1" }, { paused: true }))).toEqual({ ok: true, value: { subscriptionId: "sub-1", paused: true } });
    expect(integrationsPauseRoute.parse(raw({}, { paused: true }))).toEqual({ ok: true, value: { subscriptionId: "", paused: true } });
  });

  it("defaults to pausing for any non-boolean paused, including an absent body, so only a literal false resumes", () => {
    for (const body of [undefined, null, {}, { paused: "false" }, { paused: 0 }, { paused: null }]) {
      expect(integrationsPauseRoute.parse(raw({ subscriptionId: "sub-1" }, body))).toEqual({ ok: true, value: INPUT });
    }
  });

  it("authorizes admin.integrations.manage for that subscription, pauses through the injected service with the chosen direction and echoes it", async () => {
    const asked: unknown[] = [];
    const paused = fakeSubscription({ status: "paused", version: 4 });
    const { authorize, calls } = recordingAuthorize();
    const result = await integrationsPauseRoute.handle({
      input: { subscriptionId: "sub-1", paused: false }, deps: makeDeps(async (input) => { asked.push(input); return { subscription: paused }; }), authorize,
    }, { signal });
    expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "webhook_subscription", entityId: "sub-1" }]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, subscriptionId: "sub-1", paused: false }]);
    expect(result).toEqual({ ok: true, value: { subscription: fakeSubscriptionDto({ status: "paused", version: 4 }) } });
  });

  it("maps not-found to 404 and validation to 400, each code-less with the failure's own message", async () => {
    const { authorize } = recordingAuthorize();
    for (const [failure, status] of [[new FakeNotFoundError("webhook subscription 'sub-1' was not found"), 404], [new FakeValidationError("webhook subscription 'sub-1' is disabled and cannot be paused or resumed"), 400]] as const) {
      const pauseSubscription: WebhookSubscriptionPauseFn = async () => { throw failure; };
      expect(await refusalOf(() => integrationsPauseRoute.handle({ input: INPUT, deps: makeDeps(pauseSubscription), authorize }))).toEqual({ status, body: { error: failure.message } });
    }
  });

  it("maps a lost compare-and-set to the shared 409 version-conflict body, details included", async () => {
    const { authorize } = recordingAuthorize();
    const conflict = new RecordVersionConflictError({ recordKind: "webhook", recordId: "sub-1", expectedVersion: 3, currentVersion: null });
    const pauseSubscription: WebhookSubscriptionPauseFn = async () => { throw conflict; };
    expect(await refusalOf(() => integrationsPauseRoute.handle({ input: INPUT, deps: makeDeps(pauseSubscription), authorize }))).toEqual({
      status: 409,
      body: { error: conflict.message, code: "VERSION_CONFLICT", details: { recordKind: "webhook", recordId: "sub-1", expectedVersion: 3, currentVersion: null } },
    });
  });

  it("rethrows an unmapped failure unchanged for the host's 500", async () => {
    const { authorize } = recordingAuthorize();
    const failure = new Error("injected save failure");
    const pauseSubscription: WebhookSubscriptionPauseFn = async () => { throw failure; };
    await expect(integrationsPauseRoute.handle({ input: INPUT, deps: makeDeps(pauseSubscription), authorize })).rejects.toBe(failure);
  });

  it("pauses nothing when authorization refuses, and fails closed without an authorizer", async () => {
    let paused = 0;
    const deps = makeDeps(async () => { paused += 1; return { subscription: fakeSubscription() }; });
    const { authorize } = recordingAuthorize(["admin.integrations.manage"]);
    await expect(integrationsPauseRoute.handle({ input: INPUT, deps, authorize })).rejects.toThrow("denied");
    await expect(integrationsPauseRoute.handle({ input: INPUT, deps })).rejects.toThrow(/no authorizer/);
    expect(paused).toBe(0);
  });

  it("refuses nothing in parse: a malformed paused is never a 400 before authorization", () => {
    expect(() => integrationsPauseRoute.parse(raw({ subscriptionId: "s" }, { paused: "maybe" }))).not.toThrow();
  });
});
