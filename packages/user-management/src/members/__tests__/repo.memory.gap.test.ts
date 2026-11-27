import { describe, expect, it } from "vitest";
import {
  InMemoryMagicLinkTokenRepo,
  InMemoryMemberConsentRepo,
  InMemoryMemberExternalIdentityRepo,
  InMemoryMemberRepo,
  InMemoryMemberSubscriptionRepo,
  InMemoryMemberTierRepo,
} from "../repo.memory.js";
import type { MagicLinkTokenRecord, MemberExternalIdentityRecord, MemberRecord, MemberSubscriptionRecord, MemberTierRecord } from "../types.js";

const at = "2026-04-01T00:00:00.000Z";
const later = "2026-04-02T00:00:00.000Z";

function identity(id: string, overrides: Partial<MemberExternalIdentityRecord> = {}): MemberExternalIdentityRecord {
  return { id, workspaceId: "w", memberId: "m1", providerId: "google", issuer: "https://issuer.example.test", subject: `sub-${id}`, linkedAt: at, ...overrides };
}
function tier(id: string, overrides: Partial<MemberTierRecord> = {}): MemberTierRecord {
  return { id, workspaceId: "w", name: `Tier ${id}`, slug: id, type: "free", status: "active", visibleInPortal: true, createdAt: at, updatedAt: at, version: 1, ...overrides };
}
function token(id: string, overrides: Partial<MagicLinkTokenRecord> = {}): MagicLinkTokenRecord {
  return { id, workspaceId: "w", memberId: "m1", tokenHash: `hash-${id}`, purpose: "signin", createdAt: at, expiresAt: later, ...overrides };
}
function member(id: string, overrides: Partial<MemberRecord> = {}): MemberRecord {
  return { id, workspaceId: "w", email: `${id}@example.test`, status: "active", createdAt: at, updatedAt: at, version: 1, ...overrides };
}

describe("InMemoryMemberExternalIdentityRepo", () => {
  it("finds by subject and by member+provider within the workspace, returning copies", async () => {
    const repo = new InMemoryMemberExternalIdentityRepo({ initialRows: [identity("a"), identity("b", { workspaceId: "other" })] });
    const found = await repo.findBySubject({ workspaceId: "w", issuer: "https://issuer.example.test", subject: "sub-a" });
    expect(found).toEqual(identity("a"));
    if (found) found.subject = "mutated";
    expect((await repo.findByMemberAndProvider({ workspaceId: "w", memberId: "m1", providerId: "google" }))?.subject).toBe("sub-a");
    expect(await repo.findBySubject({ workspaceId: "w", issuer: "https://issuer.example.test", subject: "sub-b" })).toBeNull();
    expect(await repo.findByMemberAndProvider({ workspaceId: "w", memberId: "m1", providerId: "github" })).toBeNull();
  });

  it("lists a member's identities sorted by provider id", async () => {
    const repo = new InMemoryMemberExternalIdentityRepo({ initialRows: [
      identity("g", { providerId: "google" }), identity("a", { providerId: "apple" }), identity("k", { providerId: "keycloak" }), identity("x", { memberId: "m2", providerId: "aaa" }),
    ] });
    expect((await repo.listByMember({ workspaceId: "w", memberId: "m1" })).map(row => row.providerId)).toEqual(["apple", "google", "keycloak"]);
  });

  it("save refuses a second identity on either natural key, even after unlink", async () => {
    const repo = new InMemoryMemberExternalIdentityRepo({});
    await repo.save(identity("a"));
    await expect(repo.save(identity("b", { subject: "sub-a", providerId: "github" }))).rejects.toThrow("member identity already belongs to an association");
    await expect(repo.save(identity("c", { subject: "sub-c" }))).rejects.toThrow("member identity already belongs to an association");
    await repo.unlink({ workspaceId: "w", memberId: "m1", providerId: "google", unlinkedAt: later });
    await expect(repo.save(identity("d", { subject: "sub-a", memberId: "m2" }))).rejects.toThrow("member identity already belongs to an association");
    await repo.save(identity("e", { workspaceId: "other" }));
    expect(await repo.findBySubject({ workspaceId: "other", issuer: "https://issuer.example.test", subject: "sub-e" })).toEqual(identity("e", { workspaceId: "other" }));
  });

  it("an update may not move ownership, and only a relink may change claims or revive an unlinked row", async () => {
    const repo = new InMemoryMemberExternalIdentityRepo({ initialRows: [identity("a")] });
    for (const moved of [{ workspaceId: "other" }, { memberId: "m2" }, { providerId: "github" }]) {
      await expect(repo.save(identity("a", moved), { allowRelink: true })).rejects.toThrow("member identity changed; re-read it before updating");
    }
    await expect(repo.save(identity("a", { subject: "sub-new" }))).rejects.toThrow("member identity changed; re-read it before updating");
    await expect(repo.save(identity("a", { issuer: "https://other.example.test", subject: "sub-a" }))).rejects.toThrow("member identity changed");
    await repo.save(identity("a", { linkedAt: later }));
    expect((await repo.listByMember({ workspaceId: "w", memberId: "m1" }))[0]?.linkedAt).toBe(later);
    await repo.unlink({ workspaceId: "w", memberId: "m1", providerId: "google", unlinkedAt: later });
    await expect(repo.save(identity("a"))).rejects.toThrow("member identity changed");
    await repo.save(identity("a", { subject: "sub-relinked" }), { allowRelink: true });
    expect(await repo.findByMemberAndProvider({ workspaceId: "w", memberId: "m1", providerId: "google" })).toEqual(identity("a", { subject: "sub-relinked" }));
  });

  it("unlink stamps only the scoped live row and keeps the first unlink time", async () => {
    const repo = new InMemoryMemberExternalIdentityRepo({ initialRows: [identity("a"), identity("b", { providerId: "github", subject: "sub-b" }), identity("c", { workspaceId: "other" })] });
    await repo.unlink({ workspaceId: "w", memberId: "m1", providerId: "google", unlinkedAt: at });
    await repo.unlink({ workspaceId: "w", memberId: "m1", providerId: "google", unlinkedAt: later });
    expect((await repo.findByMemberAndProvider({ workspaceId: "w", memberId: "m1", providerId: "google" }))?.unlinkedAt).toBe(at);
    expect((await repo.findByMemberAndProvider({ workspaceId: "w", memberId: "m1", providerId: "github" }))?.unlinkedAt).toBeUndefined();
    expect((await repo.findByMemberAndProvider({ workspaceId: "other", memberId: "m1", providerId: "google" }))?.unlinkedAt).toBeUndefined();
  });
});

describe("InMemoryMemberRepo credentials", () => {
  it("a member without a stored hash reads null, and setting a hash for a missing or trashed member is refused", async () => {
    const repo = new InMemoryMemberRepo({}, { initialRows: [member("m1"), member("t1", { status: "trash" })] });
    expect(await repo.findPasswordHash({ workspaceId: "w", memberId: "m1" })).toBeNull();
    await expect(repo.setPasswordHash({ workspaceId: "w", memberId: "t1", passwordHash: "hash-x" })).rejects.toThrow("member was not found or is in Trash");
    await expect(repo.setPasswordHash({ workspaceId: "other", memberId: "m1", passwordHash: "hash-x" })).rejects.toThrow("member was not found or is in Trash");
    await repo.setPasswordHash({ workspaceId: "w", memberId: "m1", passwordHash: "hash-m1" });
    expect(await repo.findPasswordHash({ workspaceId: "w", memberId: "m1" })).toBe("hash-m1");
    expect(await repo.findPasswordHash({ workspaceId: "w", memberId: "t1" })).toBeNull();
    expect(await repo.findPasswordHash({ workspaceId: "other", memberId: "m1" })).toBeNull();
  });
});

describe("InMemoryMemberTierRepo", () => {
  it("finds by slug and lists within the workspace", async () => {
    const repo = new InMemoryMemberTierRepo({}, { initialRows: [tier("gold"), tier("silver"), tier("gold-x", { workspaceId: "other", slug: "gold" })] });
    expect((await repo.findBySlug({ workspaceId: "w", slug: "gold" }))?.id).toBe("gold");
    expect((await repo.findBySlug({ workspaceId: "other", slug: "gold" }))?.id).toBe("gold-x");
    expect(await repo.findBySlug({ workspaceId: "w", slug: "bronze" })).toBeNull();
    expect((await repo.list({ workspaceId: "w" })).map(row => row.id)).toEqual(["gold", "silver"]);
  });

  it("save upserts, and with expectedVersion refuses a stale or missing basis", async () => {
    const repo = new InMemoryMemberTierRepo({}, { initialRows: [tier("gold", { version: 2 })] });
    await repo.save(tier("gold", { name: "Gold+", version: 3 }), { expectedVersion: 2 });
    expect(await repo.findById({ workspaceId: "w", id: "gold" })).toEqual(tier("gold", { name: "Gold+", version: 3 }));
    await expect(repo.save(tier("gold", { name: "Stale", version: 3 }), { expectedVersion: 2 })).rejects.toThrow();
    await expect(repo.save(tier("ghost", { version: 2 }), { expectedVersion: 1 })).rejects.toThrow();
    expect((await repo.findById({ workspaceId: "w", id: "gold" }))?.name).toBe("Gold+");
    expect(await repo.findById({ workspaceId: "w", id: "ghost" })).toBeNull();
    await repo.save(tier("bronze"));
    expect((await repo.list({ workspaceId: "w" })).map(row => row.id)).toEqual(["gold", "bronze"]);
  });
});

describe("InMemoryMemberSubscriptionRepo.listActiveByMember", () => {
  it("keeps active and comped subscriptions of the member still in period, or open-ended", async () => {
    const sub = (id: string, overrides: Partial<MemberSubscriptionRecord>): MemberSubscriptionRecord =>
      ({ id, workspaceId: "w", memberId: "m1", tierId: "gold", status: "active", source: "signup", startedAt: at, createdAt: at, updatedAt: at, version: 1, ...overrides });
    const repo = new InMemoryMemberSubscriptionRepo({}, { initialRows: [
      sub("open", {}), sub("comped", { status: "comped", currentPeriodEnd: later }), sub("ended", { currentPeriodEnd: at }),
      sub("canceled", { status: "canceled" }), sub("other-member", { memberId: "m2" }), sub("other-ws", { workspaceId: "other" }),
    ] });
    expect((await repo.listActiveByMember({ workspaceId: "w", memberId: "m1", nowIso: at })).map(row => row.id)).toEqual(["open", "comped"]);
  });
});

describe("InMemoryMagicLinkTokenRepo", () => {
  it("reserveCodeAttempt counts failed attempts up to the cap and refuses missing, consumed and expired tokens", async () => {
    const repo = new InMemoryMagicLinkTokenRepo({}, { initialRows: [token("t1"), token("used", { consumedAt: at }), token("old", { expiresAt: at }), token("tried", { failedAttempts: 1 })] });
    expect(await repo.reserveCodeAttempt({ workspaceId: "w", id: "tried", nowIso: at }, { maxAttempts: 2 })).toBe(true);
    expect(await repo.reserveCodeAttempt({ workspaceId: "w", id: "tried", nowIso: at }, { maxAttempts: 2 })).toBe(false);
    const reserve = (id: string) => repo.reserveCodeAttempt({ workspaceId: "w", id, nowIso: at }, { maxAttempts: 2 });
    expect(await reserve("t1")).toBe(true);
    expect(await reserve("t1")).toBe(true);
    expect(await reserve("t1")).toBe(false);
    expect((await repo.findById({ workspaceId: "w", id: "t1" }))?.failedAttempts).toBe(2);
    expect(await reserve("used")).toBe(false);
    expect(await reserve("old")).toBe(false);
    expect(await reserve("missing")).toBe(false);
    expect(await repo.reserveCodeAttempt({ workspaceId: "other", id: "t1", nowIso: at })).toBe(false);
  });

  it("consume names a missing or expired token and stamps a live one once", async () => {
    const repo = new InMemoryMagicLinkTokenRepo({}, { initialRows: [token("t1"), token("old", { expiresAt: at })] });
    await expect(repo.consume({ workspaceId: "w", id: "missing", consumedAt: at })).rejects.toMatchObject({ reason: "not_found", message: "magic link token 'missing' was not found" });
    await expect(repo.consume({ workspaceId: "w", id: "old", consumedAt: at })).rejects.toMatchObject({ reason: "expired", message: "magic link token 'old' has expired" });
    await repo.consume({ workspaceId: "w", id: "t1", consumedAt: at });
    await expect(repo.consume({ workspaceId: "w", id: "t1", consumedAt: at })).rejects.toMatchObject({ reason: "already_consumed" });
    expect((await repo.findByTokenHash({ workspaceId: "w", tokenHash: "hash-t1" }))?.consumedAt).toBe(at);
    expect(await repo.findByTokenHash({ workspaceId: "other", tokenHash: "hash-t1" })).toBeNull();
  });
});

describe("InMemoryMemberConsentRepo", () => {
  const consent = { id: "c1", workspaceId: "w", memberId: "m1", purpose: "newsletter", status: "pending" as const, evidence: { source: "signup" }, createdAt: at, updatedAt: at, version: 1 };
  const revision = { workspaceId: "w", memberId: "m1", consentId: "c1", op: "consent_request" as const, beforeJson: null, afterJson: null, originModule: "newsletter", createdAt: at };

  it("finds by member and purpose and save upserts", async () => {
    const repo = new InMemoryMemberConsentRepo();
    await repo.save(consent);
    await repo.save({ ...consent, status: "granted", version: 2 });
    await repo.save({ ...consent, id: "c2", purpose: "marketing" });
    expect(await repo.findByMemberAndPurpose({ workspaceId: "w", memberId: "m1", purpose: "newsletter" })).toEqual({ ...consent, status: "granted", version: 2 });
    expect(await repo.findByMemberAndPurpose({ workspaceId: "w", memberId: "m2", purpose: "newsletter" })).toBeNull();
  });

  it("appendRevision hands out increasing seqs; listRevisions filters by member and optional purpose, ordered by seq", async () => {
    const repo = new InMemoryMemberConsentRepo();
    expect(await repo.appendRevision({ ...revision, purpose: "newsletter" })).toBe(1);
    expect(await repo.appendRevision({ ...revision, purpose: "marketing" })).toBe(2);
    expect(await repo.appendRevision({ ...revision, memberId: "m2", purpose: "newsletter" })).toBe(3);
    expect(await repo.appendRevision({ ...revision, purpose: "newsletter", op: "consent_confirm" })).toBe(4);
    expect((await repo.listRevisions({ workspaceId: "w", memberId: "m1" })).map(r => [r.seq, r.purpose])).toEqual([[1, "newsletter"], [2, "marketing"], [4, "newsletter"]]);
    expect((await repo.listRevisions({ workspaceId: "w", memberId: "m1", purpose: "newsletter" })).map(r => r.op)).toEqual(["consent_request", "consent_confirm"]);
  });

  it("transaction passes through fn's result", async () => {
    expect(await new InMemoryMemberConsentRepo().transaction({ fn: async () => 7 })).toBe(7);
  });
});
