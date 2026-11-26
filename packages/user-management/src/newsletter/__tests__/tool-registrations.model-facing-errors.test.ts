import { expect, it } from "vitest";
import { InMemoryNewsletterCampaignRepo, InMemoryNewsletterListRepo } from "../repo.memory.js";
import { createNewsletterUpdateCampaignHandler } from "../tool-registrations.write.js";
import type { NewsletterToolDeps } from "../tool-registrations.js";
import type { CampaignRecord } from "../types.js";

it("newsletter_update_campaign clears an explicit null preheader and preserves an omitted one", async () => {
  const now = "2026-11-25T00:00:00.000Z";
  const campaign: CampaignRecord = {
    id: "campaign-1", workspaceId: "ws-1", status: "draft", subject: "Original", preheader: "Preview text",
    fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test", listId: "list-1",
    scheduledAt: null, sendStartedAt: null, audienceSnapshotId: null,
    counters: { recipients: 0, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 },
    version: 1, createdByPrincipal: "actor-1", createdAt: now, updatedAt: now,
  };
  const campaignRepo = new InMemoryNewsletterCampaignRepo({ campaigns: [campaign] });
  const listRepo = new InMemoryNewsletterListRepo({}, { initialRows: [{
    id: "list-1", workspaceId: "ws-1", name: "Readers", slug: "readers", isDefault: true,
    status: "active", createdAt: now, updatedAt: now,
  }] });
  // Deliberately partial fake: the update handler reads only these ports, never the mailer/outbox/bus wiring.
  const deps = {
    workspaceId: "ws-1", authorize: async () => ({ allowed: true, reason: "test" }),
    newsletterReady: Promise.resolve(), newsletterCampaignRepo: campaignRepo, newsletterListRepo: listRepo,
    clock: { nowIso: () => now }, idGen: { newId: () => "unused" },
  } as unknown as NewsletterToolDeps;
  const handler = createNewsletterUpdateCampaignHandler(deps);
  const context = { principal: { id: "actor-1" }, signal: new AbortController().signal };

  const omitted = await handler({ ...context, input: { campaignId: campaign.id, subject: "Changed" } } as never);
  expect(omitted).toMatchObject({ campaign: { subject: "Changed", preheader: "Preview text" } });
  expect(await campaignRepo.findById({ workspaceId: "ws-1", id: campaign.id })).toMatchObject({ subject: "Changed", preheader: "Preview text" });

  const cleared = await handler({ ...context, input: { campaignId: campaign.id, preheader: null } } as never);
  expect(cleared).toMatchObject({ campaign: { subject: "Changed", preheader: null } });
  expect(await campaignRepo.findById({ workspaceId: "ws-1", id: campaign.id })).toMatchObject({ subject: "Changed", preheader: null });
});
