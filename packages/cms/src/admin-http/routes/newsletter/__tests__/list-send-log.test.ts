import { describe, expect, it } from "vitest";
import { encodeListCursor } from "@jini-ai/core/list-page";
import { newsletterListSendLogRoute as route } from "../list-send-log.js";
import { baseDeps, fakeCampaign, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file LIST_SEND_LOG: 404 for an unknown campaign first, then one over-fetched page of send rows after the cursor's id. */

function deps(lookups: unknown[], rows = [{ id: "s1" }, { id: "s2" }, { id: "s3" }], campaign: unknown = fakeCampaign()) {
  return {
    ...baseDeps(),
    newsletterCampaignRepo: { findById: async () => campaign },
    newsletterSendRepo: { listByCampaign: async (i: unknown) => { lookups.push(i); return rows; } },
  };
}

describe("newsletterListSendLogRoute", () => {
  it("keeps the method and path and passes the query through", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/sends", undefined, undefined]);
    expect(route.parse(raw({ id: "camp-1" }, {}, { limit: "2" }))).toEqual({ ok: true, value: { id: "camp-1", query: { limit: "2" } } });
  });

  it("over-fetches one row past the limit and answers a page with the next cursor", async () => {
    const lookups: unknown[] = [];
    const result = await route.handle({ input: { id: "camp-1", query: { limit: "2" } }, deps: deps(lookups), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID, campaignId: "camp-1", afterId: undefined, limit: 3 }]);
    expect(result).toEqual({ ok: true, value: { data: [{ id: "s1" }, { id: "s2" }], nextCursor: encodeListCursor({ position: ["s2"] }) } });
  });

  it("continues after the cursor's send id, with the default limit of 100", async () => {
    const lookups: unknown[] = [];
    await route.handle({ input: { id: "camp-1", query: { cursor: encodeListCursor({ position: ["s2"] }) } }, deps: deps(lookups, []), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID, campaignId: "camp-1", afterId: "s2", limit: 101 }]);
  });

  it("refuses an unknown campaign with the host's 404 before reading any send row", async () => {
    const lookups: unknown[] = [];
    expect(await refusalOf(() => route.handle({ input: { id: "nope", query: { cursor: "%%%" } }, deps: deps(lookups, [], null), context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({
      status: 404, body: { error: "campaign nope was not found", code: "NEWSLETTER_CAMPAIGN_NOT_FOUND" },
    });
    expect(lookups).toEqual([]);
  });

  it("answers a malformed cursor as the route's own 400 VALIDATION_ERROR", async () => {
    const refusal = await refusalOf(() => route.handle({ input: { id: "camp-1", query: { cursor: "%%%" } }, deps: deps([]), context: PRINCIPAL, authorize: recordingAuthorize().authorize }));
    expect(refusal.status).toBe(400);
    expect(Object.keys(refusal.body as object).sort()).toEqual(["code", "error"]);
    expect(refusal.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
