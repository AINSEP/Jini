import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqlMemberSessionRepo } from "../repo.sessions.js";
import type { MemberSessionRecord } from "../types.js";
import type { TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import { MEMBER_TABLES, keepStoredRevocation, membersDb } from "./members-sqlite.js";

/**
 * @file Session revocation against a real in-memory SQLite database: single revoke touches one row,
 * bulk revoke advances (never lowers) the member's credential cutoff, keeps earlier revocation stamps,
 * and can spare the caller's current session.
 */
let db: TestSqliteKernel;
beforeEach(async () => { db = await membersDb(); });
afterEach(async () => { await db.close(); });

async function select(query: string): Promise<Array<Record<string, unknown>>> {
  return db.kernel.run(async (handle) => (await sql.raw<Record<string, unknown>>(query).execute(handle)).rows);
}

const session = (over: Partial<MemberSessionRecord> = {}): MemberSessionRecord => ({
  id: "s1", workspaceId: "w1", memberId: "m1", tokenHash: "th-1", createdAt: "2026-01-02T00:00:00.000Z",
  expiresAt: "2026-02-01T00:00:00.000Z", ...over,
});

async function seed(cutoff: string | null): Promise<SqlMemberSessionRepo> {
  await db.exec(`insert into members (id, workspace_id, email, status, credentials_revoked_at, created_at, updated_at, version)
    values ('m1', 'w1', 'a@example.test', 'active', ${cutoff ? `'${cutoff}'` : "null"}, 't0', 't0', 1)`);
  const repo = new SqlMemberSessionRepo({ kernel: db.kernel, tables: MEMBER_TABLES, keepStoredRevocation });
  await repo.save(session({ createdAt: "2026-09-01" }));
  await repo.save(session({ id: "s2", tokenHash: "th-2", createdAt: "2026-09-01" }));
  await repo.save(session({ id: "s3", tokenHash: "th-3", createdAt: "2026-09-01", revokedAt: "2026-04-01" }));
  await repo.save(session({ id: "x1", memberId: "m2", tokenHash: "th-x", createdAt: "2026-09-01" }));
  db.events.length = 0;
  return repo;
}

describe("SqlMemberSessionRepo revocation", () => {
  it("revoke stamps exactly the named session in the workspace", async () => {
    const repo = await seed(null);
    await repo.revoke({ workspaceId: "w2", id: "s1", revokedAt: "2026-10-01" });
    await repo.revoke({ workspaceId: "w1", id: "s1", revokedAt: "2026-10-01" });
    expect(await select("select id, revoked_at from member_sessions order by id")).toEqual([
      { id: "s1", revoked_at: "2026-10-01" }, { id: "s2", revoked_at: null },
      { id: "s3", revoked_at: "2026-04-01" }, { id: "x1", revoked_at: null },
    ]);
  });

  it("revokeAllForMember sets the cutoff and revokes only the member's live sessions under the trash lock", async () => {
    const repo = await seed(null);
    await repo.revokeAllForMember({ workspaceId: "w1", memberId: "m1", revokedAt: "2026-10-01" });
    expect(db.events).toEqual(["begin", "lock:trash:member:w1:m1", "commit"]);
    expect(await select("select credentials_revoked_at from members")).toEqual([{ credentials_revoked_at: "2026-10-01" }]);
    expect(await select("select id, revoked_at from member_sessions order by id")).toEqual([
      { id: "s1", revoked_at: "2026-10-01" }, { id: "s2", revoked_at: "2026-10-01" },
      { id: "s3", revoked_at: "2026-04-01" }, { id: "x1", revoked_at: null },
    ]);
  });

  it("advances an older cutoff but never lowers a newer one", async () => {
    const older = await seed("2026-05-01");
    await older.revokeAllForMember({ workspaceId: "w1", memberId: "m1", revokedAt: "2026-10-01" });
    expect(await select("select credentials_revoked_at from members")).toEqual([{ credentials_revoked_at: "2026-10-01" }]);
    await older.revokeAllForMember({ workspaceId: "w1", memberId: "m1", revokedAt: "2026-07-01" });
    expect(await select("select credentials_revoked_at from members")).toEqual([{ credentials_revoked_at: "2026-10-01" }]);
  });

  it("spares the excepted session", async () => {
    const repo = await seed(null);
    await repo.revokeAllForMember({ workspaceId: "w1", memberId: "m1", revokedAt: "2026-10-01" }, { exceptSessionId: "s2" });
    expect(await select("select id, revoked_at from member_sessions where member_id = 'm1' order by id")).toEqual([
      { id: "s1", revoked_at: "2026-10-01" }, { id: "s2", revoked_at: null }, { id: "s3", revoked_at: "2026-04-01" },
    ]);
  });
});
