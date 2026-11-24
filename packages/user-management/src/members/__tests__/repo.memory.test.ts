import assert from "node:assert/strict";
import { test } from "vitest";

import {
  InMemoryMagicLinkTokenRepo,
  InMemoryMemberRepo,
  InMemoryMemberSessionRepo,
  InMemoryMemberSubscriptionRepo,
} from "../repo.memory.js";
import { MemberConflictError, type MemberRecord } from "../types.js";

const WORKSPACE_ID = "ws-1";

test("InMemoryMemberRepo.list paginates by id cursor within a workspace", async () => {
  const repo = new InMemoryMemberRepo({}, { initialRows: [
    { id: "m-3", workspaceId: WORKSPACE_ID, email: "c@example.com", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 },
    { id: "m-1", workspaceId: WORKSPACE_ID, email: "a@example.com", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 },
    { id: "m-2", workspaceId: WORKSPACE_ID, email: "b@example.com", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 },
    { id: "m-1-other-ws", workspaceId: "ws-2", email: "d@example.com", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 },
  ] });

  const firstPage = await repo.list({ workspaceId: WORKSPACE_ID }, { limit: 2 });
  assert.deepEqual(firstPage.items.map((m) => m.id), ["m-1", "m-2"]);

  const secondPage = await repo.list({ workspaceId: WORKSPACE_ID }, { cursor: firstPage.nextCursor, limit: 2 });
  assert.deepEqual(secondPage.items.map((m) => m.id), ["m-3"]);
  assert.equal(secondPage.nextCursor, null);

  const otherWorkspace = await repo.list({ workspaceId: "ws-2" });
  assert.deepEqual(otherWorkspace.items.map((m) => m.id), ["m-1-other-ws"]);
});

test("InMemoryMagicLinkTokenRepo.consume enforces single-use and rejects an unknown id", async () => {
  const repo = new InMemoryMagicLinkTokenRepo({}, { initialRows: [
    {
      id: "token-1",
      workspaceId: WORKSPACE_ID,
      memberId: "member-1",
      tokenHash: "hash-1",
      purpose: "signin",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:15:00.000Z",
    },
  ] });

  await repo.consume({ workspaceId: WORKSPACE_ID, id: "token-1", consumedAt: "2026-01-01T00:05:00.000Z" });
  const consumed = await repo.findByTokenHash({ workspaceId: WORKSPACE_ID, tokenHash: "hash-1" });
  assert.ok(consumed!.consumedAt);

  await assert.rejects(() =>
    repo.consume({ workspaceId: WORKSPACE_ID, id: "token-1", consumedAt: "2026-01-01T00:06:00.000Z" })
  );

  await assert.rejects(() =>
    repo.consume({ workspaceId: WORKSPACE_ID, id: "no-such-token", consumedAt: "2026-01-01T00:06:00.000Z" })
  );
});

test("InMemoryMemberSessionRepo.revoke and revokeAllForMember only affect the targeted rows", async () => {
  const repo = new InMemoryMemberSessionRepo({}, { initialRows: [
    { id: "session-1", workspaceId: WORKSPACE_ID, memberId: "member-1", tokenHash: "hash-a", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" },
    { id: "session-2", workspaceId: WORKSPACE_ID, memberId: "member-1", tokenHash: "hash-b", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" },
    { id: "session-3", workspaceId: WORKSPACE_ID, memberId: "member-2", tokenHash: "hash-c", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" },
  ] });

  await repo.revoke({ workspaceId: WORKSPACE_ID, id: "session-1", revokedAt: "2026-02-01T00:00:00.000Z" });
  const sessionsForMember1 = await repo.listByMember({ workspaceId: WORKSPACE_ID, memberId: "member-1" });
  assert.equal(sessionsForMember1.find((s) => s.id === "session-1")!.revokedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(sessionsForMember1.find((s) => s.id === "session-2")!.revokedAt, undefined);

  await repo.revokeAllForMember({ workspaceId: WORKSPACE_ID, memberId: "member-1", revokedAt: "2026-03-01T00:00:00.000Z" });
  const afterRevokeAll = await repo.listByMember({ workspaceId: WORKSPACE_ID, memberId: "member-1" });
  assert.ok(afterRevokeAll.every((s) => s.revokedAt));

  const otherMemberSessions = await repo.listByMember({ workspaceId: WORKSPACE_ID, memberId: "member-2" });
  assert.equal(otherMemberSessions[0]!.revokedAt, undefined, "revokeAllForMember must not touch other members' sessions");
});

test("InMemoryMemberRepo.list keeps seeded rows that share an id in their seed order", async () => {
  const base = { workspaceId: WORKSPACE_ID, status: "active" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 };
  const repo = new InMemoryMemberRepo({}, { initialRows: [
    { ...base, id: "m-2", email: "first@example.com" },
    { ...base, id: "m-1", email: "x@example.com" },
    { ...base, id: "m-2", email: "second@example.com" },
  ] });

  const rows = (await repo.list({ workspaceId: WORKSPACE_ID })).items;
  assert.deepEqual(rows.map((m) => m.email), ["x@example.com", "first@example.com", "second@example.com"]);
});

test("InMemoryMemberRepo.save never lets a write clear or roll back a recorded credential revocation", async () => {
  const revoked: MemberRecord = { id: "m-1", workspaceId: WORKSPACE_ID, email: "a@example.com", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", version: 2, credentialsRevokedAt: "2026-01-02T00:00:00.000Z" };
  const repo = new InMemoryMemberRepo({}, { initialRows: [revoked] });
  const { credentialsRevokedAt: _dropped, ...withoutRevocation } = revoked;

  await assert.rejects(() => repo.save({ ...withoutRevocation, version: 3 }), MemberConflictError);
  await assert.rejects(() => repo.save({ ...revoked, version: 3, credentialsRevokedAt: "2026-01-01T12:00:00.000Z" }), MemberConflictError);
  assert.equal((await repo.findById({ workspaceId: WORKSPACE_ID, id: "m-1" }))!.version, 2, "rejected writes leave the row unchanged");

  await repo.save({ ...revoked, version: 3, name: "Kept revocation" });
  const saved = await repo.findById({ workspaceId: WORKSPACE_ID, id: "m-1" });
  assert.equal(saved!.name, "Kept revocation");
  assert.equal(saved!.credentialsRevokedAt, "2026-01-02T00:00:00.000Z");
});

test("InMemoryMemberSubscriptionRepo.listByMember orders newest start first and keeps same-start rows in insertion order", async () => {
  const base = { workspaceId: WORKSPACE_ID, memberId: "member-1", tierId: "tier-1", status: "active" as const, source: "comp" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 };
  const repo = new InMemoryMemberSubscriptionRepo({}, { initialRows: [
    { ...base, id: "sub-a", startedAt: "2026-03-01T00:00:00.000Z" },
    { ...base, id: "sub-old", startedAt: "2026-01-01T00:00:00.000Z" },
    { ...base, id: "sub-b", startedAt: "2026-03-01T00:00:00.000Z" },
  ] });

  const rows = await repo.listByMember({ workspaceId: WORKSPACE_ID, memberId: "member-1" });
  assert.deepEqual(rows.map((r) => r.id), ["sub-a", "sub-b", "sub-old"]);
});

test("InMemoryMemberSessionRepo.save replaces a session by id, and revoke of an unknown id changes nothing", async () => {
  const session = { id: "session-1", workspaceId: WORKSPACE_ID, memberId: "member-1", tokenHash: "hash-a", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" };
  const repo = new InMemoryMemberSessionRepo({}, { initialRows: [session] });

  await repo.save({ ...session, tokenHash: "hash-rotated" });
  const rows = await repo.listByMember({ workspaceId: WORKSPACE_ID, memberId: "member-1" });
  assert.deepEqual(rows.map((s) => [s.id, s.tokenHash]), [["session-1", "hash-rotated"]]);

  await repo.revoke({ workspaceId: WORKSPACE_ID, id: "no-such-session", revokedAt: "2026-02-01T00:00:00.000Z" });
  await repo.revoke({ workspaceId: "ws-other", id: "session-1", revokedAt: "2026-02-01T00:00:00.000Z" });
  assert.equal((await repo.listByMember({ workspaceId: WORKSPACE_ID, memberId: "member-1" }))[0]!.revokedAt, undefined);
});
