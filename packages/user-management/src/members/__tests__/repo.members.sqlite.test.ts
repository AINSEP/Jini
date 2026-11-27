import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqlMemberExternalIdentityRepo, SqlMemberRepo } from "../repo.js";
import { MemberAuthError, MemberConflictError, type MemberExternalIdentityRecord, type MemberRecord } from "../types.js";
import type { TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import { MEMBER_TABLES, membersDb } from "./members-sqlite.js";

/**
 * @file The member and external-identity SQL repositories against a real in-memory SQLite database:
 * email normalisation, the credential column kept apart from profiles, Trash-aware paging, the guarded
 * member upsert, and identity relink/unlink fencing.
 */
let db: TestSqliteKernel;
let repo: SqlMemberRepo;
beforeEach(async () => {
  db = await membersDb();
  repo = new SqlMemberRepo({ kernel: db.kernel, tables: MEMBER_TABLES });
});
afterEach(async () => { await db.close(); });

const select = (query: string) => db.kernel.run(async (h) => (await sql.raw<Record<string, unknown>>(query).execute(h)).rows);
const member = (over: Partial<MemberRecord> = {}): MemberRecord => ({
  id: "m1", workspaceId: "w1", email: "a@example.test", status: "active", createdAt: "t0", updatedAt: "t0", version: 1, ...over,
});

describe("SqlMemberRepo reads", () => {
  it("finds by id and by trimmed, lower-cased email within the workspace", async () => {
    await repo.save(member({ name: "Ada" }));
    expect(await repo.findById({ workspaceId: "w1", id: "m1" })).toMatchObject({ id: "m1", name: "Ada" });
    expect(await repo.findById({ workspaceId: "w2", id: "m1" })).toBeNull();
    expect(await repo.findByEmail({ workspaceId: "w1", email: "  A@Example.TEST " })).toMatchObject({ id: "m1" });
    expect(await repo.findByEmail({ workspaceId: "w1", email: "b@example.test" })).toBeNull();
  });

  it("stores and reads the password hash only through the credential methods, never for Trash", async () => {
    await repo.save(member());
    expect(await repo.findPasswordHash({ workspaceId: "w1", memberId: "m1" })).toBeNull();
    await repo.setPasswordHash({ workspaceId: "w1", memberId: "m1", passwordHash: "pw-hash" });
    expect(await repo.findPasswordHash({ workspaceId: "w1", memberId: "m1" })).toBe("pw-hash");
    await repo.save(member({ name: "Renamed", version: 2 }));
    expect(await repo.findPasswordHash({ workspaceId: "w1", memberId: "m1" })).toBe("pw-hash");
    await db.exec("update members set status = 'trash'");
    expect(await repo.findPasswordHash({ workspaceId: "w1", memberId: "m1" })).toBeNull();
    await expect(repo.setPasswordHash({ workspaceId: "w1", memberId: "m1", passwordHash: "pw-2" }))
      .rejects.toThrow(new MemberAuthError("member was not found or is in Trash"));
    await expect(repo.setPasswordHash({ workspaceId: "w1", memberId: "nobody", passwordHash: "pw-2" })).rejects.toBeInstanceOf(MemberAuthError);
  });

  it("pages non-Trash members by id with a resumable cursor", async () => {
    for (const id of ["m1", "m2", "m3", "m4"]) await repo.save(member({ id, email: `${id}@example.test` }));
    await db.exec("update members set status = 'trash' where id = 'm2'");
    const first = await repo.list({ workspaceId: "w1" }, { limit: 2 });
    expect(first.items.map((m) => m.id)).toEqual(["m1", "m3"]);
    const second = await repo.list({ workspaceId: "w1" }, { limit: 2, cursor: first.nextCursor });
    expect(second).toMatchObject({ nextCursor: null });
    expect(second.items.map((m) => m.id)).toEqual(["m4"]);
    expect((await repo.list({ workspaceId: "w1" }, { limit: 500 })).items).toHaveLength(3);
    expect((await repo.list({ workspaceId: "w1" })).items.map((m) => m.id)).toEqual(["m1", "m3", "m4"]);
  });
});

describe("SqlMemberRepo.save guards", () => {
  it("accepts only the next version and never writes over Trash", async () => {
    await repo.save(member());
    await expect(repo.save(member({ version: 3 }))).rejects.toThrow(new MemberConflictError("member changed or is in Trash; re-read it before updating"));
    await repo.save(member({ version: 2, note: "n" }));
    await expect(repo.save(member({ version: 2 }))).rejects.toBeInstanceOf(MemberConflictError);
    await db.exec("update members set status = 'trash'");
    await expect(repo.save(member({ version: 3, status: "active" }))).rejects.toBeInstanceOf(MemberConflictError);
    expect(await select("select status, version, note from members")).toEqual([{ status: "trash", version: 2, note: "n" }]);
  });

  it("never erases or lowers a stored credential cutoff", async () => {
    await repo.save(member());
    await db.exec("update members set credentials_revoked_at = '2026-05-01'");
    await expect(repo.save(member({ version: 2 }))).rejects.toBeInstanceOf(MemberConflictError);
    await expect(repo.save(member({ version: 2, credentialsRevokedAt: "2026-04-01" }))).rejects.toBeInstanceOf(MemberConflictError);
    await repo.save(member({ version: 2, credentialsRevokedAt: "2026-06-01" }));
    expect(await select("select credentials_revoked_at from members")).toEqual([{ credentials_revoked_at: "2026-06-01" }]);
  });
});

describe("SqlMemberExternalIdentityRepo", () => {
  const ident = (over: Partial<MemberExternalIdentityRecord> = {}): MemberExternalIdentityRecord => ({
    id: "i1", workspaceId: "w1", memberId: "m1", providerId: "p", issuer: "iss", subject: "sub", linkedAt: "t0", ...over,
  });

  it("finds by subject, by member+provider, and lists a member's links", async () => {
    const ids = new SqlMemberExternalIdentityRepo({ kernel: db.kernel, tables: MEMBER_TABLES });
    await ids.save(ident());
    await ids.save(ident({ id: "i2", providerId: "q", subject: "sub2" }));
    expect(await ids.findBySubject({ workspaceId: "w1", issuer: "iss", subject: "sub" })).toEqual(ident());
    expect(await ids.findBySubject({ workspaceId: "w2", issuer: "iss", subject: "sub" })).toBeNull();
    expect(await ids.findByMemberAndProvider({ workspaceId: "w1", memberId: "m1", providerId: "q" })).toMatchObject({ id: "i2" });
    expect(await ids.findByMemberAndProvider({ workspaceId: "w1", memberId: "m1", providerId: "zz" })).toBeNull();
    expect((await ids.listByMember({ workspaceId: "w1", memberId: "m1" })).map((i) => i.id).sort()).toEqual(["i1", "i2"]);
  });

  it("refuses a subject swap or reconnect unless relink is allowed, and keeps the first unlink", async () => {
    const ids = new SqlMemberExternalIdentityRepo({ kernel: db.kernel, tables: MEMBER_TABLES });
    await ids.save(ident());
    await expect(ids.save(ident({ subject: "other" }))).rejects.toThrow(new MemberConflictError("member identity changed; re-read it before updating"));
    await ids.save(ident({ linkedAt: "t1" }));
    await ids.unlink({ workspaceId: "w1", memberId: "m1", providerId: "p", unlinkedAt: "u1" });
    await ids.unlink({ workspaceId: "w1", memberId: "m1", providerId: "p", unlinkedAt: "u2" });
    expect(await ids.findBySubject({ workspaceId: "w1", issuer: "iss", subject: "sub" })).toMatchObject({ unlinkedAt: "u1", linkedAt: "t1" });
    await expect(ids.save(ident())).rejects.toBeInstanceOf(MemberConflictError);
    await expect(ids.save(ident({ memberId: "m2" }), { allowRelink: true })).rejects.toBeInstanceOf(MemberConflictError);
    await ids.save(ident({ subject: "other", linkedAt: "t2" }), { allowRelink: true });
    expect(await ids.findBySubject({ workspaceId: "w1", issuer: "iss", subject: "other" })).toEqual(ident({ subject: "other", linkedAt: "t2" }));
  });
});
