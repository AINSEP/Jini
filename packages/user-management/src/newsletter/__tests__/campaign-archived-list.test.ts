import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { saveCampaign } from "../campaign-write-service.js";
import { NewsletterValidationError } from "../errors.js";
import { InMemoryNewsletterCampaignRepo, InMemoryNewsletterListRepo } from "../repo.memory.js";
import type { CampaignRecord } from "../types.js";

const NOW = "2026-11-24T00:00:00.000Z";
const campaign: CampaignRecord = {
  id: "campaign-1", workspaceId: "ws-1", status: "draft", subject: "Original", preheader: null,
  fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test", listId: "list-1",
  scheduledAt: null, sendStartedAt: null, audienceSnapshotId: null,
  counters: { recipients: 0, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 },
  version: 3, createdByPrincipal: "actor-1", createdAt: NOW, updatedAt: NOW,
};

test.each(["create", "edit"])("saveCampaign refuses an archived list before writing a campaign or revision", async (mode) => {
  const campaignRepo = new InMemoryNewsletterCampaignRepo({ campaigns: [campaign] });
  const rowWrites = vi.spyOn(campaignRepo, "saveCampaignRow");
  const revisionWrites = vi.spyOn(campaignRepo, "appendRevision");
  const transactions = vi.spyOn(campaignRepo, "transaction");
  const listRepo = new InMemoryNewsletterListRepo({}, { initialRows: [{
    id: "list-1", workspaceId: "ws-1", name: "Archived", slug: "archived", isDefault: false,
    status: "archived", createdAt: NOW, updatedAt: NOW,
  }] });

  await assert.rejects(saveCampaign({
    deps: { campaignRepo, listRepo, clock: { nowIso: () => NOW }, ids: { newId: () => "new-campaign" } },
    input: {
      workspaceId: "ws-1", actorId: "actor-1",
      ...(mode === "edit" ? { id: campaign.id, expectedVersion: campaign.version } : {}),
      fields: { subject: "Changed", fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test", listId: "list-1" },
    },
  }), (error: unknown) => {
    assert.ok(error instanceof NewsletterValidationError);
    assert.equal(error.field, "listId");
    assert.equal(error.reason, "archived");
    assert.equal(error.message, "This list is archived.");
    return true;
  });

  assert.equal(rowWrites.mock.calls.length, 0);
  assert.equal(revisionWrites.mock.calls.length, 0);
  assert.equal(transactions.mock.calls.length, 0);
  const stored = await campaignRepo.findById({ workspaceId: "ws-1", id: campaign.id });
  assert.equal(stored?.version, 3);
  assert.deepEqual(stored, campaign);
});
