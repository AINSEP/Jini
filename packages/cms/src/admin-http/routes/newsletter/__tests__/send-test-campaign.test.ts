import { describe, expect, it } from "vitest";
import { newsletterSendTestCampaignRoute as route } from "../send-test-campaign.js";
import { baseDeps, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file SEND_TEST_CAMPAIGN: testAddresses must be an array of strings (refused in `parse`); results map to the wire shape. */

describe("newsletterSendTestCampaignRoute", () => {
  it("keeps the method and path and reads the addresses", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/send-test", undefined, undefined]);
    expect(route.parse(raw({ id: "camp-1" }, { testAddresses: ["a@b.test"] }))).toEqual({ ok: true, value: { id: "camp-1", testAddresses: ["a@b.test"] } });
    // An empty list is the send pipeline's own 1-10 bound to refuse, not this route's.
    expect(route.parse(raw({ id: "camp-1" }, { testAddresses: [] }))).toEqual({ ok: true, value: { id: "camp-1", testAddresses: [] } });
  });

  it.each([[undefined], [{}], [{ testAddresses: "a@b.test" }], [{ testAddresses: ["a@b.test", 3] }]])("refuses body %j with the host's flat 400", async (body) => {
    expect(await refusalOf(() => route.parse(raw({ id: "camp-1" }, body)))).toEqual({
      status: 400, body: { error: "testAddresses must be an array of email strings", code: "VALIDATION_ERROR" },
    });
  });

  it("sends through the injected collaborator and maps each result to { address, ok, errorCode[, message] }", async () => {
    const calls: unknown[] = [];
    const deps = {
      ...baseDeps(),
      sendTestCampaign: async (i: unknown) => {
        calls.push(i);
        return { results: [
          { email: "a@b.test", outcome: "sent" as const, error: null, errorCode: "IGNORED" },
          { email: "c@d.test", outcome: "failed" as const, error: "smtp down", errorCode: "MAILER_ERROR" },
          { email: "e@f.test", outcome: "failed" as const, error: null },
        ] };
      },
    };
    const result = await route.handle({ input: { id: "camp-1", testAddresses: ["a@b.test"] }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(calls).toEqual([{ workspaceId: WORKSPACE_ID, campaignId: "camp-1", testAddresses: ["a@b.test"] }]);
    expect(result).toEqual({ ok: true, value: { data: { results: [
      { address: "a@b.test", ok: true, errorCode: null },
      { address: "c@d.test", ok: false, errorCode: "MAILER_ERROR", message: "smtp down" },
      { address: "e@f.test", ok: false, errorCode: null, message: null },
    ] } } });
  });
});
