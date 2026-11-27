import { describe, expect, it } from "vitest";
import type { DeviceAuthorization } from "@jini-ai/core/contracts/oauth";
import { createDeviceAuthorizationStore } from "../sign-in.js";
import { NOW_ISO, NOW_MS, sealed } from "./sign-in-harness.js";
import { AUTHORIZATION, CB, configuredRow, makeSignInService, PROVIDER, ProviderError, TOKENS } from "./sign-in-service-harness.js";

const CLIENT = { clientId: "c1", authMethod: "none" };
const rowOf = async (rig: ReturnType<typeof makeSignInService>) => rig.h.repo.rows.get("srv");

describe("createDeviceAuthorizationStore", () => {
  it("keeps one pending authorization per server until it is deleted", async () => {
    const store = createDeviceAuthorizationStore();
    const first = AUTHORIZATION as DeviceAuthorization;
    const second = { ...first, deviceCode: "dc-2" };
    await store.put("srv", first);
    await store.put("srv", second);
    await store.put("other", first);
    expect(await store.get("srv")).toBe(second);
    await store.delete("srv");
    expect([await store.get("srv"), await store.get("other")]).toEqual([undefined, first]);
  });
});

describe("createHostedMcpSignInService construction", () => {
  it("builds its own provider registry from the guard only when none is injected, and exposes no shared methods", () => {
    const own = makeSignInService(configuredRow(), { providers: false });
    expect(own.h.flowCalls.map(c => c.name)).toEqual(["createOAuthProviderRegistry", "createTokenRefresher"]);
    expect(own.h.flowCalls[0]?.args).toEqual([{ guard: { tag: "guard" } }]);
    const injected = makeSignInService(configuredRow());
    expect(injected.h.flowCalls.map(c => c.name)).toEqual(["createTokenRefresher"]);
    expect(Object.keys(injected.service).sort()).toEqual(["beginConnect", "completeAuthorizationCallback", "disconnect", "pollDeviceAuthorization", "reportAuthFailure", "tokenResolver"]);
    expect(Object.keys(injected.service.tokenResolver)).toEqual(["resolveAccessToken"]);
  });
});

describe("beginConnect (site-local)", () => {
  it("refuses a shared destination when the host wired no shared owner", async () => {
    const rig = makeSignInService(configuredRow());
    await expect(rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB })).rejects.toThrow("validation(destination): shared-local-only");
  });
  it("starts a device grant without needing a redirect URI and parks the authorization", async () => {
    const rig = makeSignInService(configuredRow({ oauthGrant: "device_code" }), { flow: { beginDeviceAuthorization: async () => AUTHORIZATION } });
    const start = await rig.service.beginConnect({ serverId: "srv" });
    expect(start).toEqual({ kind: "device_code", ...AUTHORIZATION, deviceCode: undefined });
    expect(await rig.devices.get("srv")).toEqual(AUTHORIZATION);
    expect((await rowOf(rig))?.oauthStatus).toBe("pending");
  });
  it("refuses a redirect grant with no public origin, naming the server, and writes nothing", async () => {
    const rig = makeSignInService(configuredRow());
    await expect(rig.service.beginConnect({ serverId: "srv" })).rejects.toThrow("validation(redirectUri): no public origin for srv");
    expect([rig.h.repo.runtimeCalls, rig.h.repo.ifVersionCalls]).toEqual([[], []]);
  });
  it("hands a hosted browser the host sign-in link, valid ten minutes, and marks the row pending", async () => {
    const rig = makeSignInService(configuredRow());
    const start = await rig.service.beginConnect({ serverId: "srv", redirectUri: CB, delivery: "hosted" });
    expect(start).toEqual({ kind: "redirect_required", authorizationUrl: `link:ws-1/srv?cb=${CB}`, expiresAt: new Date(NOW_MS + 600_000).toISOString() });
    expect(rig.h.flowCalls.map(c => c.name)).toEqual(["createTokenRefresher"]);
    expect((await rowOf(rig))?.oauthStatus).toBe("pending");
  });
  it("starts an authorization-code flow with the row's client, scopes and audience", async () => {
    const rig = makeSignInService(configuredRow(), { flow: { beginAuthorizationCode: async () => ({ authorizationUrl: "https://as.test/auth?q", expiresAt: "2026-01-02T03:14:05.000Z" }) } });
    const start = await rig.service.beginConnect({ serverId: "srv", redirectUri: CB, browserBinding: "bb" });
    expect(start).toEqual({ kind: "redirect_required", authorizationUrl: "https://as.test/auth?q", expiresAt: "2026-01-02T03:14:05.000Z" });
    const call = rig.h.flowCalls.find(c => c.name === "beginAuthorizationCode");
    const [first, second] = (call?.args ?? []) as [Record<string, unknown> & { randomBytesFn: (i: { byteLength: number }) => Uint8Array }, unknown];
    expect(first).toMatchObject({ provider: PROVIDER, stateless: { sealedFor: "ws-1/srv" }, guard: { tag: "guard" }, ownerKey: "ws-1:srv", client: CLIENT, redirectUri: CB,
      options: { clientDisplayName: "client for Server", softwareId: "sw-id", redirectUris: [CB] } });
    expect(first.randomBytesFn({ byteLength: 7 }).length).toBe(7);
    expect(second).toEqual({ scopes: ["s1"], resource: "https://r.test", messages: { tag: "messages" } });
    expect((await rowOf(rig))?.oauthStatus).toBe("pending");
  });
});

describe("completeAuthorizationCallback (site-local)", () => {
  const input = { serverId: "srv", redirectUri: CB, params: { code: "code-1", state: "st" }, browserBinding: "bb" };
  it("exchanges the code, persists the tokens against the row's config version and notifies once", async () => {
    const rig = makeSignInService(configuredRow(), { flow: { completeAuthorizationCode: async () => TOKENS } });
    await rig.service.completeAuthorizationCallback(input);
    const call = rig.h.flowCalls.find(c => c.name === "completeAuthorizationCode");
    expect(call?.args[0]).toMatchObject({ provider: PROVIDER, redirectUri: CB, ownerKey: "ws-1:srv", client: CLIENT, params: input.params, stateless: { sealedFor: "ws-1/srv" } });
    expect(call?.args[1]).toEqual({ timeoutMs: 15_000 });
    expect(rig.h.repo.runtimeCalls[0]?.expectedConfig).toEqual({ createdAt: "2025-01-01T00:00:00.000Z", version: 3 });
    expect((await rowOf(rig))?.oauthStatus).toBe("connected");
    expect(rig.connected).toEqual(["srv"]);
  });
  it("logs a failing post-connect hook instead of failing the sign-in", async () => {
    const hookError = new Error("hook down");
    const rig = makeSignInService(configuredRow(), { flow: { completeAuthorizationCode: async () => TOKENS }, onConnected: async () => { throw hookError; } });
    await rig.service.completeAuthorizationCallback(input);
    expect(rig.h.logged).toEqual([{ serverId: "srv", error: hookError }]);
    expect((await rowOf(rig))?.oauthStatus).toBe("connected");
  });
  it("succeeds without notifying when the host wired no post-connect hook", async () => {
    const rig = makeSignInService(configuredRow(), { flow: { completeAuthorizationCode: async () => TOKENS }, onConnected: null });
    await rig.service.completeAuthorizationCallback(input);
    expect([(await rowOf(rig))?.oauthStatus, rig.connected, rig.h.logged]).toEqual(["connected", [], []]);
  });
  it("keeps the row for a failure that is not an OAuth error or names no provider code", async () => {
    for (const failure of [new Error("socket hang up"), new ProviderError("OAUTH_PROVIDER_ERROR", undefined)]) {
      const rig = makeSignInService(configuredRow({ oauthStatus: "pending" }), { flow: { completeAuthorizationCode: async () => { throw failure; } } });
      await expect(rig.service.completeAuthorizationCallback(input)).rejects.toBe(failure);
      expect([(await rowOf(rig))?.oauthStatus, rig.h.repo.runtimeCalls, rig.h.repo.ifVersionCalls]).toEqual(["pending", [], []]);
    }
  });
  it("disconnects the row when the provider rejects the client, and still surfaces that error", async () => {
    const rejected = new ProviderError("OAUTH_PROVIDER_ERROR", "invalid_client");
    const rig = makeSignInService(configuredRow({ oauthStatus: "pending" }), { flow: { completeAuthorizationCode: async () => { throw rejected; } } });
    await expect(rig.service.completeAuthorizationCallback(input)).rejects.toBe(rejected);
    expect((await rowOf(rig))?.oauthStatus).toBe("disconnected");
    expect(rig.connected).toEqual([]);
  });
  it("leaves the row alone for any other provider failure", async () => {
    const outage = new ProviderError("OAUTH_PROVIDER_ERROR", "server_error");
    const rig = makeSignInService(configuredRow({ oauthStatus: "pending" }), { flow: { completeAuthorizationCode: async () => { throw outage; } } });
    await expect(rig.service.completeAuthorizationCallback(input)).rejects.toBe(outage);
    expect([(await rowOf(rig))?.oauthStatus, rig.h.repo.runtimeCalls, rig.h.repo.ifVersionCalls]).toEqual(["pending", [], []]);
  });
});

describe("pollDeviceAuthorization (site-local)", () => {
  const deviceRow = () => configuredRow({ oauthGrant: "device_code", oauthStatus: "pending" });
  it("refuses a poll with no device authorization in progress", async () => {
    const rig = makeSignInService(deviceRow());
    await expect(rig.service.pollDeviceAuthorization({ serverId: "srv" })).rejects.toMatchObject({ code: "OAUTH_INVALID_STATE", operatorAction: "act-device", message: "no device authorization is in progress for 'srv'" });
  });
  it("connects on a granted poll: forgets the device code, persists the tokens and notifies", async () => {
    const rig = makeSignInService(deviceRow(), { flow: { pollDeviceAuthorizationOnce: async () => TOKENS } });
    await rig.devices.put("srv", AUTHORIZATION);
    expect(await rig.service.pollDeviceAuthorization({ serverId: "srv" })).toEqual({ status: "connected" });
    const call = rig.h.flowCalls.find(c => c.name === "pollDeviceAuthorizationOnce");
    expect(call?.args[0]).toMatchObject({ provider: PROVIDER, client: CLIENT, deviceCode: "dc-1", expiresAt: AUTHORIZATION.expiresAt });
    expect(call?.args[1]).toEqual({ resource: "https://r.test", timeoutMs: 15_000 });
    expect([await rig.devices.get("srv"), (await rowOf(rig))?.oauthStatus, rig.connected]).toEqual([undefined, "connected", ["srv"]]);
  });
  it("keeps polling on a retryable answer, preferring the provider's wait over the start interval", async () => {
    const waits = [new ProviderError("OAUTH_AUTHORIZATION_PENDING", "slow_down", true, 9), new ProviderError("OAUTH_AUTHORIZATION_PENDING", "authorization_pending", true)];
    const rig = makeSignInService(deviceRow(), { flow: { pollDeviceAuthorizationOnce: async () => { throw waits.shift(); } } });
    await rig.devices.put("srv", AUTHORIZATION);
    expect(await rig.service.pollDeviceAuthorization({ serverId: "srv" })).toEqual({ status: "pending", retryAfterSeconds: 9 });
    expect(await rig.service.pollDeviceAuthorization({ serverId: "srv" })).toEqual({ status: "pending", retryAfterSeconds: 5 });
    expect([await rig.devices.get("srv"), (await rowOf(rig))?.oauthStatus]).toEqual([AUTHORIZATION, "pending"]);
  });
  it("ends the attempt on a terminal answer: forgets the device code and disconnects", async () => {
    const denied = new ProviderError("OAUTH_ACCESS_DENIED", "access_denied");
    const rig = makeSignInService(deviceRow(), { flow: { pollDeviceAuthorizationOnce: async () => { throw denied; } } });
    await rig.devices.put("srv", AUTHORIZATION);
    await expect(rig.service.pollDeviceAuthorization({ serverId: "srv" })).rejects.toBe(denied);
    expect([await rig.devices.get("srv"), (await rowOf(rig))?.oauthStatus]).toEqual([undefined, "disconnected"]);
  });
});

describe("disconnect (site-local)", () => {
  it("drops the pending device code and clears the token", async () => {
    const rig = makeSignInService(configuredRow({ oauthStatus: "connected", sealedOAuth: sealed({ tokens: { ...TOKENS, scopes: ["s1"] } }) }));
    await rig.devices.put("srv", AUTHORIZATION);
    await rig.service.disconnect({ serverId: "srv" });
    const row = await rowOf(rig);
    expect([await rig.devices.get("srv"), row?.oauthStatus]).toEqual([undefined, "disconnected"]);
    expect(rig.h.seals.at(-1)).toEqual({});
  });
});

describe("reportAuthFailure (site-local)", () => {
  const failure = new Error("401 from server");
  it("passes the original error through for an unknown or non-OAuth connection", async () => {
    await expect(makeSignInService(configuredRow({ serverId: "other" })).service.reportAuthFailure("srv", failure)).rejects.toBe(failure);
    await expect(makeSignInService(configuredRow({ authMode: "static_env" })).service.reportAuthFailure("srv", failure)).rejects.toBe(failure);
  });
  it("parks a live connection in needs_reauth and throws the terminal reauth error", async () => {
    const rig = makeSignInService(configuredRow({ oauthStatus: "connected" }));
    const error = await rig.service.reportAuthFailure("srv", failure).catch((e: unknown) => e);
    expect(error).toMatchObject({ message: "reauth:srv", label: "Server", cause: undefined });
    expect((await rowOf(rig))?.oauthStatus).toBe("needs_reauth");
  });
  it("does not rewrite a row already in needs_reauth", async () => {
    const rig = makeSignInService(configuredRow({ oauthStatus: "needs_reauth" }));
    await expect(rig.service.reportAuthFailure("srv", failure)).rejects.toThrow("reauth:srv");
    expect([rig.h.repo.runtimeCalls, rig.h.repo.ifVersionCalls, rig.h.seals]).toEqual([[], [], []]);
  });
  it("carries a failed status write as the cause instead of throwing it in place of the reauth error", async () => {
    const writeError = new Error("disk full");
    const rig = makeSignInService(configuredRow({ oauthStatus: "connected" }));
    rig.h.repo.updateOAuthRuntime = async () => { throw writeError; };
    rig.h.repo.updateIfVersion = async () => { throw writeError; };
    await expect(rig.service.reportAuthFailure("srv", failure)).rejects.toMatchObject({ message: "reauth:srv", cause: writeError });
  });
});

describe("tokenResolver (site-local)", () => {
  it("returns the refresher's token for the server", async () => {
    expect(await makeSignInService(configuredRow()).service.tokenResolver.resolveAccessToken({ serverId: "srv" })).toBe("tok:srv");
  });
  it("turns a dead grant into the reauth error, labelled when the row still exists", async () => {
    const dead = async () => { throw new ProviderError("OAUTH_INVALID_GRANT", "invalid_grant"); };
    await expect(makeSignInService(configuredRow(), { token: dead }).service.tokenResolver.resolveAccessToken({ serverId: "srv" })).rejects.toMatchObject({ message: "reauth:srv", label: "Server" });
    await expect(makeSignInService(configuredRow({ serverId: "gone" }), { token: dead }).service.tokenResolver.resolveAccessToken({ serverId: "srv" })).rejects.toMatchObject({ message: "reauth:srv", label: null });
  });
  it("keeps any other failure as itself", async () => {
    const outage = new ProviderError("OAUTH_PROVIDER_ERROR", "temporarily_unavailable");
    await expect(makeSignInService(configuredRow(), { token: async () => { throw outage; } }).service.tokenResolver.resolveAccessToken({ serverId: "srv" })).rejects.toBe(outage);
  });
});

describe("the connection token refresher's port", () => {
  const portOf = (rig: ReturnType<typeof makeSignInService>) => {
    const deps = rig.refresherDeps[0];
    if (!deps) throw new Error("refresher was not created");
    return deps;
  };
  it("loads a copy of the stored tokens, and nothing for a missing, parked or token-less row", async () => {
    const stored = { ...TOKENS, scopes: ["s1"] };
    const live = makeSignInService(configuredRow({ sealedOAuth: sealed({ tokens: stored }) }));
    const loaded = await portOf(live).port.load({ key: "srv" });
    expect(loaded).toEqual(stored);
    expect(loaded?.scopes).not.toBe(stored.scopes);
    expect(await portOf(live).port.load({ key: "missing" })).toBeNull();
    expect(await portOf(makeSignInService(configuredRow({ oauthStatus: "needs_reauth", sealedOAuth: sealed({ tokens: stored }) }))).port.load({ key: "srv" })).toBeNull();
    expect(await portOf(makeSignInService(configuredRow())).port.load({ key: "srv" })).toBeNull();
  });
  it("refreshes against the provider's token endpoint with the row's scopes and audience", async () => {
    const rig = makeSignInService(configuredRow(), { flow: { refreshAccessToken: async () => TOKENS } });
    expect(await portOf(rig).port.refresh({ key: "srv", refreshToken: "rt-0" })).toBe(TOKENS);
    const call = rig.h.flowCalls.find(c => c.name === "refreshAccessToken");
    expect(call?.args[0]).toMatchObject({ guard: { tag: "guard" }, tokenEndpoint: "https://as.test/token", client: CLIENT, refreshToken: "rt-0" });
    expect(call?.args[1]).toEqual({ scopes: ["s1"], resource: "https://r.test", timeoutMs: 15_000 });
  });
  it("persists refreshed tokens and parks a dead grant as needs_reauth", async () => {
    const rig = makeSignInService(configuredRow());
    await portOf(rig).port.persist({ key: "srv", tokens: TOKENS });
    expect((await rowOf(rig))?.oauthExpiresAt).toBe(TOKENS.expiresAt);
    await portOf(rig).port.markNeedsReauth({ key: "srv", reason: "invalid_grant" });
    expect((await rowOf(rig))?.oauthStatus).toBe("needs_reauth");
  });
  it("claims a 45-second refresh lease and releases it", async () => {
    const rig = makeSignInService(configuredRow());
    rig.h.repo.leaseGranted = false;
    expect(await portOf(rig).port.tryAcquireRefreshLease?.({ key: "srv" })).toBe(false);
    await portOf(rig).port.releaseRefreshLease?.({ key: "srv" });
    expect(rig.h.repo.leaseCalls).toEqual([
      { name: "claim", input: { workspaceId: "ws-1", serverId: "srv", nowIso: NOW_ISO, leaseUntil: new Date(NOW_MS + 45_000).toISOString() } },
      { name: "release", input: { workspaceId: "ws-1", serverId: "srv" } },
    ]);
  });
  it("sleeps on a real timer", async () => {
    const rig = makeSignInService(configuredRow());
    const started = Date.now();
    await portOf(rig).sleep({ ms: 20 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});
