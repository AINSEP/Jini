import { describe, expect, it } from "vitest";
import { newsletterScheduleCampaignRoute as route } from "../schedule-campaign.js";
import { baseDeps, fakeCampaign, NOW, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file SCHEDULE_CAMPAIGN: an optional string scheduledAt (absent/null = now), refused in `parse` otherwise. */

function deps(scheduled: unknown[]) {
  return { ...baseDeps(), clock: { nowIso: () => NOW }, scheduleCampaign: async (input: unknown) => { scheduled.push(input); return { campaign: fakeCampaign({ status: "scheduled" }) }; } };
}

describe("newsletterScheduleCampaignRoute", () => {
  it("keeps the method and path and reads scheduledAt only as a string", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/campaigns/:id/schedule", undefined, undefined]);
    expect(route.parse(raw({ id: "camp-1" }, { scheduledAt: "2027-01-01T00:00:00Z" }))).toEqual({ ok: true, value: { id: "camp-1", scheduledAt: "2027-01-01T00:00:00Z" } });
    expect(route.parse(raw({ id: "camp-1" }, { scheduledAt: null }))).toEqual({ ok: true, value: { id: "camp-1", scheduledAt: undefined } });
    expect(route.parse(raw({ id: "camp-1" }, undefined))).toEqual({ ok: true, value: { id: "camp-1", scheduledAt: undefined } });
  });

  it.each([[5], [{}], [true]])("refuses scheduledAt %j with the host's NEWSLETTER_VALIDATION_ERROR 400", async (scheduledAt) => {
    expect(await refusalOf(() => route.parse(raw({ id: "camp-1" }, { scheduledAt })))).toEqual({
      status: 400, body: { error: "scheduledAt must be a date-time string when provided", code: "NEWSLETTER_VALIDATION_ERROR" },
    });
  });

  it("schedules at the caller's time, or now when absent, as the principal", async () => {
    const scheduled: unknown[] = [];
    const result = await route.handle({ input: { id: "camp-1", scheduledAt: "2027-01-01T00:00:00Z" }, deps: deps(scheduled), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    await route.handle({ input: { id: "camp-1", scheduledAt: undefined }, deps: deps(scheduled), context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(scheduled).toEqual([
      { workspaceId: WORKSPACE_ID, id: "camp-1", actorId: PRINCIPAL.id, scheduledAt: "2027-01-01T00:00:00Z" },
      { workspaceId: WORKSPACE_ID, id: "camp-1", actorId: PRINCIPAL.id, scheduledAt: NOW },
    ]);
    expect(result).toEqual({ ok: true, value: { data: fakeCampaign({ status: "scheduled" }) } });
  });
});

it("a bodyless schedule request reaches the scheduler at the injected current time", async () => {
  const scheduled: unknown[] = [];
  const parsed = await route.parse({ params: { id: "camp-1" }, body: undefined, query: {} });
  if (!parsed.ok) throw new Error("an omitted schedule time must parse");
  expect(await route.handle({ input: parsed.value, deps: deps(scheduled), context: PRINCIPAL, authorize: recordingAuthorize().authorize }))
    .toEqual({ ok: true, value: { data: fakeCampaign({ status: "scheduled" }) } });
  expect(scheduled).toStrictEqual([{ workspaceId: WORKSPACE_ID, id: "camp-1", actorId: PRINCIPAL.id, scheduledAt: NOW }]);
});
