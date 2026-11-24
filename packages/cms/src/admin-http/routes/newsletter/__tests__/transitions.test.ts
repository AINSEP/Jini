import { describe, expect, it } from "vitest";
import { newsletterCancelCampaignRoute } from "../cancel-campaign.js";
import { newsletterPauseCampaignRoute } from "../pause-campaign.js";
import { newsletterResumeCampaignRoute } from "../resume-campaign.js";
import { baseDeps, fakeCampaign, PRINCIPAL, raw, recordingAuthorize, WORKSPACE_ID } from "./helpers.js";

/** @file CANCEL / PAUSE / RESUME: no body; each calls its one injected transition and answers the campaign (200, never 204). */

const BASE = "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id";

describe("newsletterCancelCampaignRoute", () => {
  it("keeps the method and path and cancels as the principal", async () => {
    const route = newsletterCancelCampaignRoute;
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", `${BASE}/cancel`, undefined, undefined]);
    expect(route.parse(raw({ id: "camp-1" }, { ignored: true }))).toEqual({ ok: true, value: { id: "camp-1" } });
    const calls: unknown[] = [];
    const deps = { ...baseDeps(), cancelCampaign: async (i: unknown) => { calls.push(i); return { campaign: fakeCampaign({ status: "canceled" }) }; } };
    const result = await route.handle({ input: { id: "camp-1" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, id: "camp-1", actorId: PRINCIPAL.id }]);
    expect(result).toEqual({ ok: true, value: { data: fakeCampaign({ status: "canceled" }) } });
  });
});

describe.each([
  { name: "pause", route: newsletterPauseCampaignRoute, field: "pauseCampaign", status: "paused" },
  { name: "resume", route: newsletterResumeCampaignRoute, field: "resumeCampaign", status: "sending" },
] as const)("newsletter $name route", ({ name, route, field, status }) => {
  it("keeps the method and path and transitions the campaign through its injected collaborator", async () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", `${BASE}/${name}`, undefined, undefined]);
    expect(route.parse(raw({ id: "camp-1" }))).toEqual({ ok: true, value: { id: "camp-1" } });
    const calls: unknown[] = [];
    const deps = { ...baseDeps(), [field]: async (i: unknown) => { calls.push(i); return { campaign: fakeCampaign({ status }), requeueFailed: true }; } };
    const result = await route.handle({ input: { id: "camp-1" }, deps: deps as never, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, campaignId: "camp-1" }]);
    // Only the campaign is answered; a resume's `requeueFailed` flag never reached the wire.
    expect(result).toEqual({ ok: true, value: { data: fakeCampaign({ status }) } });
  });
});
