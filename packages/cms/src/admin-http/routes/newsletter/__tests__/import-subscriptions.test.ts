import { describe, expect, it } from "vitest";
import { newsletterImportSubscriptionsRoute as route } from "../import-subscriptions.js";
import { baseDeps, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file IMPORT_SUBSCRIPTIONS: an array of `{ subscriberId }` refused in `parse`; every row imported as `source: "import"`; answered 207 unwrapped. */

const REFUSAL = { status: 400, body: { error: "subscribers must be an array of { subscriberId }", code: "VALIDATION_ERROR" } };
const params = { listId: "list-1" };

describe("newsletterImportSubscriptionsRoute", () => {
  it("keeps the method and path and answers 207 Multi-Status", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:listId/subscriptions/import", 207, undefined]);
  });

  it("parses the subscriber ids in order and drops every other row field", () => {
    expect(route.parse(raw(params, { subscribers: [{ subscriberId: "a", source: "api", extra: 1 }, { subscriberId: "b" }] }))).toEqual({ ok: true, value: { listId: "list-1", subscriberIds: ["a", "b"] } });
    expect(route.parse(raw({}, { subscribers: [] }))).toEqual({ ok: true, value: { listId: "undefined", subscriberIds: [] } });
  });

  it.each<readonly [string, unknown]>([
    ["a missing body", undefined],
    ["a body without subscribers", {}],
    ["a non-array subscribers", { subscribers: "not-an-array" }],
    ["a null row", { subscribers: [null] }],
    ["a string row", { subscribers: ["a"] }],
    ["a row with a non-string subscriberId", { subscribers: [{ subscriberId: 123 }] }],
    ["one bad row after a good one", { subscribers: [{ subscriberId: "a" }, {}] }],
  ])("refuses %s with the host's flat 400", async (_label, body) => {
    expect(await refusalOf(() => route.parse(raw(params, body)))).toEqual(REFUSAL);
  });

  it("imports every row with source import in this workspace, answering created and failed unwrapped", async () => {
    const calls: unknown[] = [];
    const outcome = { created: [{ id: "s1" }], failed: [{ index: 1, code: "NEWSLETTER_SUBSCRIBER_NOT_FOUND", message: "subscriber b was not found" }] };
    const deps = { ...baseDeps(), importSubscriptions: async (input: unknown) => { calls.push(input); return outcome; } };
    const result = await route.handle({ input: { listId: "list-1", subscriberIds: ["a", "b"] }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, listId: "list-1", subscribers: [{ subscriberId: "a", source: "import" }, { subscriberId: "b", source: "import" }] }]);
    expect(result).toEqual({ ok: true, value: outcome });
  });
});
