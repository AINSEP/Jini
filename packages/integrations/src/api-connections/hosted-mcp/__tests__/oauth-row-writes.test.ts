import { describe, expect, it } from "vitest";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { runtimePatchOf, updateRowOnce, writeOAuthRuntime } from "../oauth-row-writes.js";
import { FakeRepo, makeHarness, makeRecord, sealed } from "./sign-in-harness.js";

describe("runtimePatchOf", () => {
  it("copies exactly the OAuth runtime columns", () => {
    const row = makeRecord({ oauthStatus: "connected", oauthExpiresAt: "2026-02-01T00:00:00.000Z", oauthRefreshLeaseUntil: "2026-01-01T00:00:00.000Z", sealedOAuth: sealed({}), oauthAadVersion: 4, updatedAt: "2026-01-03T00:00:00.000Z", label: "ignored" });
    expect(runtimePatchOf(row)).toEqual({ oauthStatus: "connected", oauthExpiresAt: "2026-02-01T00:00:00.000Z", oauthRefreshLeaseUntil: "2026-01-01T00:00:00.000Z", sealedOAuth: sealed({}), oauthAadVersion: 4, updatedAt: "2026-01-03T00:00:00.000Z" });
  });
});

describe("writeOAuthRuntime", () => {
  const patch = runtimePatchOf(makeRecord({ oauthStatus: "connected" }));

  it("writes fenced on the credential it read and passes the expected config through", async () => {
    const row = makeRecord({ sealedOAuth: sealed({ clientSecret: "pw-1" }) });
    const h = makeHarness(new FakeRepo(row));
    await writeOAuthRuntime({ repo: h.deps.repo, ports: h.deps.ports, record: row, patch }, { expectedConfig: { createdAt: row.createdAt, version: 3 } });
    expect(h.repo.runtimeCalls).toEqual([{ key: { workspaceId: "ws-1", serverId: "srv" }, expectedSealedOAuth: row.sealedOAuth, patch, expectedConfig: { createdAt: row.createdAt, version: 3 } }]);
    expect(h.repo.rows.get("srv")?.oauthStatus).toBe("connected");
  });

  it("throws re-authorization naming the replaced credential when the fence misses", async () => {
    const h = makeHarness(new FakeRepo(makeRecord({ sealedOAuth: sealed({ clientSecret: "pw-2" }) })));
    const error = await writeOAuthRuntime({ repo: h.deps.repo, ports: h.deps.ports, record: makeRecord(), patch }).catch((e: Error) => e);
    expect((error as Error).message).toBe("reauth:srv");
    expect(((error as Error).cause as Error).message).toBe("The OAuth credential of MCP server 'srv' (workspace 'ws-1') was replaced or removed while a sign-in write was in flight. The new token set was dropped, not written onto its replacement.");
  });
});

describe("updateRowOnce", () => {
  const key = { workspaceId: "ws-1", serverId: "srv" };

  it("writes the built row one version up, compared on the version and secrets it read", async () => {
    const row = makeRecord({ sealedEnv: sealed({}) });
    const h = makeHarness(new FakeRepo(row));
    const written = await updateRowOnce({ repo: h.deps.repo, key, build: async current => ({ ...current, label: "New" }) });
    expect(written).toEqual({ ...row, label: "New", version: 4 });
    expect(h.repo.ifVersionCalls).toEqual([{ record: { ...row, label: "New", version: 4 }, expectedVersion: 3, replaces: { sealedEnv: row.sealedEnv, sealedOAuth: null } }]);
  });

  it("returns null without writing when the row is gone or build has nothing to write", async () => {
    const h = makeHarness(new FakeRepo(makeRecord()));
    await expect(updateRowOnce({ repo: h.deps.repo, key: { ...key, serverId: "gone" }, build: async r => r })).resolves.toBeNull();
    await expect(updateRowOnce({ repo: h.deps.repo, key, build: async () => null })).resolves.toBeNull();
    expect(h.repo.ifVersionCalls).toEqual([]);
  });

  it("retries once after a missed write, then reports a version conflict", async () => {
    const h = makeHarness(new FakeRepo(makeRecord()));
    h.repo.refuseIfVersion = 1;
    await expect(updateRowOnce({ repo: h.deps.repo, key, build: async r => ({ ...r, label: "Retry" }) })).resolves.toMatchObject({ label: "Retry", version: 4 });
    expect(h.repo.ifVersionCalls).toHaveLength(2);
    h.repo.refuseIfVersion = 2;
    await expect(updateRowOnce({ repo: h.deps.repo, key, build: async r => r })).rejects.toBeInstanceOf(RecordVersionConflictError);
  });
});
