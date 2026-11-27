import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqlNewsletterAudienceSnapshotRepo, SqlNewsletterSendRepo } from "../repo-sends.js";
import type { SendRow } from "../types.js";
import type { TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import { NEWSLETTER_TABLES, newsletterDb, selectRows } from "./newsletter-sqlite.js";

/**
 * @file The audience-snapshot and send SQL repositories against a real in-memory SQLite database:
 * workspace-scoped lookups, immutable snapshots, keyset paging, the pending count, upsert and batch
 * atomicity, the dispatch lease and the once-only outcome record.
 */
let db: TestSqliteKernel;
let sends: SqlNewsletterSendRepo;
beforeEach(async () => {
  db = await newsletterDb();
  sends = new SqlNewsletterSendRepo({ kernel: db.kernel, tables: NEWSLETTER_TABLES });
});
afterEach(async () => { await db.close(); });

const send = (over: Partial<SendRow> = {}): SendRow => ({
  id: "s1", workspaceId: "w1", campaignId: "c1", audienceSnapshotId: "a1", subscriberId: "sub1",
  recipientEmail: "r@example.test", status: "pending", attempts: 0, idempotencyKey: "k1",
  providerMessageId: null, lastError: null, nextAttemptAt: null, createdAt: "t0", updatedAt: "t0", ...over,
});

describe("SqlNewsletterAudienceSnapshotRepo", () => {
  it("saves once, finds by id and by campaign within the workspace, and refuses a second insert", async () => {
    const repo = new SqlNewsletterAudienceSnapshotRepo({ kernel: db.kernel, tables: NEWSLETTER_TABLES });
    const snap = { id: "a1", workspaceId: "w1", campaignId: "c1", listId: "l1", recipientCount: 3, createdAt: "t0" };
    await repo.save(snap);
    await repo.save({ ...snap, id: "a2" });
    expect(await repo.findById({ workspaceId: "w1", id: "a1" })).toEqual(snap);
    expect(await repo.findByCampaignId({ workspaceId: "w1", campaignId: "c1" })).toEqual(snap);
    expect(await repo.findById({ workspaceId: "w2", id: "a1" })).toBeNull();
    expect(await repo.findByCampaignId({ workspaceId: "w1", campaignId: "zz" })).toBeNull();
    await expect(repo.save({ ...snap, recipientCount: 9 })).rejects.toThrow(/UNIQUE constraint failed/);
    expect(await selectRows(db, "select recipient_count from nl_snapshots where id = 'a1'")).toEqual([{ recipient_count: 3 }]);
  });
});

describe("SqlNewsletterSendRepo reads", () => {
  beforeEach(async () => {
    await sends.saveBatch({ rows: [
      send(), send({ id: "s2", idempotencyKey: "k2", status: "delivered" }), send({ id: "s3", idempotencyKey: "k3" }),
      send({ id: "s4", idempotencyKey: "k4", campaignId: "c2", audienceSnapshotId: "a2" }),
    ] });
  });

  it("finds by id and idempotency key inside the workspace only", async () => {
    expect(await sends.findById({ workspaceId: "w1", id: "s1" })).toEqual(send());
    expect(await sends.findByIdempotencyKey({ workspaceId: "w1", idempotencyKey: "k2" })).toMatchObject({ id: "s2", status: "delivered" });
    expect(await sends.findById({ workspaceId: "w2", id: "s1" })).toBeNull();
    expect(await sends.findByIdempotencyKey({ workspaceId: "w1", idempotencyKey: "nope" })).toBeNull();
  });

  it("pages a campaign's sends by id, honouring afterId and limit", async () => {
    expect((await sends.listByCampaign({ workspaceId: "w1", campaignId: "c1" })).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect((await sends.listByCampaign({ workspaceId: "w1", campaignId: "c1", limit: 2 })).map((s) => s.id)).toEqual(["s1", "s2"]);
    expect((await sends.listByCampaign({ workspaceId: "w1", campaignId: "c1", afterId: "s1" })).map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("lists and counts only pending sends", async () => {
    expect((await sends.listPendingByAudienceSnapshot({ workspaceId: "w1", audienceSnapshotId: "a1", limit: 10 })).map((s) => s.id)).toEqual(["s1", "s3"]);
    expect((await sends.listPendingByAudienceSnapshot({ workspaceId: "w1", audienceSnapshotId: "a1", limit: 1 })).map((s) => s.id)).toEqual(["s1"]);
    expect(await sends.countPendingByCampaign({ workspaceId: "w1", campaignId: "c1" })).toBe(2);
    expect(await sends.countPendingByCampaign({ workspaceId: "w1", campaignId: "none" })).toBe(0);
  });
});

describe("SqlNewsletterSendRepo writes", () => {
  it("upserts the updatable columns on id", async () => {
    await sends.save(send());
    await sends.save(send({ status: "failed", attempts: 2, lastError: "boom", recipientEmail: "n@example.test", campaignId: "cX", updatedAt: "t1" }));
    expect(await sends.findById({ workspaceId: "w1", id: "s1" })).toEqual(send({
      status: "failed", attempts: 2, lastError: "boom", recipientEmail: "n@example.test", updatedAt: "t1",
    }));
  });

  it("saves a batch in one transaction and rolls the whole batch back on failure", async () => {
    await sends.saveBatch({ rows: [] });
    expect(db.events).toEqual([]);
    await sends.saveBatch({ rows: [send(), send({ id: "s2", idempotencyKey: "k2" })] });
    expect(db.events).toEqual(["begin", "commit"]);
    const broken = send({ id: "s3", recipientEmail: null as unknown as string });
    await expect(sends.saveBatch({ rows: [send({ id: "s9" }), broken] })).rejects.toThrow(/NOT NULL/);
    expect(await selectRows(db, "select id from nl_sends order by id")).toEqual([{ id: "s1" }, { id: "s2" }]);
  });

  it("claims a pending send only when its lease is free or expired", async () => {
    await sends.saveBatch({ rows: [send(), send({ id: "s2", idempotencyKey: "k2", status: "delivered" })] });
    const claimed = await sends.claimForDispatch({ workspaceId: "w1", id: "s1", nowIso: "t1", leaseUntilIso: "t5" });
    expect(claimed).toEqual(send({ nextAttemptAt: "t5", updatedAt: "t1" }));
    expect(await sends.claimForDispatch({ workspaceId: "w1", id: "s1", nowIso: "t2", leaseUntilIso: "t6" })).toBeNull();
    expect(await sends.claimForDispatch({ workspaceId: "w1", id: "s1", nowIso: "t5", leaseUntilIso: "t9" })).toMatchObject({ nextAttemptAt: "t9" });
    expect(await sends.claimForDispatch({ workspaceId: "w1", id: "s2", nowIso: "t1", leaseUntilIso: "t5" })).toBeNull();
  });

  it("records an outcome once, keeping the stored provider id when none is given", async () => {
    await sends.save(send({ providerMessageId: "pm-0", nextAttemptAt: "t5" }));
    const failed = await sends.recordOutcome({ workspaceId: "w1", id: "s1", status: "failed", providerMessageId: null, lastError: "bounce", updatedAt: "t2" });
    expect(failed).toEqual(send({ status: "failed", attempts: 1, providerMessageId: "pm-0", lastError: "bounce", nextAttemptAt: null, updatedAt: "t2" }));
    expect(await sends.recordOutcome({ workspaceId: "w1", id: "s1", status: "delivered", providerMessageId: "pm-1", lastError: null, updatedAt: "t3" })).toBeNull();
    await sends.save(send({ id: "s2", idempotencyKey: "k2" }));
    expect(await sends.recordOutcome({ workspaceId: "w1", id: "s2", status: "delivered", providerMessageId: "pm-2", lastError: null, updatedAt: "t3" }))
      .toMatchObject({ status: "delivered", providerMessageId: "pm-2", attempts: 1 });
  });
});
