import { describe, expect, it } from "vitest";
import {
  InMemoryNewsletterAudienceSnapshotRepo,
  InMemoryNewsletterCampaignRepo,
  InMemoryNewsletterConfirmationTokenRepo,
  InMemoryNewsletterListRepo,
  InMemoryNewsletterSendRepo,
  InMemoryNewsletterSubscriptionRepo,
} from "../repo.memory.js";
import type { CampaignRecord, CampaignStatus, NewsletterListRow, SendRow, SubscriptionRow } from "../types.js";

const at = "2026-03-01T10:00:00.000Z";
const later = "2026-03-01T11:00:00.000Z";
const zeroCounters = { recipients: 0, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 };

function campaign(id: string, overrides: { workspaceId?: string; status?: CampaignStatus; subject?: string } = {}): CampaignRecord {
  return {
    id, workspaceId: overrides.workspaceId ?? "w", status: overrides.status ?? "draft", subject: overrides.subject ?? `subject ${id}`,
    preheader: null, fromName: "Desk", fromEmail: "desk@example.test", replyTo: "reply@example.test", listId: "list",
    scheduledAt: null, sendStartedAt: null, audienceSnapshotId: null, counters: { ...zeroCounters }, version: 1,
    createdByPrincipal: "owner", createdAt: at, updatedAt: at,
  };
}
function send(id: string, overrides: Partial<SendRow> = {}): SendRow {
  return {
    id, workspaceId: "w", campaignId: "camp", audienceSnapshotId: "snap", subscriberId: `person-${id}`, recipientEmail: `${id}@example.test`,
    status: "pending", attempts: 0, idempotencyKey: `key-${id}`, providerMessageId: null, lastError: null, nextAttemptAt: null,
    createdAt: at, updatedAt: at, ...overrides,
  };
}
function subscription(id: string, overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id, workspaceId: "w", listId: "list", subscriberId: `person-${id}`, status: "subscribed", source: "admin",
    consentRevisionIdAtSubscribe: null, subscribedAt: at, unsubscribedAt: null, createdAt: at, updatedAt: at, ...overrides,
  };
}
function list(id: string, overrides: Partial<NewsletterListRow> = {}): NewsletterListRow {
  return { id, workspaceId: "w", name: `List ${id}`, slug: id, isDefault: false, status: "active", createdAt: at, updatedAt: at, ...overrides };
}

describe("InMemoryNewsletterCampaignRepo", () => {
  it("hasSending is true only for a sending campaign in the asked workspace", async () => {
    const repo = new InMemoryNewsletterCampaignRepo({ campaigns: [campaign("a", { status: "scheduled" }), campaign("b", { workspaceId: "other", status: "sending" })] });
    expect(await repo.hasSending({ workspaceId: "w" })).toBe(false);
    expect(await repo.hasSending({ workspaceId: "other" })).toBe(true);
    await repo.saveCampaignRow(campaign("a", { status: "sending" }));
    expect(await repo.hasSending({ workspaceId: "w" })).toBe(true);
  });

  it("findById is workspace-scoped and returns null for a miss", async () => {
    const repo = new InMemoryNewsletterCampaignRepo({ campaigns: [campaign("a")] });
    expect((await repo.findById({ workspaceId: "w", id: "a" }))?.subject).toBe("subject a");
    expect(await repo.findById({ workspaceId: "other", id: "a" })).toBeNull();
    expect(await repo.findById({ workspaceId: "w", id: "missing" })).toBeNull();
  });

  it("list pages by id within the workspace and follows the returned cursor", async () => {
    const repo = new InMemoryNewsletterCampaignRepo({ campaigns: [campaign("c"), campaign("a"), campaign("x", { workspaceId: "other" }), campaign("b")] });
    const first = await repo.list({ workspaceId: "w" }, { limit: 2 });
    expect(first.items.map(c => c.id)).toEqual(["a", "b"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await repo.list({ workspaceId: "w" }, { limit: 2, cursor: first.nextCursor });
    expect(second).toEqual({ items: [expect.objectContaining({ id: "c" })], nextCursor: null });
  });

  it("list caps an oversized limit at 100 rows", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `c${String(i).padStart(3, "0")}`);
    const repo = new InMemoryNewsletterCampaignRepo({ campaigns: ids.map(id => campaign(id)) });
    const page = await repo.list({ workspaceId: "w" }, { limit: 500 });
    expect(page.items).toHaveLength(100);
    expect(page.items.at(-1)?.id).toBe("c099");
    expect(page.nextCursor).not.toBeNull();
    expect((await repo.list({ workspaceId: "w" })).items).toHaveLength(100);
  });

  it("list refuses a malformed cursor even for an empty workspace", async () => {
    const repo = new InMemoryNewsletterCampaignRepo();
    await expect(repo.list({ workspaceId: "w" }, { cursor: "not-a-cursor" })).rejects.toThrow("invalid cursor");
  });

  it("saveCampaignRow inserts, then on update keeps the stored counters (incrementCounter owns them)", async () => {
    const repo = new InMemoryNewsletterCampaignRepo();
    await repo.saveCampaignRow({ ...campaign("a"), counters: { ...zeroCounters, recipients: 3 } });
    await repo.saveCampaignRow({ ...campaign("a", { subject: "renamed" }), counters: { ...zeroCounters, recipients: 99, delivered: 99 } });
    expect(await repo.findById({ workspaceId: "w", id: "a" })).toEqual({ ...campaign("a", { subject: "renamed" }), counters: { ...zeroCounters, recipients: 3 } });
  });

  it("listRevisions returns only the campaign's revisions, ordered by seq", async () => {
    const repo = new InMemoryNewsletterCampaignRepo();
    const state = campaign("a");
    await repo.appendRevision({ campaignId: "a", workspaceId: "w", seq: 2, state, actorId: "owner", recordedAt: later });
    await repo.appendRevision({ campaignId: "b", workspaceId: "w", seq: 1, state, actorId: "owner", recordedAt: at });
    await repo.appendRevision({ campaignId: "a", workspaceId: "other", seq: 1, state, actorId: "owner", recordedAt: at });
    await repo.appendRevision({ campaignId: "a", workspaceId: "w", seq: 1, state, actorId: "owner", recordedAt: at });
    expect((await repo.listRevisions({ workspaceId: "w", campaignId: "a" })).map(r => [r.seq, r.recordedAt])).toEqual([[1, at], [2, later]]);
  });

  it("transaction runs fn and passes through its result and its rejection", async () => {
    const repo = new InMemoryNewsletterCampaignRepo();
    expect(await repo.transaction({ fn: async () => "done" })).toBe("done");
    await expect(repo.transaction({ fn: async () => { throw new Error("rolled"); } })).rejects.toThrow("rolled");
  });

  it("incrementCounter adds one to the named counter and stamps updatedAt; an unknown campaign is a no-op", async () => {
    const repo = new InMemoryNewsletterCampaignRepo({ campaigns: [{ ...campaign("a"), counters: { ...zeroCounters, delivered: 4, failed: 1 } }] });
    const before = await repo.findById({ workspaceId: "w", id: "a" });
    await repo.incrementCounter({ workspaceId: "w", id: "a", counter: "delivered", updatedAt: later });
    await repo.incrementCounter({ workspaceId: "w", id: "missing", counter: "failed", updatedAt: later });
    await repo.incrementCounter({ workspaceId: "other", id: "a", counter: "failed", updatedAt: later });
    const after = await repo.findById({ workspaceId: "w", id: "a" });
    expect(after?.counters).toEqual({ ...zeroCounters, delivered: 5, failed: 1 });
    expect(after?.updatedAt).toBe(later);
    expect(before?.counters.delivered).toBe(4);
  });
});

describe("InMemoryNewsletterListRepo", () => {
  it("finds by id and the workspace default, lists the workspace, and save upserts", async () => {
    const repo = new InMemoryNewsletterListRepo({}, { initialRows: [list("a"), list("b", { isDefault: true }), list("c", { workspaceId: "other", isDefault: true })] });
    expect((await repo.findById({ workspaceId: "w", id: "a" }))?.name).toBe("List a");
    expect(await repo.findById({ workspaceId: "other", id: "a" })).toBeNull();
    expect((await repo.findDefault({ workspaceId: "w" }))?.id).toBe("b");
    expect(await repo.findDefault({ workspaceId: "none" })).toBeNull();
    await repo.save(list("a", { name: "Renamed" }));
    await repo.save(list("d"));
    expect((await repo.list({ workspaceId: "w" })).map(r => [r.id, r.name])).toEqual([["a", "Renamed"], ["b", "List b"], ["d", "List d"]]);
  });
});

describe("InMemoryNewsletterSubscriptionRepo", () => {
  it("findBySubscriberAndList needs workspace, list and subscriber to all match", async () => {
    const repo = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: [subscription("a"), subscription("b", { listId: "other-list", subscriberId: "person-a" })] });
    expect((await repo.findBySubscriberAndList({ workspaceId: "w", listId: "list", subscriberId: "person-a" }))?.id).toBe("a");
    expect((await repo.findBySubscriberAndList({ workspaceId: "w", listId: "other-list", subscriberId: "person-a" }))?.id).toBe("b");
    expect(await repo.findBySubscriberAndList({ workspaceId: "other", listId: "list", subscriberId: "person-a" })).toBeNull();
    expect(await repo.findBySubscriberAndList({ workspaceId: "w", listId: "list", subscriberId: "nobody" })).toBeNull();
  });

  it("list pages one list's rows by id, caps the limit at 100 and refuses a malformed cursor", async () => {
    const rows = [subscription("s3"), subscription("s1"), subscription("s2"), subscription("x", { listId: "other-list" })];
    const repo = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: rows });
    const first = await repo.list({ workspaceId: "w", listId: "list" }, { limit: 2 });
    expect(first.items.map(r => r.id)).toEqual(["s1", "s2"]);
    const second = await repo.list({ workspaceId: "w", listId: "list" }, { cursor: first.nextCursor });
    expect(second.items.map(r => r.id)).toEqual(["s3"]);
    expect(second.nextCursor).toBeNull();
    await expect(new InMemoryNewsletterSubscriptionRepo().list({ workspaceId: "w", listId: "list" }, { cursor: "%%" })).rejects.toThrow("invalid cursor");
    const many = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: Array.from({ length: 101 }, (_, i) => subscription(`s${String(i).padStart(3, "0")}`)) });
    expect((await many.list({ workspaceId: "w", listId: "list" }, { limit: 101 })).items).toHaveLength(100);
  });

  it("listSubscribed keeps only subscribed rows of the list, save upserts, and remove deletes one row in its workspace", async () => {
    const repo = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: [
      subscription("a"), subscription("b", { status: "pending" }), subscription("c", { listId: "other-list" }), subscription("d", { workspaceId: "other" }),
    ] });
    expect((await repo.listSubscribed({ workspaceId: "w", listId: "list" })).map(r => r.id)).toEqual(["a"]);
    await repo.save(subscription("b"));
    await repo.save(subscription("e", { listId: "list" }));
    expect((await repo.listSubscribed({ workspaceId: "w", listId: "list" })).map(r => r.id)).toEqual(["a", "b", "e"]);
    await repo.remove({ workspaceId: "other", id: "a" });
    expect((await repo.findById({ workspaceId: "w", id: "a" }))?.id).toBe("a");
    await repo.remove({ workspaceId: "w", id: "a" });
    expect(await repo.findById({ workspaceId: "w", id: "a" })).toBeNull();
    expect((await repo.findById({ workspaceId: "other", id: "d" }))?.id).toBe("d");
  });
});

describe("InMemoryNewsletterAudienceSnapshotRepo", () => {
  const snapshot = { id: "snap", workspaceId: "w", campaignId: "camp", listId: "list", recipientCount: 3, createdAt: at };
  it("finds a snapshot by campaign and by id within the workspace", async () => {
    const repo = new InMemoryNewsletterAudienceSnapshotRepo({}, { initialRows: [snapshot] });
    expect(await repo.findByCampaignId({ workspaceId: "w", campaignId: "camp" })).toEqual(snapshot);
    expect(await repo.findByCampaignId({ workspaceId: "other", campaignId: "camp" })).toBeNull();
    expect(await repo.findById({ workspaceId: "w", id: "snap" })).toEqual(snapshot);
    expect(await repo.findById({ workspaceId: "w", id: "missing" })).toBeNull();
  });

  it("save is create-only: a second save of the same id throws and leaves the first row", async () => {
    const repo = new InMemoryNewsletterAudienceSnapshotRepo();
    await repo.save(snapshot);
    await expect(repo.save({ ...snapshot, recipientCount: 9 })).rejects.toThrow("AudienceSnapshotRow snap already exists and is immutable");
    expect((await repo.findById({ workspaceId: "w", id: "snap" }))?.recipientCount).toBe(3);
    await repo.save({ ...snapshot, workspaceId: "other" });
    expect((await repo.findById({ workspaceId: "other", id: "snap" }))?.workspaceId).toBe("other");
  });
});

describe("InMemoryNewsletterSendRepo", () => {
  it("finds a send by id and by idempotency key within the workspace", async () => {
    const repo = new InMemoryNewsletterSendRepo({}, { initialRows: [send("a"), send("b", { workspaceId: "other" })] });
    expect((await repo.findById({ workspaceId: "w", id: "a" }))?.recipientEmail).toBe("a@example.test");
    expect(await repo.findById({ workspaceId: "w", id: "b" })).toBeNull();
    expect((await repo.findByIdempotencyKey({ workspaceId: "w", idempotencyKey: "key-a" }))?.id).toBe("a");
    expect(await repo.findByIdempotencyKey({ workspaceId: "w", idempotencyKey: "key-b" })).toBeNull();
  });

  it("listByCampaign sorts by id, resumes after afterId and honours the limit", async () => {
    const repo = new InMemoryNewsletterSendRepo({}, { initialRows: [send("c"), send("a"), send("d"), send("b"), send("z", { campaignId: "other" })] });
    expect((await repo.listByCampaign({ workspaceId: "w", campaignId: "camp" })).map(r => r.id)).toEqual(["a", "b", "c", "d"]);
    expect((await repo.listByCampaign({ workspaceId: "w", campaignId: "camp", afterId: "b", limit: 1 })).map(r => r.id)).toEqual(["c"]);
    expect((await repo.listByCampaign({ workspaceId: "w", campaignId: "camp", afterId: "", limit: 2 })).map(r => r.id)).toEqual(["a", "b"]);
  });

  it("pending queries count and list only pending rows of the snapshot/campaign", async () => {
    const repo = new InMemoryNewsletterSendRepo();
    await repo.saveBatch({ rows: [send("a"), send("b"), send("c", { status: "delivered" }), send("d", { audienceSnapshotId: "snap-2", campaignId: "camp-2" }), send("e")] });
    expect((await repo.listPendingByAudienceSnapshot({ workspaceId: "w", audienceSnapshotId: "snap", limit: 2 })).map(r => r.id)).toEqual(["a", "b"]);
    expect((await repo.listPendingByAudienceSnapshot({ workspaceId: "w", audienceSnapshotId: "snap-2", limit: 10 })).map(r => r.id)).toEqual(["d"]);
    expect(await repo.countPendingByCampaign({ workspaceId: "w", campaignId: "camp" })).toBe(3);
    expect(await repo.countPendingByCampaign({ workspaceId: "other", campaignId: "camp" })).toBe(0);
  });

  it("claimForDispatch leases a due pending row and refuses missing, non-pending and not-yet-due rows", async () => {
    const repo = new InMemoryNewsletterSendRepo({}, { initialRows: [
      send("due", { nextAttemptAt: at }), send("fresh"), send("future", { nextAttemptAt: later }), send("done", { status: "delivered" }),
    ] });
    const claim = (id: string) => repo.claimForDispatch({ workspaceId: "w", id, nowIso: at, leaseUntilIso: later });
    expect(await claim("due")).toEqual({ ...send("due"), nextAttemptAt: later, updatedAt: at });
    expect(await claim("fresh")).toEqual({ ...send("fresh"), nextAttemptAt: later, updatedAt: at });
    expect(await claim("future")).toBeNull();
    expect(await claim("done")).toBeNull();
    expect(await claim("missing")).toBeNull();
    expect(await claim("due")).toBeNull();
    expect((await repo.findById({ workspaceId: "w", id: "due" }))?.nextAttemptAt).toBe(later);
  });

  it("recordOutcome records once per pending row, keeping the old provider id when none is given", async () => {
    const repo = new InMemoryNewsletterSendRepo({}, { initialRows: [send("a", { attempts: 2, providerMessageId: "prov-old", nextAttemptAt: later }), send("b")] });
    const failed = await repo.recordOutcome({ workspaceId: "w", id: "a", status: "failed", providerMessageId: null, lastError: "bounced", updatedAt: later });
    expect(failed).toEqual({ ...send("a"), status: "failed", attempts: 3, providerMessageId: "prov-old", lastError: "bounced", nextAttemptAt: null, updatedAt: later });
    expect(await repo.findById({ workspaceId: "w", id: "a" })).toEqual(failed);
    expect(await repo.recordOutcome({ workspaceId: "w", id: "a", status: "delivered", providerMessageId: "prov-new", lastError: null, updatedAt: later })).toBeNull();
    expect(await repo.recordOutcome({ workspaceId: "w", id: "missing", status: "delivered", providerMessageId: null, lastError: null, updatedAt: later })).toBeNull();
    const delivered = await repo.recordOutcome({ workspaceId: "w", id: "b", status: "delivered", providerMessageId: "prov-b", lastError: null, updatedAt: later });
    expect(delivered?.providerMessageId).toBe("prov-b");
    expect(delivered?.attempts).toBe(1);
  });
});

describe("InMemoryNewsletterConfirmationTokenRepo", () => {
  const token = { id: "t1", workspaceId: "w", subscriptionId: "sub", tokenHash: "hash-1", purpose: "newsletter_subscription_confirm" as const, createdAt: at, expiresAt: later, consumedAt: null };
  it("finds by token hash only inside the workspace and lists unconsumed tokens of a subscription", async () => {
    const repo = new InMemoryNewsletterConfirmationTokenRepo({}, { initialRows: [token, { ...token, id: "t2", tokenHash: "hash-2", consumedAt: at }, { ...token, id: "t3", subscriptionId: "sub-2" }] });
    expect((await repo.findByTokenHash({ workspaceId: "w", tokenHash: "hash-2" }))?.id).toBe("t2");
    expect(await repo.findByTokenHash({ workspaceId: "other", tokenHash: "hash-1" })).toBeNull();
    expect((await repo.findUnconsumedBySubscription({ workspaceId: "w", subscriptionId: "sub" })).map(t => t.id)).toEqual(["t1"]);
    expect(await repo.findUnconsumedBySubscription({ workspaceId: "other", subscriptionId: "sub" })).toEqual([]);
  });

  it("save upserts by workspace and id, and findById reads the stored row back", async () => {
    const repo = new InMemoryNewsletterConfirmationTokenRepo();
    await repo.save(token);
    await repo.save({ ...token, workspaceId: "other" });
    await repo.save({ ...token, consumedAt: later });
    expect(await repo.findById({ workspaceId: "w", id: "t1" })).toEqual({ ...token, consumedAt: later });
    expect((await repo.findById({ workspaceId: "other", id: "t1" }))?.consumedAt).toBeNull();
    expect(await repo.findById({ workspaceId: "w", id: "t9" })).toBeNull();
  });
});
