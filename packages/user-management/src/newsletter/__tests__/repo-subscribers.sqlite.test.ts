import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_LIST_LIMIT, SqlNewsletterConfirmationTokenRepo, SqlNewsletterListRepo, SqlNewsletterSubscriptionRepo } from "../repo-subscribers.js";
import type { ConfirmationTokenRecord, NewsletterListRow, SubscriptionRow } from "../types.js";
import type { TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import { NEWSLETTER_TABLES, newsletterDb, selectRows } from "./newsletter-sqlite.js";

/**
 * @file The list, subscription and confirmation-token SQL repositories against a real in-memory SQLite
 * database: workspace-scoped lookups, the default list, cursor paging, subscribed-only listing, the
 * columns each upsert may change, and removal.
 */
let db: TestSqliteKernel;
beforeEach(async () => { db = await newsletterDb(); });
afterEach(async () => { await db.close(); });

const list = (over: Partial<NewsletterListRow> = {}): NewsletterListRow => ({
  id: "l1", workspaceId: "w1", name: "All", slug: "all", isDefault: false, status: "active", createdAt: "t0", updatedAt: "t0", ...over,
});
const sub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  id: "s1", workspaceId: "w1", listId: "l1", subscriberId: "p1", status: "subscribed", source: "admin",
  consentRevisionIdAtSubscribe: null, subscribedAt: "t0", unsubscribedAt: null, createdAt: "t0", updatedAt: "t0", ...over,
});
const token = (over: Partial<ConfirmationTokenRecord> = {}): ConfirmationTokenRecord => ({
  id: "k1", workspaceId: "w1", subscriptionId: "s1", tokenHash: "h1", purpose: "newsletter_subscription_confirm",
  createdAt: "t0", expiresAt: "t9", consumedAt: null, ...over,
});

describe("SqlNewsletterListRepo", () => {
  it("finds by id, finds the default, lists by id, and upserts all but identity and creation time", async () => {
    const repo = new SqlNewsletterListRepo({ kernel: db.kernel, tables: NEWSLETTER_TABLES });
    expect(await repo.findDefault({ workspaceId: "w1" })).toBeNull();
    await repo.save(list({ id: "l2" }));
    await repo.save(list({ id: "l1", isDefault: true }));
    await repo.save(list({ id: "x1", workspaceId: "w2", isDefault: true }));
    expect(await repo.findById({ workspaceId: "w1", id: "l1" })).toEqual(list({ isDefault: true }));
    expect(await repo.findById({ workspaceId: "w2", id: "l1" })).toBeNull();
    expect(await repo.findDefault({ workspaceId: "w1" })).toMatchObject({ id: "l1", isDefault: true });
    expect((await repo.list({ workspaceId: "w1" })).map((l) => l.id)).toEqual(["l1", "l2"]);
    await repo.save(list({ id: "l2", workspaceId: "w9", name: "Renamed", status: "archived", createdAt: "tX", updatedAt: "t1" }));
    expect(await repo.findById({ workspaceId: "w1", id: "l2" })).toEqual(list({ id: "l2", name: "Renamed", status: "archived", updatedAt: "t1" }));
  });
});

describe("SqlNewsletterSubscriptionRepo", () => {
  const repo = () => new SqlNewsletterSubscriptionRepo({ kernel: db.kernel, tables: NEWSLETTER_TABLES });

  it("finds by id and by subscriber+list within the workspace", async () => {
    await repo().save(sub());
    expect(await repo().findById({ workspaceId: "w1", id: "s1" })).toEqual(sub());
    expect(await repo().findBySubscriberAndList({ workspaceId: "w1", listId: "l1", subscriberId: "p1" })).toEqual(sub());
    expect(await repo().findById({ workspaceId: "w2", id: "s1" })).toBeNull();
    expect(await repo().findBySubscriberAndList({ workspaceId: "w1", listId: "l2", subscriberId: "p1" })).toBeNull();
  });

  it("pages a list's subscriptions with a resumable cursor and caps the limit", async () => {
    for (const id of ["s1", "s2", "s3"]) await repo().save(sub({ id, subscriberId: id }));
    await repo().save(sub({ id: "s0", listId: "l2" }));
    const first = await repo().list({ workspaceId: "w1", listId: "l1" }, { limit: 2 });
    expect(first.items.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await repo().list({ workspaceId: "w1", listId: "l1" }, { limit: 2, cursor: first.nextCursor });
    expect(second).toEqual({ items: [sub({ id: "s3", subscriberId: "s3" })], nextCursor: null });
    const all = await repo().list({ workspaceId: "w1", listId: "l1" }, { limit: DEFAULT_LIST_LIMIT + 50 });
    expect(all.items).toHaveLength(3);
    await expect(repo().list({ workspaceId: "w1", listId: "l1" }, { cursor: "garbage" })).rejects.toThrow(/invalid cursor/);
  });

  it("lists only subscribed rows, upserts only status columns, and removes by id in the workspace", async () => {
    await repo().save(sub());
    await repo().save(sub({ id: "s2", subscriberId: "p2", status: "pending" }));
    expect((await repo().listSubscribed({ workspaceId: "w1", listId: "l1" })).map((s) => s.id)).toEqual(["s1"]);
    await repo().save(sub({ status: "unsubscribed", unsubscribedAt: "t2", consentRevisionIdAtSubscribe: "rev-1", listId: "lX", source: "api", updatedAt: "t2" }));
    expect(await repo().findById({ workspaceId: "w1", id: "s1" })).toEqual(sub({ status: "unsubscribed", unsubscribedAt: "t2", consentRevisionIdAtSubscribe: "rev-1", updatedAt: "t2" }));
    await repo().remove({ workspaceId: "w2", id: "s1" });
    await repo().remove({ workspaceId: "w1", id: "s2" });
    expect(await selectRows(db, "select id from nl_subscriptions")).toEqual([{ id: "s1" }]);
  });
});

describe("SqlNewsletterConfirmationTokenRepo", () => {
  it("finds tokens by id, hash and unconsumed subscription, and a re-save only moves consumed_at", async () => {
    const repo = new SqlNewsletterConfirmationTokenRepo({ kernel: db.kernel, tables: NEWSLETTER_TABLES });
    await repo.save(token());
    await repo.save(token({ id: "k2", tokenHash: "h2", consumedAt: "t1" }));
    expect(await repo.findById({ workspaceId: "w1", id: "k1" })).toEqual(token());
    expect(await repo.findById({ workspaceId: "w2", id: "k1" })).toBeNull();
    expect(await repo.findByTokenHash({ workspaceId: "w1", tokenHash: "h2" })).toEqual(token({ id: "k2", tokenHash: "h2", consumedAt: "t1" }));
    expect(await repo.findByTokenHash({ workspaceId: "w1", tokenHash: "nope" })).toBeNull();
    expect((await repo.findUnconsumedBySubscription({ workspaceId: "w1", subscriptionId: "s1" })).map((t) => t.id)).toEqual(["k1"]);
    await repo.save(token({ tokenHash: "changed", expiresAt: "t99", consumedAt: "t3" }));
    expect(await repo.findById({ workspaceId: "w1", id: "k1" })).toEqual(token({ consumedAt: "t3" }));
  });
});
