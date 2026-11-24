import { describe, expect, it, vi } from "vitest";

import { SqlNewsletterCampaignRepo } from "../repo.js";
import { SqlNewsletterAudienceSnapshotRepo, SqlNewsletterSendRepo } from "../repo-sends.js";
import { SqlNewsletterConfirmationTokenRepo, SqlNewsletterListRepo, SqlNewsletterSubscriptionRepo } from "../repo-subscribers.js";
import type { NewsletterSqlTables } from "../repo.rows.js";
import { createSqlHarness } from "./sql-harness.js";

/**
 * @file Pins the two seams the SQL adapters gained when they left the host: every table name comes
 * from the host's `tables` (no schema default in the adapter), and an unreadable campaign revision
 * goes to the host-bound `onUnreadableBody` reporter with identity and sequence only.
 */
const TABLES: NewsletterSqlTables = {
  campaigns: "host_campaigns",
  campaignRevisions: "host_campaign_revisions",
  lists: "host_lists",
  subscriptions: "host_subscriptions",
  audienceSnapshots: "host_snapshots",
  sends: "host_sends",
  confirmationTokens: "host_tokens",
};

function campaignRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "c1", workspace_id: "w1", status: "draft", subject: "S", preheader: null, from_name: "F",
    from_email: "f@example.test", reply_to: "r@example.test", list_id: "l1", scheduled_at: null,
    send_started_at: null, audience_snapshot_id: null, counters_json: "{\"delivered\":0}", version: 1,
    created_by_principal: "p1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("newsletter SQL repos: host-owned table names", () => {
  it("queries every repo's tables by the names the host passes", async () => {
    const h = createSqlHarness();
    const onUnreadableBody = vi.fn();
    await new SqlNewsletterCampaignRepo({ kernel: h.kernel, tables: TABLES, onUnreadableBody }).findById({ workspaceId: "w1", id: "c1" });
    await new SqlNewsletterListRepo({ kernel: h.kernel, tables: TABLES }).list({ workspaceId: "w1" });
    await new SqlNewsletterSubscriptionRepo({ kernel: h.kernel, tables: TABLES }).listSubscribed({ workspaceId: "w1", listId: "l1" });
    await new SqlNewsletterConfirmationTokenRepo({ kernel: h.kernel, tables: TABLES }).findById({ workspaceId: "w1", id: "t1" });
    await new SqlNewsletterAudienceSnapshotRepo({ kernel: h.kernel, tables: TABLES }).findById({ workspaceId: "w1", id: "a1" });
    await new SqlNewsletterSendRepo({ kernel: h.kernel, tables: TABLES }).countPendingByCampaign({ workspaceId: "w1", campaignId: "c1" });
    const [campaign, list, subscriptions, tokens, snapshots, sends] = h.statements.map((s) => s.sql);
    expect(campaign).toContain('from "host_campaigns"');
    expect(campaign).toContain('from "host_campaign_revisions" where "campaign_id" = "host_campaigns"."id" and "workspace_id" = "host_campaigns"."workspace_id"');
    expect(list).toContain('from "host_lists"');
    expect(subscriptions).toContain('from "host_subscriptions"');
    expect(tokens).toContain('from "host_tokens"');
    expect(snapshots).toContain('from "host_snapshots"');
    expect(sends).toContain('from "host_sends"');
    expect(h.statements.map((s) => s.sql).join("\n")).not.toMatch(/newsletter_campaign|p_newsletter__/);
  });
});

describe("SqlNewsletterCampaignRepo: unreadable revision body", () => {
  it("reports identity and sequence only and keeps the envelope readable", async () => {
    const h = createSqlHarness();
    const onUnreadableBody = vi.fn();
    h.queue.push([campaignRow({ editorial_state_json: "{not json: private text", editorial_seq: 7 })]);
    const record = await new SqlNewsletterCampaignRepo({ kernel: h.kernel, tables: TABLES, onUnreadableBody }).findById({ workspaceId: "w1", id: "c1" });
    expect(record?.id).toBe("c1");
    expect(record && "bodyJson" in record).toBe(false);
    expect(onUnreadableBody).toHaveBeenCalledTimes(1);
    expect(onUnreadableBody).toHaveBeenCalledWith({ campaignId: "c1", seq: 7 });
  });

  it("reads a valid revision body without reporting", async () => {
    const h = createSqlHarness();
    const onUnreadableBody = vi.fn();
    h.queue.push([campaignRow({ editorial_state_json: JSON.stringify({ bodyJson: { type: "doc" } }), editorial_seq: 2 })]);
    const record = await new SqlNewsletterCampaignRepo({ kernel: h.kernel, tables: TABLES, onUnreadableBody }).findById({ workspaceId: "w1", id: "c1" });
    expect(record?.bodyJson).toEqual({ type: "doc" });
    expect(onUnreadableBody).not.toHaveBeenCalled();
  });

  it("list maps every envelope through the same reporter-carrying mapper", async () => {
    const h = createSqlHarness();
    const onUnreadableBody = vi.fn();
    h.queue.push([campaignRow({ id: "c1" }), campaignRow({ id: "c2" })]);
    const page = await new SqlNewsletterCampaignRepo({ kernel: h.kernel, tables: TABLES, onUnreadableBody }).list({ workspaceId: "w1" });
    expect(page.items.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(h.statements[0]?.sql).toContain('from "host_campaigns" where "workspace_id" = ?');
  });
});
