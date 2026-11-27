import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { SqlMemberConsentRepo, SqlMemberSubscriptionRepo, SqlMemberTierRepo } from "../repo.js";
import type { MemberConsentRecord, MemberSubscriptionRecord, MemberTierRecord } from "../types.js";
import type { TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import { MEMBER_TABLES, membersDb } from "./members-sqlite.js";

/**
 * @file Tier, subscription and consent SQL repositories against a real in-memory SQLite database:
 * slug lookup and the optimistic tier update, active-subscription filtering by status and period,
 * consent upsert, the revision ledger filtered by purpose, and the kernel transaction.
 */
let db: TestSqliteKernel;
beforeEach(async () => { db = await membersDb(); });
afterEach(async () => { await db.close(); });

const tier = (over: Partial<MemberTierRecord> = {}): MemberTierRecord => ({
  id: "t1", workspaceId: "w1", name: "Gold", slug: "gold", type: "paid", status: "active", visibleInPortal: true,
  createdAt: "c", updatedAt: "c", version: 1, ...over,
} as MemberTierRecord);

describe("SqlMemberTierRepo", () => {
  it("finds by id and slug, lists the workspace, and upserts without a version", async () => {
    const repo = new SqlMemberTierRepo({ kernel: db.kernel, tables: MEMBER_TABLES });
    await repo.save(tier());
    await repo.save(tier({ id: "t2", slug: "free", type: "free" }));
    await repo.save(tier({ name: "Gold+" }));
    expect(await repo.findById({ workspaceId: "w1", id: "t1" })).toMatchObject({ name: "Gold+", visibleInPortal: true });
    expect(await repo.findBySlug({ workspaceId: "w1", slug: "free" })).toMatchObject({ id: "t2" });
    expect(await repo.findBySlug({ workspaceId: "w2", slug: "free" })).toBeNull();
    expect(await repo.findById({ workspaceId: "w1", id: "zz" })).toBeNull();
    expect((await repo.list({ workspaceId: "w1" })).map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("updates only at the expected version and reports the current one on conflict", async () => {
    const repo = new SqlMemberTierRepo({ kernel: db.kernel, tables: MEMBER_TABLES });
    await repo.save(tier());
    await repo.save(tier({ name: "V2", version: 2 }), { expectedVersion: 1 });
    expect(await repo.findById({ workspaceId: "w1", id: "t1" })).toMatchObject({ name: "V2", version: 2 });
    const stale = await repo.save(tier({ name: "Lost", version: 2 }), { expectedVersion: 1 }).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(RecordVersionConflictError);
    expect(stale).toMatchObject({ expectedVersion: 1, currentVersion: 2 });
    const missing = await repo.save(tier({ id: "gone" }), { expectedVersion: 1 }).catch((e: unknown) => e);
    expect(missing).toMatchObject({ currentVersion: null });
  });
});

describe("SqlMemberSubscriptionRepo", () => {
  const subscription = (over: Partial<MemberSubscriptionRecord>): MemberSubscriptionRecord => ({
    id: "s1", workspaceId: "w1", memberId: "m1", tierId: "t1", status: "active", source: "manual",
    startedAt: "2026-01-01", createdAt: "c", updatedAt: "c", version: 1, ...over,
  } as MemberSubscriptionRecord);

  it("finds by id, lists by member, and lists only active/comped subscriptions still in period", async () => {
    const repo = new SqlMemberSubscriptionRepo({ kernel: db.kernel, tables: MEMBER_TABLES });
    await repo.save(subscription({ id: "open" }));
    await repo.save(subscription({ id: "future", status: "comped", currentPeriodEnd: "2026-12-01" }));
    await repo.save(subscription({ id: "ended", currentPeriodEnd: "2026-05-01" }));
    await repo.save(subscription({ id: "canceled", status: "canceled" }));
    await repo.save(subscription({ id: "other", memberId: "m2" }));
    await repo.save(subscription({ id: "open", externalRef: "ext-1" }));
    expect(await repo.findById({ workspaceId: "w1", id: "open" })).toMatchObject({ externalRef: "ext-1" });
    expect(await repo.findById({ workspaceId: "w2", id: "open" })).toBeNull();
    expect((await repo.listByMember({ workspaceId: "w1", memberId: "m1" })).map((s) => s.id).sort()).toEqual(["canceled", "ended", "future", "open"]);
    const active = await repo.listActiveByMember({ workspaceId: "w1", memberId: "m1", nowIso: "2026-06-01" });
    expect(active.map((s) => s.id).sort()).toEqual(["future", "open"]);
  });
});

describe("SqlMemberConsentRepo", () => {
  const consent = (over: Partial<MemberConsentRecord> = {}): MemberConsentRecord => ({
    id: "c1", workspaceId: "w1", memberId: "m1", purpose: "newsletter", status: "granted", evidence: { source: "form" } as never,
    grantedAt: "g", createdAt: "c", updatedAt: "c", version: 1, ...over,
  } as MemberConsentRecord);
  const revision = (purpose: string, createdAt: string) => ({
    workspaceId: "w1", memberId: "m1", consentId: "c1", purpose, op: "consent_confirm", beforeJson: null,
    afterJson: { status: "granted" }, originModule: "test", createdAt,
  } as never);

  it("upserts by id, finds by member and purpose, and lists revisions oldest first, optionally by purpose", async () => {
    const repo = new SqlMemberConsentRepo({ kernel: db.kernel, tables: MEMBER_TABLES });
    await repo.save(consent());
    await repo.save(consent({ status: "revoked", revokedAt: "r", version: 2 }));
    expect(await repo.findByMemberAndPurpose({ workspaceId: "w1", memberId: "m1", purpose: "newsletter" }))
      .toMatchObject({ status: "revoked", revokedAt: "r", evidence: { source: "form" }, version: 2 });
    expect(await repo.findByMemberAndPurpose({ workspaceId: "w1", memberId: "m1", purpose: "other" })).toBeNull();
    const first = await repo.transaction({ fn: () => repo.appendRevision(revision("newsletter", "t1")) });
    expect(db.events).toEqual(["begin", "commit"]);
    const second = await repo.appendRevision(revision("other", "t2"));
    expect(second).toBe(first + 1);
    expect((await repo.listRevisions({ workspaceId: "w1", memberId: "m1" })).map((r) => r.seq)).toEqual([first, second]);
    const onlyOther = await repo.listRevisions({ workspaceId: "w1", memberId: "m1", purpose: "other" });
    expect(onlyOther).toEqual([{ seq: second, workspaceId: "w1", memberId: "m1", consentId: "c1", purpose: "other", op: "consent_confirm", beforeJson: null, afterJson: { status: "granted" }, originModule: "test", createdAt: "t2" }]);
  });
});
