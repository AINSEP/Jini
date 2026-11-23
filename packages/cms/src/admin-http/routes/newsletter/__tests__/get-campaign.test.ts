import { describe, expect, it } from "vitest";
import { newsletterGetCampaignRoute as route } from "../get-campaign.js";
import { baseDeps, fakeCampaign, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file GET_CAMPAIGN: one campaign in the `{ data }` envelope, or the host's NEWSLETTER_CAMPAIGN_NOT_FOUND 404. */

describe("newsletterGetCampaignRoute", () => {
  it("keeps the method, path and default status and reads :id as sent", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id", undefined, undefined]);
    expect(route.parse(raw({ id: "camp-1" }))).toEqual({ ok: true, value: { id: "camp-1" } });
    // `String(req.params.id)`: a missing param was never defaulted to "".
    expect(route.parse(raw({}))).toEqual({ ok: true, value: { id: "undefined" } });
  });

  it("answers the stored campaign in the data envelope, looked up in this workspace", async () => {
    const lookups: unknown[] = [];
    const deps = { ...baseDeps(), newsletterCampaignRepo: { findById: async (i: unknown) => { lookups.push(i); return fakeCampaign(); } } };
    const result = await route.handle({ input: { id: "camp-1" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal });
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID, id: "camp-1" }]);
    expect(result).toEqual({ ok: true, value: { data: fakeCampaign() } });
  });

  it("refuses an unknown campaign with the host's exact 404 body", async () => {
    const deps = { ...baseDeps(), newsletterCampaignRepo: { findById: async () => null } };
    expect(await refusalOf(() => route.handle({ input: { id: "nope" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({
      status: 404, body: { error: "campaign nope was not found", code: "NEWSLETTER_CAMPAIGN_NOT_FOUND" },
    });
  });
});
