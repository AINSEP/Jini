import { describe, expect, it } from "vitest";
import { newsletterSendCampaignRoute as route } from "../send-campaign.js";
import { baseDeps, fakeCampaign, PRINCIPAL, raw, recordingAuthorize, WORKSPACE_ID } from "./helpers.js";

/** @file SEND_CAMPAIGN: 202 as soon as authorizeSend commits; freezeAudience -> claimBatch run after, best-effort, a failure only reported. */

function deps(log: string[], failFreeze = false) {
  return {
    ...baseDeps(),
    openSendPipeline: () => {
      log.push("open");
      return {
        authorizeSend: async (i: unknown) => { log.push(`authorizeSend ${JSON.stringify(i)}`); return { campaign: fakeCampaign({ status: "sending" }), launchGateSnapshot: {} }; },
        freezeAudience: async (i: unknown) => { log.push(`freeze ${JSON.stringify(i)}`); if (failFreeze) throw new Error("directory offline"); },
        claimBatch: async () => { log.push("claim"); },
      };
    },
    reportDeliveryFailure: ({ message }: { message: string }) => { log.push(`report ${message}`); },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("newsletterSendCampaignRoute", () => {
  it("keeps the method and path, answers 202 and ignores any body", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/send", 202, undefined]);
    expect(route.parse(raw({ id: "camp-1" }, { override: true }))).toEqual({ ok: true, value: { id: "camp-1" } });
  });

  it("answers the now-sending campaign, then freezes its audience and claims a batch from the same pipeline", async () => {
    const log: string[] = [];
    const result = await route.handle({ input: { id: "camp-1" }, deps: deps(log), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(result).toEqual({ ok: true, value: { data: fakeCampaign({ status: "sending" }) } });
    await settle();
    expect(log).toEqual([
      "open", `authorizeSend ${JSON.stringify({ workspaceId: WORKSPACE_ID, campaignId: "camp-1" })}`,
      `freeze ${JSON.stringify({ workspaceId: WORKSPACE_ID, campaignId: "camp-1", listId: "list-1" })}`, "claim",
    ]);
  });

  it("reports a post-202 delivery failure instead of failing the already-answered request", async () => {
    const log: string[] = [];
    const result = await route.handle({ input: { id: "camp-1" }, deps: deps(log, true), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(result.ok).toBe(true);
    await settle();
    expect(log.slice(2)).toEqual([
      `freeze ${JSON.stringify({ workspaceId: WORKSPACE_ID, campaignId: "camp-1", listId: "list-1" })}`,
      "report freezeAudience/claimBatch failed after authorizeSend for campaign camp-1: directory offline",
    ]);
  });
});
