import { describe, expect, it } from "vitest";
import { newsletterCreateSubscriptionRoute as route } from "../create-subscription.js";
import { baseDeps, fakeSubscription, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file CREATE_SUBSCRIPTION: `subscriberId` and a known `source` (default admin) refused in `parse`; saved by the host service. */

const NO_SUBSCRIBER = { status: 400, body: { error: "subscriberId is a required string", code: "VALIDATION_ERROR" } };
const BAD_SOURCE = { status: 400, body: { error: "source must be one of admin, import, api", code: "VALIDATION_ERROR" } };
const params = { listId: "list-1" };

describe("newsletterCreateSubscriptionRoute", () => {
  it("keeps the method and path and answers 201", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:listId/subscriptions", 201, undefined]);
  });

  it("parses the subscriber and list, defaulting a missing or non-string source to admin", () => {
    const want = (source: string) => ({ ok: true, value: { listId: "list-1", subscriberId: "m-1", source } });
    expect(route.parse(raw(params, { subscriberId: "m-1" }))).toEqual(want("admin"));
    expect(route.parse(raw(params, { subscriberId: "m-1", source: 3 }))).toEqual(want("admin"));
    for (const source of ["admin", "import", "api"]) expect(route.parse(raw(params, { subscriberId: "m-1", source }))).toEqual(want(source));
    expect(route.parse(raw({}, { subscriberId: "m-1" }))).toEqual({ ok: true, value: { listId: "undefined", subscriberId: "m-1", source: "admin" } });
  });

  it.each<readonly [string, unknown]>([
    ["a missing body", undefined],
    ["a missing subscriberId", {}],
    ["a non-string subscriberId", { subscriberId: 7 }],
  ])("refuses %s with the host's flat 400", async (_label, body) => {
    expect(await refusalOf(() => route.parse(raw(params, body)))).toEqual(NO_SUBSCRIBER);
  });

  it("refuses a source outside admin, import, api, and checks the subscriber first", async () => {
    expect(await refusalOf(() => route.parse(raw(params, { subscriberId: "m-1", source: "email" })))).toEqual(BAD_SOURCE);
    expect(await refusalOf(() => route.parse(raw(params, { subscriberId: "m-1", source: "" })))).toEqual(BAD_SOURCE);
    expect(await refusalOf(() => route.parse(raw(params, { source: "email" })))).toEqual(NO_SUBSCRIBER);
  });

  it("saves the subscription in this workspace and answers it in the data envelope", async () => {
    const saved: unknown[] = [];
    const deps = { ...baseDeps(), saveSubscription: async (input: unknown) => { saved.push(input); return { subscription: fakeSubscription() }; } };
    const result = await route.handle({ input: { listId: "list-1", subscriberId: "m-1", source: "api" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(saved).toEqual([{ workspaceId: WORKSPACE_ID, listId: "list-1", subscriberId: "m-1", source: "api" }]);
    expect(result).toEqual({ ok: true, value: { data: fakeSubscription() } });
  });
});
