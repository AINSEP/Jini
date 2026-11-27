import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqlMagicLinkTokenRepo } from "../repo.sessions.js";
import { MagicLinkTokenRejectedError, type MagicLinkTokenRecord } from "../types.js";
import type { TestSqliteKernel } from "../../server/sql/__tests__/support/sqlite-kernel.js";
import { MEMBER_TABLES, membersDb } from "./members-sqlite.js";

/**
 * @file The magic-link token SQL repository against a real in-memory SQLite database: workspace-scoped
 * lookups, upsert, bounded code attempts, and single-use consumption with its three rejection reasons.
 */
let db: TestSqliteKernel;
let repo: SqlMagicLinkTokenRepo;
beforeEach(async () => {
  db = await membersDb();
  repo = new SqlMagicLinkTokenRepo({ kernel: db.kernel, tables: MEMBER_TABLES });
});
afterEach(async () => { await db.close(); });

async function select(query: string): Promise<Array<Record<string, unknown>>> {
  return db.kernel.run(async (handle) => (await sql.raw<Record<string, unknown>>(query).execute(handle)).rows);
}

const token = (over: Partial<MagicLinkTokenRecord> = {}): MagicLinkTokenRecord => ({
  id: "t1", workspaceId: "w1", memberId: "m1", tokenHash: "lh-1", purpose: "signin",
  createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:15:00.000Z", ...over,
});
const NOW = "2026-01-01T00:05:00.000Z";

describe("SqlMagicLinkTokenRepo lookups and save", () => {
  it("finds by id and by token hash within the workspace, mapping the code-entry fields", async () => {
    await repo.save(token({ email: "new@example.test", codeHash: "ch-1", failedAttempts: 2 }));
    const expected = { ...token(), email: "new@example.test", codeHash: "ch-1", failedAttempts: 2, consumedAt: undefined };
    expect(await repo.findById({ workspaceId: "w1", id: "t1" })).toEqual(expected);
    expect(await repo.findByTokenHash({ workspaceId: "w1", tokenHash: "lh-1" })).toEqual(expected);
    expect(await repo.findById({ workspaceId: "w2", id: "t1" })).toBeNull();
    expect(await repo.findByTokenHash({ workspaceId: "w2", tokenHash: "lh-1" })).toBeNull();
  });

  it("upserts on id, replacing the stored columns", async () => {
    await repo.save(token());
    await repo.save(token({ tokenHash: "lh-2", consumedAt: NOW }));
    expect(await select("select token_hash, consumed_at, failed_attempts from member_magic_tokens")).toEqual([
      { token_hash: "lh-2", consumed_at: NOW, failed_attempts: 0 },
    ]);
  });
});

describe("SqlMagicLinkTokenRepo.reserveCodeAttempt", () => {
  it("counts attempts up to the default maximum of five", async () => {
    await repo.save(token({ failedAttempts: 4 }));
    expect(await repo.reserveCodeAttempt({ workspaceId: "w1", id: "t1", nowIso: NOW })).toBe(true);
    expect(await repo.reserveCodeAttempt({ workspaceId: "w1", id: "t1", nowIso: NOW })).toBe(false);
    expect(await select("select failed_attempts from member_magic_tokens")).toEqual([{ failed_attempts: 5 }]);
  });

  it("honours a caller maximum and refuses expired, consumed, or unknown tokens", async () => {
    await repo.save(token({ failedAttempts: 1 }));
    expect(await repo.reserveCodeAttempt({ workspaceId: "w1", id: "t1", nowIso: NOW }, { maxAttempts: 1 })).toBe(false);
    expect(await repo.reserveCodeAttempt({ workspaceId: "w1", id: "t1", nowIso: "2026-01-01T00:15:00.000Z" })).toBe(false);
    expect(await repo.reserveCodeAttempt({ workspaceId: "w1", id: "nope", nowIso: NOW })).toBe(false);
    await repo.save(token({ id: "t2", tokenHash: "lh-2", consumedAt: NOW }));
    expect(await repo.reserveCodeAttempt({ workspaceId: "w1", id: "t2", nowIso: NOW })).toBe(false);
  });
});

describe("SqlMagicLinkTokenRepo.consume", () => {
  it("stamps consumed_at once under the workspace token lock", async () => {
    await repo.save(token());
    db.events.length = 0;
    await repo.consume({ workspaceId: "w1", id: "t1", consumedAt: NOW });
    expect(db.events).toEqual(["begin", "lock:members:magic-tokens:w1", "commit"]);
    expect(await select("select consumed_at from member_magic_tokens")).toEqual([{ consumed_at: NOW }]);
    const again = repo.consume({ workspaceId: "w1", id: "t1", consumedAt: "2026-01-01T00:06:00.000Z" });
    await expect(again).rejects.toThrow("magic link token 't1' was already consumed");
    expect(await select("select consumed_at from member_magic_tokens")).toEqual([{ consumed_at: NOW }]);
  });

  it("rejects unknown and expired tokens with their reasons", async () => {
    await repo.save(token());
    const missing = await repo.consume({ workspaceId: "w2", id: "t1", consumedAt: NOW }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(MagicLinkTokenRejectedError);
    expect((missing as MagicLinkTokenRejectedError).reason).toBe("not_found");
    const expired = await repo.consume({ workspaceId: "w1", id: "t1", consumedAt: "2026-01-01T00:15:00.000Z" }).catch((e: unknown) => e);
    expect((expired as MagicLinkTokenRejectedError).reason).toBe("expired");
    expect((expired as Error).message).toBe("magic link token 't1' has expired");
    expect(await select("select consumed_at from member_magic_tokens")).toEqual([{ consumed_at: null }]);
  });
});
