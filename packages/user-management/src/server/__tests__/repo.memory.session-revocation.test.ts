import { describe, expect, test } from "vitest";
import { InMemorySessionRepo } from "../repo.memory.js";

/**
 * Revocation is one-way (security, lost update on a session row): a session record built before a
 * logout / password reset / principal disable carries no `revokedAt`, and saving it back must not
 * restore the session. Same contract as the SQL adapters in a host.
 */

const base = { id: "s1", workspaceId: "ws", principalId: "p1", tokenHash: "h1", createdAt: "2026-11-17T00:00:00.000Z", expiresAt: "2026-12-17T00:00:00.000Z" };
const REVOKED = "2026-11-17T01:00:00.000Z";

describe("InMemorySessionRepo revocation", () => {
  test("a save of the same session after it was revoked does not restore it, and still saves the other columns", async () => {
    const repo = new InMemorySessionRepo({});
    await repo.save({ ...base });
    await repo.revoke({ workspaceId: "ws", id: "s1", revokedAt: REVOKED });
    await repo.save({ ...base, ip: "203.0.113.7" });
    expect(await repo.findById({ workspaceId: "ws", id: "s1" })).toMatchObject({ revokedAt: REVOKED, ip: "203.0.113.7" });
  });

  test("a save that carries its own revokedAt still revokes", async () => {
    const repo = new InMemorySessionRepo({});
    await repo.save({ ...base });
    await repo.save({ ...base, revokedAt: REVOKED });
    expect((await repo.findById({ workspaceId: "ws", id: "s1" }))?.revokedAt).toBe(REVOKED);
  });
});
