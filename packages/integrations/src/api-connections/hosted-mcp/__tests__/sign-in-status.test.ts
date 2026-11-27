import { describe, expect, it } from "vitest";
import type { OAuthTokenSet } from "@jini-ai/core/contracts/oauth";
import { persistTokens, setOAuthStatus } from "../sign-in-status.js";
import { FakeRepo, makeHarness, makeRecord, NOW_ISO, sealed, UnconfiguredError } from "./sign-in-harness.js";

const tokens = { accessToken: "at-1", refreshToken: "rt-1", tokenType: "Bearer", scopes: ["a"], expiresAt: "2026-03-01T00:00:00.000Z" } as OAuthTokenSet;
const selfRegistered = { oauthClientId: "c1", oauthEndpointsJson: JSON.stringify({ tokenEndpoint: "t", dynamicClientId: "c1", clientAuth: "none" }) };

describe("persistTokens", () => {
  it("re-seals the tokens beside the kept client secret and writes the connected runtime state", async () => {
    const row = makeRecord({ sealedOAuth: sealed({ clientSecret: "pw-1" }) });
    const h = makeHarness(new FakeRepo(row));
    await persistTokens({ deps: h.deps, record: row, tokens }, { expectedConfig: { createdAt: row.createdAt, version: 3 } });
    const stored = { accessToken: "at-1", refreshToken: "rt-1", tokenType: "Bearer", scopes: ["a"], expiresAt: "2026-03-01T00:00:00.000Z" };
    expect(h.seals).toEqual([{ clientSecret: "pw-1", tokens: stored }]);
    expect(h.repo.runtimeCalls[0]).toEqual({ key: { workspaceId: "ws-1", serverId: "srv" }, expectedSealedOAuth: row.sealedOAuth, expectedConfig: { createdAt: row.createdAt, version: 3 },
      patch: { oauthStatus: "connected", oauthExpiresAt: "2026-03-01T00:00:00.000Z", oauthRefreshLeaseUntil: null, sealedOAuth: sealed({ clientSecret: "pw-1", tokens: stored }), oauthAadVersion: 9, updatedAt: NOW_ISO } });
  });
  it("seals the tokens alone when there was no secret", async () => {
    const row = makeRecord();
    const h = makeHarness(new FakeRepo(row));
    await persistTokens({ deps: h.deps, record: row, tokens });
    expect(Object.keys(h.seals[0] ?? {})).toEqual(["tokens"]);
  });
});

describe("setOAuthStatus without callback record", () => {
  it("is a no-op for a missing row", async () => {
    const h = makeHarness(new FakeRepo());
    await setOAuthStatus(h.deps, "srv", "needs_reauth");
    expect([h.repo.runtimeCalls, h.repo.ifVersionCalls, h.seals]).toEqual([[], [], []]);
  });
  it("writes only the status and a released lease as a runtime write", async () => {
    const row = makeRecord({ oauthRefreshLeaseUntil: "2026-01-01T00:00:00.000Z", sealedOAuth: sealed({ clientSecret: "pw-1" }) });
    const h = makeHarness(new FakeRepo(row));
    await setOAuthStatus(h.deps, "srv", "needs_reauth");
    expect(h.repo.runtimeCalls[0]?.patch).toEqual({ oauthStatus: "needs_reauth", oauthExpiresAt: null, oauthRefreshLeaseUntil: null, sealedOAuth: row.sealedOAuth, oauthAadVersion: 1, updatedAt: NOW_ISO });
    expect(h.seals).toEqual([]);
  });
  it("clears the token but keeps the client secret", async () => {
    const h = makeHarness(new FakeRepo(makeRecord({ oauthExpiresAt: "2026-02-01T00:00:00.000Z", sealedOAuth: sealed({ clientSecret: "pw-1", tokens: { accessToken: "at" } as never }) })));
    await setOAuthStatus(h.deps, "srv", "disconnected", { clearToken: true });
    expect(h.seals).toEqual([{ clientSecret: "pw-1" }]);
    expect(h.repo.rows.get("srv")).toMatchObject({ oauthStatus: "disconnected", oauthExpiresAt: null, oauthAadVersion: 9, sealedOAuth: sealed({ clientSecret: "pw-1" }) });
  });
  it("forgets a self-registered client as a version-compared edit, dropping its secret with the token", async () => {
    const h = makeHarness(new FakeRepo(makeRecord({ ...selfRegistered, sealedOAuth: sealed({ clientSecret: "pw-1" }) })));
    await setOAuthStatus(h.deps, "srv", "needs_reauth", { clearToken: true, forgetSelfRegisteredClient: true });
    expect(h.seals).toEqual([{}]);
    expect(h.repo.ifVersionCalls).toHaveLength(1);
    expect(h.repo.rows.get("srv")).toMatchObject({ oauthClientId: null, oauthEndpointsJson: '{"tokenEndpoint":"t"}', version: 4, oauthStatus: "needs_reauth" });
  });
  it("does not forget an operator-typed client", async () => {
    const h = makeHarness(new FakeRepo(makeRecord({ oauthClientId: "c1" })));
    await setOAuthStatus(h.deps, "srv", "needs_reauth", { forgetSelfRegisteredClient: true });
    expect([h.repo.ifVersionCalls.length, h.repo.runtimeCalls.length, h.repo.rows.get("srv")?.oauthClientId]).toEqual([0, 1, "c1"]);
  });
});

describe("setOAuthStatus clearing an unreadable credential", () => {
  it("drops the whole sealed blob when it cannot be opened for lack of configuration", async () => {
    const h = makeHarness(new FakeRepo(makeRecord({ sealedOAuth: sealed({}) })), { store: { openPayload: async () => { throw new UnconfiguredError("no key"); } } });
    await setOAuthStatus(h.deps, "srv", "needs_reauth", { clearToken: true });
    expect(h.repo.rows.get("srv")).toMatchObject({ sealedOAuth: null, oauthExpiresAt: null });
  });
  it("rethrows any other open failure", async () => {
    const h = makeHarness(new FakeRepo(makeRecord()), { store: { openPayload: async () => { throw new Error("corrupt"); } } });
    await expect(setOAuthStatus(h.deps, "srv", "needs_reauth", { clearToken: true })).rejects.toThrow("corrupt");
  });
  it("retries an unconfigured reseal up to three attempts", async () => {
    let attempts = 0;
    const flaky = (failures: number) => async () => { attempts += 1; if (attempts <= failures) throw new UnconfiguredError(`miss ${attempts}`); return { sealedOAuth: null, oauthAadVersion: 5 }; };
    const ok = makeHarness(new FakeRepo(makeRecord()), { store: { sealPayload: flaky(2) } });
    await setOAuthStatus(ok.deps, "srv", "needs_reauth", { clearToken: true });
    expect([attempts, ok.repo.rows.get("srv")?.oauthAadVersion]).toEqual([3, 5]);
    attempts = 0;
    const fails = makeHarness(new FakeRepo(makeRecord()), { store: { sealPayload: flaky(3) } });
    await expect(setOAuthStatus(fails.deps, "srv", "needs_reauth", { clearToken: true })).rejects.toThrow("miss 3");
  });
  it("does not retry a reseal failure that is not about configuration", async () => {
    let attempts = 0;
    const h = makeHarness(new FakeRepo(makeRecord()), { store: { sealPayload: async () => { attempts += 1; throw new Error("disk"); } } });
    await expect(setOAuthStatus(h.deps, "srv", "needs_reauth", { clearToken: true })).rejects.toThrow("disk");
    expect(attempts).toBe(1);
  });
});

describe("setOAuthStatus with a callback record", () => {
  it("writes a runtime patch fenced on the callback's config", async () => {
    const row = makeRecord();
    const h = makeHarness(new FakeRepo(row));
    await setOAuthStatus(h.deps, "other-id", "needs_reauth", { callbackRecord: row });
    expect(h.repo.runtimeCalls).toEqual([{ key: row, expectedSealedOAuth: null, expectedConfig: { createdAt: row.createdAt, version: 3 },
      patch: { oauthStatus: "needs_reauth", oauthExpiresAt: null, oauthRefreshLeaseUntil: null, sealedOAuth: null, oauthAadVersion: 1, updatedAt: NOW_ISO } }]);
  });
  it("forgets the self-registered client in one conditional row write", async () => {
    const row = makeRecord(selfRegistered);
    const h = makeHarness(new FakeRepo(row));
    await setOAuthStatus(h.deps, "srv", "needs_reauth", { callbackRecord: row, forgetSelfRegisteredClient: true });
    expect(h.repo.ifVersionCalls).toEqual([{ record: expect.objectContaining({ oauthClientId: null, oauthStatus: "needs_reauth" }), expectedVersion: 3, expectedCreatedAt: row.createdAt, replaces: { sealedEnv: null, sealedOAuth: null } }]);
  });
});
