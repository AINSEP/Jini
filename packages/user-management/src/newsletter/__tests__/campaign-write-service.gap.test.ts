import { describe, expect, it } from "vitest";

import {
  PREHEADER_MAX, SUBJECT_MAX, cancelCampaign, isValidScheduleTimestamp, saveCampaign, scheduleCampaign,
  type CampaignWriteServiceDeps,
} from "../campaign-write-service.js";
import {
  NewsletterCampaignNotEditableError, NewsletterCampaignNotFoundError, NewsletterConflictError,
  NewsletterListNotFoundError, NewsletterValidationError,
} from "../errors.js";
import { InMemoryNewsletterCampaignRepo, InMemoryNewsletterListRepo } from "../repo.memory.js";

/**
 * @file The campaign write chokepoint over the in-memory repos: field validation, list checks,
 * create vs. edit (status and optimistic version), revision sequencing, cancel and schedule transitions.
 */
function setup() {
  const campaignRepo = new InMemoryNewsletterCampaignRepo();
  const listRepo = new InMemoryNewsletterListRepo({}, { initialRows: [
    { id: "l1", workspaceId: "w1", name: "All", slug: "all", isDefault: true, status: "active", createdAt: "t", updatedAt: "t" },
    { id: "l2", workspaceId: "w1", name: "Old", slug: "old", isDefault: false, status: "archived", createdAt: "t", updatedAt: "t" },
  ] });
  let tick = 0;
  let idSeq = 0;
  const deps: CampaignWriteServiceDeps = {
    campaignRepo, listRepo,
    clock: { nowIso: () => `2026-03-01T00:00:0${tick++}.000Z` },
    ids: { newId: () => `c${++idSeq}` },
  };
  return { deps, campaignRepo };
}

const fields = { subject: "Hello", fromName: "F", fromEmail: "f@example.test", replyTo: "r@example.test", listId: "l1" };
const create = (deps: CampaignWriteServiceDeps, extra: Record<string, unknown> = {}) =>
  saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", fields, ...extra } });

describe("saveCampaign validation", () => {
  it.each([
    ["", "subject", `subject must be between 1 and ${SUBJECT_MAX} characters`],
    ["x".repeat(SUBJECT_MAX + 1), "subject", `subject must be between 1 and ${SUBJECT_MAX} characters`],
  ])("rejects a subject of length %#", async (subject, field, message) => {
    const { deps } = setup();
    const err = await saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", fields: { ...fields, subject } } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NewsletterValidationError);
    expect(err).toMatchObject({ field, reason: "length", message });
  });

  it("accepts a preheader at the limit and rejects one past it", async () => {
    const { deps } = setup();
    const ok = await saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", fields: { ...fields, preheader: "p".repeat(PREHEADER_MAX) } } });
    expect(ok.campaign.preheader).toHaveLength(PREHEADER_MAX);
    const err = saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", fields: { ...fields, preheader: "p".repeat(PREHEADER_MAX + 1) } } });
    await expect(err).rejects.toMatchObject({ field: "preheader", reason: "length", message: `preheader must be at most ${PREHEADER_MAX} characters` });
  });

  it("rejects a missing list and an archived list", async () => {
    const { deps } = setup();
    await expect(saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", fields: { ...fields, listId: "nope" } } }))
      .rejects.toThrow(new NewsletterListNotFoundError("list nope was not found"));
    await expect(saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", fields: { ...fields, listId: "l2" } } }))
      .rejects.toMatchObject({ field: "listId", reason: "archived", message: "This list is archived." });
  });
});

describe("saveCampaign create and edit", () => {
  it("creates a draft with zero counters, person creator by default and revision 1", async () => {
    const { deps, campaignRepo } = setup();
    const { campaign, revisionSeq } = await create(deps);
    expect(revisionSeq).toBe(1);
    expect(campaign).toEqual({
      id: "c1", workspaceId: "w1", status: "draft", subject: "Hello", preheader: null, fromName: "F",
      fromEmail: "f@example.test", replyTo: "r@example.test", listId: "l1", scheduledAt: null, sendStartedAt: null,
      audienceSnapshotId: null, counters: { recipients: 0, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 },
      version: 1, createdByPrincipal: "a1", createdByKind: "person", createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z",
    });
    const revisions = await campaignRepo.listRevisions({ workspaceId: "w1", campaignId: "c1" });
    expect(revisions).toEqual([{ campaignId: "c1", workspaceId: "w1", seq: 1, state: campaign, actorId: "a1", recordedAt: "2026-03-01T00:00:01.000Z" }]);
  });

  it("records an agent creator and stores the body when given", async () => {
    const { deps } = setup();
    const { campaign } = await saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", creatorKind: "agent", fields: { ...fields, bodyJson: { blocks: [] } } } });
    expect(campaign.createdByKind).toBe("agent");
    expect(campaign.bodyJson).toEqual({ blocks: [] });
  });

  it("edits a draft, bumps the version and appends the next revision", async () => {
    const { deps, campaignRepo } = setup();
    await create(deps);
    const { campaign, revisionSeq } = await saveCampaign({ deps, input: {
      workspaceId: "w1", id: "c1", actorId: "a2", expectedVersion: 1, fields: { ...fields, subject: "Edited", preheader: "pre" },
    } });
    expect(revisionSeq).toBe(2);
    expect(campaign).toMatchObject({ id: "c1", subject: "Edited", preheader: "pre", version: 2, createdByPrincipal: "a1", updatedAt: "2026-03-01T00:00:02.000Z" });
    expect(await campaignRepo.findById({ workspaceId: "w1", id: "c1" })).toMatchObject({ subject: "Edited", version: 2 });
  });

  it("clears the preheader when an edit omits it", async () => {
    const { deps } = setup();
    await saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", fields: { ...fields, preheader: "pre" } } });
    const { campaign } = await saveCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1", fields } });
    expect(campaign.preheader).toBeNull();
  });

  it("rejects editing an unknown campaign, a stale version, and a non-draft", async () => {
    const { deps } = setup();
    await create(deps);
    await expect(saveCampaign({ deps, input: { workspaceId: "w1", id: "zz", actorId: "a1", fields } }))
      .rejects.toThrow(new NewsletterCampaignNotFoundError("campaign zz was not found"));
    const stale = await saveCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1", expectedVersion: 7, fields } }).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(NewsletterConflictError);
    expect(stale).toMatchObject({ entity: "campaign", id: "c1", expectedVersion: 7, actualVersion: 1 });
    await cancelCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1" } });
    const locked = await saveCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1", fields } }).catch((e: unknown) => e);
    expect(locked).toBeInstanceOf(NewsletterCampaignNotEditableError);
    expect(locked).toMatchObject({ currentStatus: "canceled", attemptedAction: "update", message: "campaign is 'canceled' and cannot be edited" });
  });
});

describe("cancelCampaign and scheduleCampaign", () => {
  it("cancels a draft and refuses to cancel twice or an unknown campaign", async () => {
    const { deps, campaignRepo } = setup();
    await create(deps);
    const { campaign } = await cancelCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1" } });
    expect(campaign).toMatchObject({ status: "canceled", updatedAt: "2026-03-01T00:00:02.000Z" });
    expect((await campaignRepo.listRevisions({ workspaceId: "w1", campaignId: "c1" })).map((r) => r.seq)).toEqual([1, 2]);
    await expect(cancelCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1" } }))
      .rejects.toMatchObject({ currentStatus: "canceled", attemptedAction: "transition-to-canceled" });
    await expect(cancelCampaign({ deps, input: { workspaceId: "w1", id: "zz", actorId: "a1" } }))
      .rejects.toThrow("campaign zz was not found");
  });

  it("schedules a draft at a valid timestamp", async () => {
    const { deps } = setup();
    await create(deps);
    const { campaign } = await scheduleCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1", scheduledAt: "2026-04-01T09:00:00+02:00" } });
    expect(campaign).toMatchObject({ status: "scheduled", scheduledAt: "2026-04-01T09:00:00+02:00", version: 1 });
    await expect(scheduleCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1", scheduledAt: "2026-04-02T09:00:00Z" } }))
      .rejects.toMatchObject({ currentStatus: "scheduled", attemptedAction: "schedule" });
  });

  it("refuses bad timestamps and unknown campaigns", async () => {
    const { deps } = setup();
    await expect(scheduleCampaign({ deps, input: { workspaceId: "w1", id: "c1", actorId: "a1", scheduledAt: "tomorrow" } }))
      .rejects.toMatchObject({ field: "scheduledAt", reason: "format", message: "scheduledAt must be a valid ISO date-time string" });
    await expect(scheduleCampaign({ deps, input: { workspaceId: "w1", id: "zz", actorId: "a1", scheduledAt: "2026-04-01T09:00:00Z" } }))
      .rejects.toThrow("campaign zz was not found");
  });

  it("validates schedule timestamps: zone required, impossible dates refused", () => {
    expect(isValidScheduleTimestamp({ value: "2026-04-01T09:00:00.123Z" })).toBe(true);
    expect(isValidScheduleTimestamp({ value: "2026-04-01T09:00:00" })).toBe(false);
    expect(isValidScheduleTimestamp({ value: "2026-02-30T09:00:00Z" })).toBe(false);
    expect(isValidScheduleTimestamp({ value: "2026-13-01T09:00:00Z" })).toBe(false);
  });
});
