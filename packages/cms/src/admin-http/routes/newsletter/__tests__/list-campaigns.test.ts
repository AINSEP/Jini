import { describe, expect, it } from "vitest";
import { newsletterListCampaignsRoute as route } from "../list-campaigns.js";
import { baseDeps, fakeCampaign, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file LIST_CAMPAIGNS: one repo page, optionally filtered by `?status=`, with the page's cursor; bad paging is a 400. */

function deps(pages: unknown[] = []) {
  const items = [fakeCampaign({ id: "a", status: "draft" }), fakeCampaign({ id: "b", status: "sent" })];
  return { ...baseDeps(), newsletterCampaignRepo: { list: async (r: unknown, o: unknown) => { pages.push([r, o]); return { items, nextCursor: "next" }; } } };
}

describe("newsletterListCampaignsRoute", () => {
  it("keeps the method and path and reads ?status only when it is a string", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns", undefined, undefined]);
    expect(route.parse(raw({}, {}, { status: "sent", limit: "5" }))).toEqual({ ok: true, value: { status: "sent", query: { status: "sent", limit: "5" } } });
    expect(route.parse(raw({}, {}, { status: ["a", "b"] }))).toEqual({ ok: true, value: { status: undefined, query: { status: ["a", "b"] } } });
  });

  it("asks the repo for one page (default and max 100) and answers it with the cursor", async () => {
    const pages: unknown[] = [];
    const result = await route.handle({ input: { status: undefined, query: { limit: "7", cursor: "c1" } }, deps: deps(pages), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(pages).toEqual([[{ workspaceId: WORKSPACE_ID }, { limit: 7, cursor: "c1" }]]);
    expect(result).toEqual({ ok: true, value: { data: [fakeCampaign({ id: "a", status: "draft" }), fakeCampaign({ id: "b", status: "sent" })], nextCursor: "next" } });
    const pagesNoQuery: unknown[] = [];
    await route.handle({ input: { status: undefined, query: {} }, deps: deps(pagesNoQuery), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(pagesNoQuery).toEqual([[{ workspaceId: WORKSPACE_ID }, { limit: 100, cursor: null }]]);
  });

  it("filters the page by status when one was asked for", async () => {
    const result = await route.handle({ input: { status: "sent", query: {} }, deps: deps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(result).toEqual({ ok: true, value: { data: [fakeCampaign({ id: "b", status: "sent" })], nextCursor: "next" } });
  });

  it("answers a malformed limit as the route's own 400 VALIDATION_ERROR", async () => {
    const refusal = await refusalOf(() => route.handle({ input: { status: undefined, query: { limit: "0" } }, deps: deps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize }));
    expect(refusal.status).toBe(400);
    expect(refusal.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(Object.keys(refusal.body as object).sort()).toEqual(["code", "error"]);
  });
});
