import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqlMemberSessionRepo } from "../repo.sessions.js";
import { MemberAuthError, type MemberSessionRecord } from "../types.js";
import type { TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import { MEMBER_TABLES, keepStoredRevocation, membersDb } from "./members-sqlite.js";

/**
 * @file Drives the member session and magic-link SQL repositories against a real in-memory SQLite
 * database: lookups are workspace-scoped, saves are refused for changed members, revocation is
 * one-way and never lowers the cutoff, and a sign-in token is consumed or code-attempted at most as allowed.
 */
let db: TestSqliteKernel;
beforeEach(async () => { db = await membersDb(); });
afterEach(async () => { await db.close(); });

async function select(query: string): Promise<Array<Record<string, unknown>>> {
  return db.kernel.run(async (handle) => (await sql.raw<Record<string, unknown>>(query).execute(handle)).rows);
}

async function insertMember(over: { status?: string; credentialsRevokedAt?: string | null; id?: string } = {}): Promise<void> {
  await db.exec(`insert into members (id, workspace_id, email, status, credentials_revoked_at, created_at, updated_at, version)
    values ('${over.id ?? "m1"}', 'w1', 'a@example.test', '${over.status ?? "active"}',
    ${over.credentialsRevokedAt ? `'${over.credentialsRevokedAt}'` : "null"}, 't0', 't0', 1)`);
}

const session = (over: Partial<MemberSessionRecord> = {}): MemberSessionRecord => ({
  id: "s1", workspaceId: "w1", memberId: "m1", tokenHash: "th-1", createdAt: "2026-01-02T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z", ...over,
});

const sessions = () => new SqlMemberSessionRepo({ kernel: db.kernel, tables: MEMBER_TABLES, keepStoredRevocation });

describe("SqlMemberSessionRepo lookups", () => {
  it("finds a session by token hash inside the workspace only and maps every column", async () => {
    const repo = sessions();
    await insertMember();
    await repo.save(session({ lastSeenAt: "seen", userAgent: "ua", ip: "10.0.0.1" }));
    expect(await repo.findByTokenHash({ workspaceId: "w1", tokenHash: "th-1" })).toEqual({
      id: "s1", workspaceId: "w1", memberId: "m1", tokenHash: "th-1", createdAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z", revokedAt: undefined, lastSeenAt: "seen", userAgent: "ua", ip: "10.0.0.1",
    });
    expect(await repo.findByTokenHash({ workspaceId: "w2", tokenHash: "th-1" })).toBeNull();
    expect(await repo.findByTokenHash({ workspaceId: "w1", tokenHash: "other" })).toBeNull();
  });

  it("lists only the named member's sessions", async () => {
    const repo = sessions();
    await repo.save(session());
    await repo.save(session({ id: "s2", tokenHash: "th-2" }));
    await repo.save(session({ id: "s3", memberId: "m2", tokenHash: "th-3" }));
    const listed = await repo.listByMember({ workspaceId: "w1", memberId: "m1" });
    expect(listed.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(await repo.listByMember({ workspaceId: "w2", memberId: "m1" })).toEqual([]);
  });
});

describe("SqlMemberSessionRepo.save", () => {
  it("takes the member's trash lock and inserts when no member row exists", async () => {
    await sessions().save(session());
    expect(db.events).toEqual(["begin", "lock:trash:member:w1:m1", "commit"]);
    expect(await select("select id, token_hash from member_sessions")).toEqual([{ id: "s1", token_hash: "th-1" }]);
  });

  it.each(["trash", "disabled"])("refuses a session for a %s member and writes nothing", async (status) => {
    await insertMember({ status });
    await expect(sessions().save(session())).rejects.toThrow(new MemberAuthError("member changed before the session was saved; request a new sign-in link"));
    expect(await select("select id from member_sessions")).toEqual([]);
  });

  it("refuses a session minted before the credential cutoff but accepts one minted at or after it", async () => {
    await insertMember({ credentialsRevokedAt: "2026-01-03T00:00:00.000Z" });
    await expect(sessions().save(session())).rejects.toBeInstanceOf(MemberAuthError);
    await sessions().save(session({ id: "s2", createdAt: "2026-01-03T00:00:00.000Z" }));
    expect(await select("select id from member_sessions")).toEqual([{ id: "s2" }]);
  });

  it("updates an existing session but never clears its stored revocation", async () => {
    const repo = sessions();
    await insertMember();
    await repo.save(session({ revokedAt: "r1" }));
    await repo.save(session({ lastSeenAt: "later" }));
    expect(await select("select revoked_at, last_seen_at from member_sessions")).toEqual([{ revoked_at: "r1", last_seen_at: "later" }]);
  });
});
