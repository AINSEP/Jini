import { ToolInputError } from "@jini-ai/core";
import { describe, expect, it } from "vitest";
import { newsletterListSubscriptionsRoute as route } from "../list-subscriptions.js";
import { baseDeps, fakeSubscription, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file LIST_SUBSCRIPTIONS: one repo page of one list's subscriptions, with the page's cursor; bad paging is a 400. */

const ROWS = [fakeSubscription({ id: "a" }), fakeSubscription({ id: "b" })];
function deps(pages: unknown[] = [], list?: () => Promise<unknown>) {
  const defaultList = async (r: unknown, o: unknown) => { pages.push([r, o]); return { items: ROWS, nextCursor: "next" }; };
  return { ...baseDeps(), newsletterSubscriptionRepo: { list: (list ?? defaultList) as typeof defaultList } };
}
const auth = () => recordingAuthorize().authorize;

describe("newsletterListSubscriptionsRoute", () => {
  it("keeps the method and path, reads :listId as sent and keeps the raw query for paging", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/newsletter/lists/:listId/subscriptions", undefined, undefined]);
    expect(route.parse(raw({ listId: "list-1" }, {}, { limit: "5" }))).toEqual({ ok: true, value: { listId: "list-1", query: { limit: "5" } } });
    expect(route.parse(raw({}))).toEqual({ ok: true, value: { listId: "undefined", query: {} } });
  });

  it("asks the repo for one page of this list (default and max 100) and answers it with the cursor", async () => {
    const pages: unknown[] = [];
    const result = await route.handle({ input: { listId: "list-1", query: { limit: "7", cursor: "c1" } }, deps: deps(pages), context: PRINCIPAL, authorize: auth() });
    expect(pages).toEqual([[{ workspaceId: WORKSPACE_ID, listId: "list-1" }, { limit: 7, cursor: "c1" }]]);
    expect(result).toEqual({ ok: true, value: { data: ROWS, nextCursor: "next" } });
    const defaults: unknown[] = [];
    await route.handle({ input: { listId: "list-1", query: {} }, deps: deps(defaults), context: PRINCIPAL, authorize: auth() });
    expect(defaults).toEqual([[{ workspaceId: WORKSPACE_ID, listId: "list-1" }, { limit: 100, cursor: null }]]);
  });

  it("answers a malformed limit as the route's own 400 VALIDATION_ERROR", async () => {
    const refusal = await refusalOf(() => route.handle({ input: { listId: "list-1", query: { limit: "0" } }, deps: deps(), context: PRINCIPAL, authorize: auth() }));
    expect(refusal.status).toBe(400);
    expect(refusal.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(Object.keys(refusal.body as object).sort()).toEqual(["code", "error"]);
  });

  it("answers a malformed cursor the repo refuses as the same 400, not a 500", async () => {
    const failing = deps([], async () => { throw new ToolInputError({ message: "invalid cursor" } as never); });
    expect(await refusalOf(() => route.handle({ input: { listId: "list-1", query: {} }, deps: failing, context: PRINCIPAL, authorize: auth() }))).toEqual({ status: 400, body: { error: "invalid cursor", code: "VALIDATION_ERROR" } });
  });
});
