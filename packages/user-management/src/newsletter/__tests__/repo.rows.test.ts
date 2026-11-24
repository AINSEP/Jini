import assert from "node:assert/strict";
import { test } from "vitest";
import { toCampaignRevision } from "../repo.rows.js";
import type { CampaignRecord } from "../types.js";

test("campaign revision decoding keeps its envelope separate from the historical campaign state", () => {
  // F1.2/F4.3: the revision's actor, sequence and timestamp differ from the snapshot's author, version and timestamp.
  // Returning state.updatedAt as recordedAt must fail even when actor and subject are correct.
  const historical: CampaignRecord = {
    id: "campaign-7", workspaceId: "historical-ws", status: "scheduled", subject: "Café dispatch",
    preheader: "Preview", fromName: "Editorial", fromEmail: "editor@example.test", replyTo: "",
    listId: "list-4", scheduledAt: "2026-10-02T09:00:00.000Z", sendStartedAt: null,
    audienceSnapshotId: "audience-3", counters: { recipients: 19, delivered: 7, failed: 2, bounced: 1, complained: 3, unsubscribed: 4 },
    version: 6, createdByPrincipal: "author", createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-30T09:00:00.000Z",
  };
  const stateText = '{"id":"campaign-7","workspaceId":"historical-ws","status":"scheduled","subject":"Café dispatch","preheader":"Preview","fromName":"Editorial","fromEmail":"editor@example.test","replyTo":"","listId":"list-4","scheduledAt":"2026-10-02T09:00:00.000Z","sendStartedAt":null,"audienceSnapshotId":"audience-3","counters":{"recipients":19,"delivered":7,"failed":2,"bounced":1,"complained":3,"unsubscribed":4},"version":6,"createdByPrincipal":"author","createdAt":"2026-09-01T09:00:00.000Z","updatedAt":"2026-09-30T09:00:00.000Z"}';
  assert.deepEqual(toCampaignRevision({ campaign_id: "campaign-7", workspace_id: "historical-ws", seq: 12,
    state_json: stateText, actor_id: "reviewer", recorded_at: "2026-10-01T12:00:00.000Z" }), {
    campaignId: "campaign-7", workspaceId: "historical-ws", seq: 12, state: historical,
    actorId: "reviewer", recordedAt: "2026-10-01T12:00:00.000Z",
  });
});
