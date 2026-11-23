import { describe, expect, it } from "vitest";
import { newsletterUpdateCampaignRoute as route } from "../update-campaign.js";
import { baseDeps, fakeCampaign, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file UPDATE_CAMPAIGN: a partial PATCH validated in `parse`, merged over the stored campaign, saved with an optional expectedVersion. */

function deps(saved: unknown[], existing = fakeCampaign({ preheader: "Old", bodyJson: { type: "old" } })) {
  return {
    ...baseDeps(),
    newsletterCampaignRepo: { findById: async () => existing },
    saveCampaign: async (input: unknown) => { saved.push(input); return { campaign: fakeCampaign({ status: "draft" }) }; },
  };
}

describe("newsletterUpdateCampaignRoute", () => {
  it("keeps the method and path and passes a valid partial body through", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["patch", "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id", undefined, undefined]);
    expect(route.parse(raw({ id: "camp-1" }, { subject: "New", expectedVersion: 0 }))).toEqual({ ok: true, value: { id: "camp-1", body: { subject: "New", expectedVersion: 0 } } });
    expect(route.parse(raw({ id: "camp-1" }, undefined))).toEqual({ ok: true, value: { id: "camp-1", body: {} } });
  });

  it.each([
    ...["subject", "preheader", "fromName", "fromEmail", "replyTo", "listId"].map((name) => [{ [name]: null }, `${name} must be a string when provided`] as const),
    [{ subject: 1, bodyJson: null }, "subject must be a string when provided"],
    [{ bodyJson: null }, "bodyJson must be an object when provided"],
    [{ bodyJson: [] }, "bodyJson must be an object when provided"],
    [{ bodyJson: "x" }, "bodyJson must be an object when provided"],
    [{ bodyJson: [], expectedVersion: -1 }, "bodyJson must be an object when provided"],
    [{ expectedVersion: -1 }, "expectedVersion must be a non-negative integer when provided"],
    [{ expectedVersion: 1.5 }, "expectedVersion must be a non-negative integer when provided"],
    [{ expectedVersion: "1" }, "expectedVersion must be a non-negative integer when provided"],
  ])("refuses %j in parse with the first violation", async (body, error) => {
    expect(await refusalOf(() => route.parse(raw({ id: "camp-1" }, body)))).toEqual({ status: 400, body: { error, code: "VALIDATION_ERROR" } });
  });

  it("merges every omitted field from the stored campaign and saves as the principal", async () => {
    const saved: unknown[] = [];
    const result = await route.handle({ input: { id: "camp-1", body: { subject: "New" } }, deps: deps(saved), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    const existing = fakeCampaign({ preheader: "Old", bodyJson: { type: "old" } });
    expect(saved).toEqual([{
      workspaceId: WORKSPACE_ID, id: "camp-1", actorId: PRINCIPAL.id, expectedVersion: undefined,
      fields: { subject: "New", bodyJson: existing.bodyJson, preheader: "Old", fromName: existing.fromName, fromEmail: existing.fromEmail, replyTo: existing.replyTo, listId: existing.listId },
    }]);
    expect(result).toEqual({ ok: true, value: { data: fakeCampaign({ status: "draft" }) } });
  });

  it("overwrites every provided field and forwards expectedVersion", async () => {
    const saved: unknown[] = [];
    const body = { subject: "S", preheader: "P", fromName: "F", fromEmail: "E", replyTo: "R", listId: "L", bodyJson: { type: "new" }, expectedVersion: 4 };
    await route.handle({ input: { id: "camp-1", body }, deps: deps(saved), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    const { expectedVersion, ...fields } = body;
    expect(saved).toEqual([{ workspaceId: WORKSPACE_ID, id: "camp-1", actorId: PRINCIPAL.id, expectedVersion, fields }]);
  });

  it("refuses an unknown campaign with the host's exact 404 body and saves nothing", async () => {
    const saved: unknown[] = [];
    const missing = { ...deps(saved), newsletterCampaignRepo: { findById: async () => null } };
    expect(await refusalOf(() => route.handle({ input: { id: "nope", body: {} }, deps: missing, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({
      status: 404, body: { error: "campaign nope was not found", code: "NEWSLETTER_CAMPAIGN_NOT_FOUND" },
    });
    expect(saved).toEqual([]);
  });
});
