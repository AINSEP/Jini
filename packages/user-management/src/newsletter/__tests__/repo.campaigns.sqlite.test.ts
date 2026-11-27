import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelCampaign, saveCampaign, type CampaignWriteServiceDeps } from "../campaign-write-service.js";
import { SqlNewsletterCampaignRepo } from "../repo.js";
import { SqlNewsletterListRepo } from "../repo-subscribers.js";
import type { TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import { NEWSLETTER_TABLES, newsletterDb, selectRows } from "./newsletter-sqlite.js";

/**
 * @file The campaign SQL repository against a real in-memory SQLite database, driven through the
 * campaign write service: rows and revisions land together under the campaign lock, the latest
 * revision body is read back, re-saves keep counters and the creator kind, list paging, the sending
 * probe and the locked counter increment.
 */
let db: TestSqliteKernel;
let repo: SqlNewsletterCampaignRepo;
let deps: CampaignWriteServiceDeps;
const onUnreadableBody = vi.fn();
beforeEach(async () => {
  db = await newsletterDb();
  onUnreadableBody.mockClear();
  repo = new SqlNewsletterCampaignRepo({ kernel: db.kernel, tables: NEWSLETTER_TABLES, onUnreadableBody });
  const listRepo = new SqlNewsletterListRepo({ kernel: db.kernel, tables: NEWSLETTER_TABLES });
  await listRepo.save({ id: "l1", workspaceId: "w1", name: "All", slug: "all", isDefault: true, status: "active", createdAt: "t", updatedAt: "t" });
  let n = 0;
  deps = { campaignRepo: repo, listRepo, clock: { nowIso: () => `2026-03-01T00:00:0${n}.000Z` }, ids: { newId: () => `c${++n}` } };
});
afterEach(async () => { await db.close(); });

const fields = { subject: "Hello", fromName: "F", fromEmail: "f@example.test", replyTo: "r@example.test", listId: "l1" };
const create = (extra: Record<string, unknown> = {}) => saveCampaign({ deps, input: { workspaceId: "w1", actorId: "a1", fields, ...extra } });

describe("SqlNewsletterCampaignRepo writes", () => {
  it("writes the row and its revision in one transaction under the campaign lock and reads the body back", async () => {
    const { campaign, revisionSeq } = await create({ creatorKind: "agent", fields: { ...fields, bodyJson: { blocks: ["x"] } } });
    expect(db.events).toEqual(["begin", "lock:newsletter:campaigns", "commit"]);
    expect(revisionSeq).toBe(1);
    expect(await repo.findById({ workspaceId: "w1", id: campaign.id })).toEqual(campaign);
    expect(await repo.findById({ workspaceId: "w2", id: campaign.id })).toBeNull();
    const revisions = await repo.listRevisions({ workspaceId: "w1", campaignId: campaign.id });
    expect(revisions).toEqual([{ campaignId: campaign.id, workspaceId: "w1", seq: 1, state: campaign, actorId: "a1", recordedAt: revisions[0]?.recordedAt }]);
    expect(onUnreadableBody).not.toHaveBeenCalled();
  });

  it("keeps counters and the write-once creator kind on a re-save, and reads the latest revision", async () => {
    const { campaign } = await create({ creatorKind: "agent", fields: { ...fields, bodyJson: { v: 1 } } });
    await repo.incrementCounter({ workspaceId: "w1", id: campaign.id, counter: "delivered", updatedAt: "t-inc" });
    await repo.saveCampaignRow({ ...campaign, createdByKind: "person", counters: { ...campaign.counters, delivered: 99 } });
    await saveCampaign({ deps, input: { workspaceId: "w1", id: campaign.id, actorId: "a2", fields: { ...fields, subject: "Two", bodyJson: { v: 2 } } } });
    const stored = await repo.findById({ workspaceId: "w1", id: campaign.id });
    expect(stored).toMatchObject({ subject: "Two", bodyJson: { v: 2 }, createdByKind: "agent", version: 2 });
    expect(stored?.counters.delivered).toBe(1);
    expect((await repo.listRevisions({ workspaceId: "w1", campaignId: campaign.id })).map((r) => r.seq)).toEqual([1, 2]);
  });

  it("rolls the row back when the transaction body fails", async () => {
    const { campaign } = await create();
    await expect(repo.transaction({ fn: async () => {
      await repo.saveCampaignRow({ ...campaign, subject: "Lost" });
      throw new Error("abort");
    } })).rejects.toThrow("abort");
    expect(await selectRows(db, "select subject from nl_campaigns")).toEqual([{ subject: "Hello" }]);
  });
});

describe("SqlNewsletterCampaignRepo reads and counters", () => {
  it("pages envelopes by id with a cursor and rejects a malformed cursor", async () => {
    await create();
    await create();
    await create();
    const first = await repo.list({ workspaceId: "w1" }, { limit: 2 });
    expect(first.items.map((c) => c.id)).toEqual(["c1", "c2"]);
    const second = await repo.list({ workspaceId: "w1" }, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((c) => c.id)).toEqual(["c3"]);
    expect(second.nextCursor).toBeNull();
    expect((await repo.list({ workspaceId: "w1" })).items).toHaveLength(3);
    expect((await repo.list({ workspaceId: "w2" })).items).toEqual([]);
    await expect(repo.list({ workspaceId: "w1" }, { cursor: "garbage" })).rejects.toThrow(/invalid cursor/);
  });

  it("reports whether any campaign in the workspace is sending", async () => {
    const { campaign } = await create();
    expect(await repo.hasSending({ workspaceId: "w1" })).toBe(false);
    await repo.saveCampaignRow({ ...campaign, status: "sending" });
    expect(await repo.hasSending({ workspaceId: "w1" })).toBe(true);
    expect(await repo.hasSending({ workspaceId: "w2" })).toBe(false);
  });

  it("increments one counter under the campaign lock, starts an absent counter at zero, and ignores unknown campaigns", async () => {
    const { campaign } = await cancelCampaign({ deps, input: { workspaceId: "w1", id: (await create()).campaign.id, actorId: "a1" } });
    await db.exec(`update nl_campaigns set counters_json = '{"delivered":2}' where id = '${campaign.id}'`);
    await repo.incrementCounter({ workspaceId: "w1", id: campaign.id, counter: "delivered", updatedAt: "t-a" });
    await repo.incrementCounter({ workspaceId: "w1", id: campaign.id, counter: "failed", updatedAt: "t-b" });
    expect(db.events).toContain(`lock:newsletter:campaign:w1:${campaign.id}`);
    expect(await selectRows(db, "select counters_json, updated_at from nl_campaigns")).toEqual([{ counters_json: '{"delivered":3,"failed":1}', updated_at: "t-b" }]);
    await repo.incrementCounter({ workspaceId: "w1", id: "missing", counter: "delivered", updatedAt: "t-c" });
    expect(await selectRows(db, "select count(*) as n from nl_campaigns")).toEqual([{ n: 1 }]);
  });
});
