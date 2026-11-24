import { describe, expect, it } from "vitest";
import { newsletterCreateCampaignRoute as route } from "../create-campaign.js";
import { baseDeps, fakeCampaign, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file CREATE_CAMPAIGN: five required strings + an object bodyJson, refused in `parse` (before auth); saved as the principal. */

const VALID = { subject: "Autumn", fromName: "Acme", fromEmail: "news@acme.test", replyTo: "help@acme.test", listId: "list-1", bodyJson: { type: "doc" } };
const REFUSAL = { status: 400, body: { error: "subject, fromName, fromEmail, replyTo, listId (strings) and bodyJson (object) are required", code: "VALIDATION_ERROR" } };

describe("newsletterCreateCampaignRoute", () => {
  it("keeps the method and path and answers 201", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns", 201, undefined]);
  });

  it("parses the fields, defaulting a non-string preheader to null", () => {
    expect(route.parse(raw({}, { ...VALID, preheader: 3, extra: true }))).toEqual({ ok: true, value: { fields: { ...VALID, preheader: null } } });
    expect(route.parse(raw({}, { ...VALID, preheader: "Hi" }))).toEqual({ ok: true, value: { fields: { ...VALID, preheader: "Hi" } } });
  });

  it.each<readonly [string, unknown]>([
    ["a missing body", undefined],
    ...["subject", "fromName", "fromEmail", "replyTo", "listId"].map((name): readonly [string, unknown] => [`a non-string ${name}`, { ...VALID, [name]: 1 }]),
    ["a null bodyJson", { ...VALID, bodyJson: null }],
    ["an array bodyJson", { ...VALID, bodyJson: [] }],
    ["a string bodyJson", { ...VALID, bodyJson: "doc" }],
  ])("refuses %s with the host's flat 400", async (_label, body) => {
    expect(await refusalOf(() => route.parse(raw({}, body)))).toEqual(REFUSAL);
  });

  it("saves the parsed fields in this workspace as the authenticated principal", async () => {
    const saved: unknown[] = [];
    const deps = { ...baseDeps(), saveCampaign: async (input: unknown) => { saved.push(input); return { campaign: fakeCampaign() }; } };
    const result = await route.handle({ input: { fields: { ...VALID, preheader: null } }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(saved).toEqual([{ workspaceId: WORKSPACE_ID, actorId: PRINCIPAL.id, fields: { ...VALID, preheader: null } }]);
    expect(result).toEqual({ ok: true, value: { data: fakeCampaign() } });
  });

  it("fails closed without an authenticated principal", async () => {
    const deps = { ...baseDeps(), saveCampaign: async () => ({ campaign: fakeCampaign() }) };
    await expect(route.handle({ input: { fields: { ...VALID, preheader: null } }, deps, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});
