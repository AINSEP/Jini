import { describe, expect, it } from "vitest";
import type { VaultRecord } from "@jini-ai/core/contracts/vault";
import { ApiConnectionError } from "../../index.js";
import { AUTHORIZATION, CB, configuredRow, makeSharedOwner, makeSignInService, ProviderError, TOKENS, type SharedRig, type SignInRig } from "./sign-in-service-harness.js";

const OWNER = "owner";

/** Only `id` and `meta.credentialFormat` are read by the shared inventory. */
function vaultRow(id: string, credentialFormat: string): VaultRecord {
  const row: Partial<VaultRecord> = { id, meta: { credentialFormat } };
  return row as VaultRecord;
}
const flow = { completeAuthorizationCode: async () => TOKENS, beginDeviceAuthorization: async () => AUTHORIZATION };

function credentialOf(owner: SharedRig): string {
  const credentialId = owner.bindings.get("mcp:srv");
  if (credentialId === undefined) throw new Error("no shared binding");
  return credentialId;
}

/** Starts a hosted shared sign-in and completes its callback, leaving a connected shared credential. */
async function connectShared(rig: SignInRig, owner: SharedRig): Promise<string> {
  await rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER });
  await rig.service.completeAuthorizationCallback({ serverId: "srv", redirectUri: CB, params: { code: "code-1", state: "st" } });
  return credentialOf(owner);
}

function sharedRig(_over: { grant?: string; token?: (key: string) => Promise<string>; inventory?: VaultRecord[]; flow?: Record<string, (...args: never[]) => unknown> } = {}) {
  const owner = makeSharedOwner(_over.inventory === undefined ? {} : { inventory: _over.inventory });
  const rig = makeSignInService(configuredRow({ oauthGrant: _over.grant ?? "authorization_code" }), { shared: owner, flow: { ...flow, ..._over.flow }, ...(_over.token ? { token: _over.token } : {}) });
  return { owner, rig };
}

describe("shared sign-in through the hosted MCP service", () => {
  it("exposes the shared methods only when a shared owner is wired", () => {
    const { rig } = sharedRig();
    expect(Object.keys(rig.service)).toEqual(expect.arrayContaining(["assertSharedAuthorized", "useSharedConnection", "useLocalConnection", "listSharedConnections"]));
    expect(typeof rig.service.tokenResolver.resolveSharedAccessToken).toBe("function");
  });
  it("creates a shared selection from the row's configuration and returns the hosted link", async () => {
    const { owner, rig } = sharedRig();
    const start = await rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER });
    expect(start).toEqual({ kind: "redirect_required", authorizationUrl: `link:ws-1/srv?cb=${CB}`, expiresAt: expect.any(String) });
    const credentialId = credentialOf(owner);
    expect(owner.attached.has(credentialId)).toBe(true);
    expect(owner.contexts.get(credentialId)?.identity).toEqual({ pluginId: "external-mcp", connectionId: "oauth", clientId: "c1", tokenEndpoint: "https://as.test/token",
      authorizationEndpoint: "https://as.test/auth", resource: "https://r.test" });
    expect(owner.records.get(credentialId)).toMatchObject({ workspaceId: "owner-ws", status: "disconnected", revision: 1, generation: 0 });
    expect(rig.h.repo.rows.get("srv")?.oauthStatus).toBeNull();
  });
  it("refuses a shared connect from anyone but the owner", async () => {
    const { owner, rig } = sharedRig();
    await expect(rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, actorId: "someone" })).rejects.toThrow(new ApiConnectionError({ code: "access-denied", message: "shared-owner-only" }));
    expect(owner.bindings.size).toBe(0);
  });
  it("routes a bound server's connect to its shared selection, which needs a redirect URI for a code grant", async () => {
    const { owner, rig } = sharedRig();
    await connectShared(rig, owner);
    await expect(rig.service.beginConnect({ serverId: "srv", actorId: OWNER })).rejects.toThrow("shared-unavailable");
  });
  it("completes the shared callback into the shared credential, not the site row, and notifies", async () => {
    const { owner, rig } = sharedRig();
    const credentialId = await connectShared(rig, owner);
    expect(owner.records.get(credentialId)).toMatchObject({ status: "connected", generation: 1, revision: 2, grantedScopes: ["s1"] });
    expect(owner.installs).toEqual([{ key: credentialId, tokens: { ...TOKENS, scopes: ["s1"] }, generation: 1 }]);
    expect([rig.h.repo.rows.get("srv")?.oauthStatus, rig.connected]).toEqual([null, ["srv"]]);
  });
  it("polls a shared device grant: pending on a retryable answer, then connected and notified", async () => {
    const answers: (() => Promise<unknown>)[] = [async () => { throw new ProviderError("OAUTH_AUTHORIZATION_PENDING", "authorization_pending", true); }, async () => TOKENS];
    const { owner, rig } = sharedRig({ grant: "device_code", flow: { pollDeviceAuthorizationOnce: () => (answers.shift() ?? (async () => TOKENS))() } });
    const start = await rig.service.beginConnect({ serverId: "srv", destination: "shared", actorId: OWNER });
    expect(start).toMatchObject({ kind: "device_code", userCode: "UC", intervalSeconds: 5 });
    expect(await rig.service.pollDeviceAuthorization({ serverId: "srv" })).toEqual({ status: "pending", retryAfterSeconds: 5 });
    expect(rig.connected).toEqual([]);
    expect(await rig.service.pollDeviceAuthorization({ serverId: "srv" })).toEqual({ status: "connected" });
    expect([owner.records.get(credentialOf(owner))?.status, rig.connected]).toEqual(["connected", ["srv"]]);
  });
  it("drops the shared device code on a terminal answer, so the next poll is refused", async () => {
    const denied = new ProviderError("OAUTH_ACCESS_DENIED", "access_denied");
    const { rig } = sharedRig({ grant: "device_code", flow: { pollDeviceAuthorizationOnce: async () => { throw denied; } } });
    await rig.service.beginConnect({ serverId: "srv", destination: "shared", actorId: OWNER });
    await expect(rig.service.pollDeviceAuthorization({ serverId: "srv" })).rejects.toBe(denied);
    await expect(rig.service.pollDeviceAuthorization({ serverId: "srv" })).rejects.toThrow("This shared sign-in was stopped or replaced.");
  });
  it("resolves a bound server's token through one cached shared refresher keyed by the credential", async () => {
    const { owner, rig } = sharedRig({ flow: { refreshAccessToken: async () => TOKENS } });
    const credentialId = await connectShared(rig, owner);
    expect(await rig.service.tokenResolver.resolveAccessToken({ serverId: "srv" })).toBe(`tok:${credentialId}`);
    expect(await rig.service.tokenResolver.resolveSharedAccessToken?.({ serverId: "srv" })).toBe(`tok:${credentialId}`);
    expect(rig.refresherDeps).toHaveLength(2);
    expect(await rig.refresherDeps[1]?.port.refresh({ key: credentialId, refreshToken: "rt-0" })).toBe(TOKENS);
    const call = rig.h.flowCalls.find(c => c.name === "refreshAccessToken");
    expect(call?.args[0]).toMatchObject({ tokenEndpoint: "https://as.test/token", client: { clientId: "c1" }, refreshToken: "rt-0" });
    expect(call?.args[1]).toEqual({ scopes: ["s1"], resource: "https://r.test", timeoutMs: 15_000 });
  });
  it("marks the shared credential reconnect-required when its grant is dead, and rethrows", async () => {
    const dead = new ProviderError("OAUTH_INVALID_GRANT", "invalid_grant");
    const { owner, rig } = sharedRig({ token: async () => { throw dead; } });
    const credentialId = await connectShared(rig, owner);
    await expect(rig.service.tokenResolver.resolveAccessToken({ serverId: "srv" })).rejects.toBe(dead);
    expect(owner.records.get(credentialId)).toMatchObject({ status: "reconnect-required", revision: 3 });
  });
  it("keeps a shared credential connected on any other token failure", async () => {
    const outage = new ProviderError("OAUTH_PROVIDER_ERROR", "temporarily_unavailable");
    const { owner, rig } = sharedRig({ token: async () => { throw outage; } });
    const credentialId = await connectShared(rig, owner);
    await expect(rig.service.tokenResolver.resolveAccessToken({ serverId: "srv" })).rejects.toBe(outage);
    expect(owner.records.get(credentialId)).toMatchObject({ status: "connected", revision: 2 });
  });
  it("reports an auth failure by parking the shared credential once, always throwing reauth with the cause", async () => {
    const { owner, rig } = sharedRig();
    const credentialId = await connectShared(rig, owner);
    const failure = new Error("401");
    await expect(rig.service.reportAuthFailure("srv", failure)).rejects.toMatchObject({ message: "reauth:srv", cause: failure });
    expect(owner.records.get(credentialId)).toMatchObject({ status: "reconnect-required", revision: 3 });
    await expect(rig.service.reportAuthFailure("srv", failure)).rejects.toThrow("reauth:srv");
    expect(owner.records.get(credentialId)?.revision).toBe(3);
  });
  it("disconnects by detaching the credential from this site; a later auth failure leaves it untouched", async () => {
    const { owner, rig } = sharedRig();
    const credentialId = await connectShared(rig, owner);
    await rig.service.disconnect({ serverId: "srv" });
    expect([owner.attached.size, owner.bindings.get("mcp:srv")]).toEqual([0, credentialId]);
    await expect(rig.service.reportAuthFailure("srv", new Error("401"))).rejects.toThrow("reauth:srv");
    expect(owner.records.get(credentialId)).toMatchObject({ status: "connected", revision: 2 });
    expect(rig.h.repo.rows.get("srv")?.oauthStatus).toBeNull();
  });
});

describe("choosing between shared and local connections", () => {
  it("answers whether a bound, connected shared credential authorizes the server", async () => {
    const { owner, rig } = sharedRig();
    expect(await rig.service.assertSharedAuthorized?.({ serverId: "srv" })).toBe(false);
    await connectShared(rig, owner);
    expect(await rig.service.assertSharedAuthorized?.({ serverId: "srv" })).toBe(true);
  });
  it("switches to the local connection (owner only), then back to the saved shared one", async () => {
    const { owner, rig } = sharedRig();
    const credentialId = await connectShared(rig, owner);
    await expect(rig.service.useLocalConnection?.({ serverId: "srv", actorId: "someone" })).rejects.toThrow("shared-owner-only");
    await rig.service.useLocalConnection?.({ serverId: "srv", actorId: OWNER });
    expect([owner.bindings.size, owner.attached.size]).toEqual([0, 0]);
    await rig.service.useLocalConnection?.({ serverId: "srv", actorId: OWNER });
    await rig.service.useSharedConnection?.({ serverId: "srv", credentialId, actorId: OWNER });
    expect([owner.bindings.get("mcp:srv"), owner.attached.has(credentialId)]).toEqual([credentialId, true]);
  });
  it("refuses to select a saved credential that is not connected or a server that no longer exists", async () => {
    const { owner, rig } = sharedRig();
    await rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER });
    const credentialId = credentialOf(owner);
    await expect(rig.service.useSharedConnection?.({ serverId: "srv", credentialId, actorId: OWNER })).rejects.toThrow("shared-unavailable");
    await expect(rig.service.useSharedConnection?.({ serverId: "gone", credentialId, actorId: OWNER })).rejects.toThrow("shared-unavailable");
  });
  it("lists only connected token-set credentials for this server's URL, plus the current selection", async () => {
    const inventory: VaultRecord[] = [];
    const { owner, rig } = sharedRig({ inventory });
    const listed = (actorId = OWNER) => rig.service.listSharedConnections?.({ serverId: "srv", actorId });
    expect(await listed()).toEqual({ available: true, connections: [], current: null });
    const credentialId = await connectShared(rig, owner);
    await rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER });
    const pending = credentialOf(owner);
    inventory.push(
      vaultRow(credentialId, "oauth-token-set"),
      vaultRow(pending, "oauth-token-set"),
      vaultRow("no-context", "oauth-token-set"),
      vaultRow(credentialId, "api-key"),
    );
    expect(await listed()).toEqual({ available: true, connections: [{ credentialId, label: "Server" }], current: { credentialId: pending, status: "disconnected", granted: true } });
    await expect(listed("someone")).rejects.toThrow("shared-owner-only");
  });
  it("lists nothing when the owner keeps no inventory", async () => {
    const { owner, rig } = sharedRig();
    await connectShared(rig, owner);
    expect(await rig.service.listSharedConnections?.({ serverId: "srv", actorId: OWNER })).toMatchObject({ available: true, connections: [] });
  });
});
