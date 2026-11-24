import { describe, expect, it } from "vitest";
import { newsletterRemoveSubscriptionRoute as route } from "../remove-subscription.js";
import { baseDeps, fakeSubscription, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file REMOVE_SUBSCRIPTION: unsubscribes (200, not 204) a subscription that exists in the list named in the URL; otherwise the host's 404. */

const NOT_FOUND = { status: 404, body: { error: "subscription sub-1 was not found", code: "NEWSLETTER_SUBSCRIPTION_NOT_FOUND" } };

function setup(stored: unknown) {
  const calls: unknown[] = [];
  const lookups: unknown[] = [];
  const deps = {
    ...baseDeps(),
    newsletterSubscriptionRepo: { findById: async (i: unknown) => { lookups.push(i); return stored as ReturnType<typeof fakeSubscription> | null; } },
    unsubscribeSubscription: async (input: unknown) => { calls.push(input); return { subscription: fakeSubscription({ status: "unsubscribed" }) }; },
  };
  const run = () => route.handle({ input: { listId: "list-1", id: "sub-1" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
  return { calls, lookups, run };
}

describe("newsletterRemoveSubscriptionRoute", () => {
  it("keeps the method, path and default 200 and reads :listId and :id as sent", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["delete", "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:listId/subscriptions/:id", undefined, undefined]);
    expect(route.parse(raw({ listId: "list-1", id: "sub-1" }))).toEqual({ ok: true, value: { listId: "list-1", id: "sub-1" } });
    expect(route.parse(raw({}))).toEqual({ ok: true, value: { listId: "undefined", id: "undefined" } });
  });

  it("unsubscribes a subscription found in that list and answers the unsubscribed row", async () => {
    const { calls, lookups, run } = setup(fakeSubscription());
    expect(await run()).toEqual({ ok: true, value: { data: fakeSubscription({ status: "unsubscribed" }) } });
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID, id: "sub-1" }]);
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, id: "sub-1" }]);
  });

  it("refuses an unknown subscription with the host's exact 404 body and unsubscribes nothing", async () => {
    const { calls, run } = setup(null);
    expect(await refusalOf(run)).toEqual(NOT_FOUND);
    expect(calls).toEqual([]);
  });

  it("answers the same 404 for a subscription that belongs to another list, so ids never cross lists", async () => {
    const { calls, run } = setup(fakeSubscription({ listId: "other-list" }));
    expect(await refusalOf(run)).toEqual(NOT_FOUND);
    expect(calls).toEqual([]);
  });
});
