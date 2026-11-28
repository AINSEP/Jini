import { describe, expect, it, vi } from "vitest";
import type { ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { KeyringPort, SecretSealerPort, VaultRecord } from "@jini-ai/core/contracts/vault";
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

function sharedRig(_over: { row?: Partial<ExternalMcpServerRecord>; grant?: string; token?: (key: string) => Promise<string>; inventory?: VaultRecord[]; flow?: Record<string, (...args: never[]) => unknown>; extra?: NonNullable<Parameters<typeof makeSignInService>[1]>['extra'] } = {}) {
  const owner = makeSharedOwner(_over.inventory === undefined ? {} : { inventory: _over.inventory });
  const rig = makeSignInService(configuredRow({ oauthGrant: _over.grant ?? "authorization_code", ..._over.row }), { shared: owner, flow: { ...flow, ..._over.flow }, ...(_over.token ? { token: _over.token } : {}), ...(_over.extra ? { extra: _over.extra } : {}) });
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
  it("refuses to start when the owner record vanishes between selecting the credential and reading it", async () => {
    const { owner, rig } = sharedRig();
    const set = owner.shared.bindings.set;
    // A concurrent global stop removes the owner record right after this site's binding is written.
    Object.assign(owner.shared.bindings, { set: async (input: { consumerId: string; credentialId: string }) => { await set(input); owner.records.delete(input.credentialId); } });
    await expect(rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER }))
      .rejects.toThrow("shared-unavailable");
    expect(owner.records.size).toBe(0);
    expect(rig.h.repo.rows.get("srv")?.oauthStatus).toBeNull();
  });
  it("takes the shared audience from the server URL when the row stores none, and omits it when there is no URL", async () => {
    for (const [url, resource] of [["https://mcp.example.test/mcp", "https://mcp.example.test/mcp"], [null, undefined]] as const) {
      const { owner, rig } = sharedRig({ row: { oauthEndpointsJson: null, url } });
      await rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER });
      expect(owner.contexts.get(credentialOf(owner))?.identity.resource).toBe(resource);
    }
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

type Codec = { seal: (input: { plaintext: string }) => Promise<string>; open: (input: { state: string }) => Promise<string> };

/** A sealer that refuses to open a blob under any AAD but the one it was sealed with. */
function aadBoundSealer() {
  const sealedWith: { keyId: string; aad: string }[] = [];
  const sealer: SecretSealerPort = {
    seal: async ({ plaintext, key, aad }) => { sealedWith.push({ keyId: key.keyId, aad }); return { keyId: key.keyId, ciphertext: plaintext, nonce: aad, alg: "fake" }; },
    open: async ({ sealed }, optional = {}) => { if (sealed.nonce !== optional.aad) throw new Error("aad mismatch"); return sealed.ciphertext; },
  };
  const keyring = { activeKey: async () => ({ keyId: "root-1" }) } as Partial<KeyringPort> as KeyringPort;
  return { sealer, keyring, sealedWith };
}

/** Makes the next binding read answer as usual, then drops the binding: a concurrent "use local" right after routing. */
function dropBindingAfterNextRead(owner: SharedRig) {
  const read = owner.shared.bindings.read;
  Object.assign(owner.shared.bindings, { read: async (input: { consumerId: string }) => {
    const found = await read(input);
    owner.bindings.delete(input.consumerId);
    Object.assign(owner.shared.bindings, { read });
    return found;
  } });
}

describe("shared sign-in: direct (non-hosted) code grant", () => {
  it("starts with host randomness, an attempt-bound sealed state and no audience when the row has none", async () => {
    const codecs: Codec[] = [];
    const begun: { args: unknown[] }[] = [];
    const vault = aadBoundSealer();
    const { owner, rig } = sharedRig({ row: { oauthEndpointsJson: null, url: null }, extra: { sealer: vault.sealer, keyring: vault.keyring }, flow: {
      createSealedAuthorizationState: (input: { codec: Codec; workspaceId: string; serverId: string }) => { codecs.push(input.codec); return { sealedFor: `${input.workspaceId}/${input.serverId}` }; },
      beginAuthorizationCode: async (...args: unknown[]) => { begun.push({ args }); return { authorizationUrl: "https://as.test/auth?state=s", expiresAt: "2026-01-02T03:14:05.000Z" }; },
    } });
    const start = await rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, browserBinding: "bb-1", actorId: OWNER });
    expect(start).toEqual({ kind: "redirect_required", authorizationUrl: "https://as.test/auth?state=s", expiresAt: "2026-01-02T03:14:05.000Z" });
    const credentialId = credentialOf(owner);
    const [input, options] = begun[0]?.args as [{ randomBytesFn: (i: { byteLength: number }) => Uint8Array; stateless: unknown; ownerKey: string; redirectUri: string; client: unknown; options: unknown }, unknown];
    expect(options).toStrictEqual({ scopes: ["s1"] });
    expect(input).toMatchObject({ stateless: { sealedFor: "site-1/srv" }, ownerKey: JSON.stringify(["site-1", "srv", credentialId]), redirectUri: CB, client: { clientId: "c1" },
      options: { clientDisplayName: "shared", softwareId: "sw-id", redirectUris: [CB] } });
    const [a, b] = [input.randomBytesFn({ byteLength: 12 }), input.randomBytesFn({ byteLength: 12 })];
    expect([a.length, Buffer.from(a).equals(Buffer.from(b))]).toEqual([12, false]);
    const sealedState = await codecs[0]!.seal({ plaintext: "pt-1" });
    expect(await codecs[0]!.open({ state: sealedState })).toBe("pt-1");
    expect(vault.sealedWith).toEqual([{ keyId: "root-1", aad: `oauth-redirect-state|v1|${JSON.stringify(["shared", "site-1", "srv", credentialId, 0, "bb-1"])}` }]);
  });
  it("will not open a state sealed for a different browser", async () => {
    const codecs: Codec[] = [];
    const vault = aadBoundSealer();
    const { rig } = sharedRig({ extra: { sealer: vault.sealer, keyring: vault.keyring }, flow: {
      createSealedAuthorizationState: (input: { codec: Codec }) => { codecs.push(input.codec); return {}; },
      beginAuthorizationCode: async () => ({ authorizationUrl: "https://as.test/auth", expiresAt: "2026-01-02T03:14:05.000Z" }),
    } });
    await rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, browserBinding: "bb-1", actorId: OWNER });
    await rig.service.beginConnect({ serverId: "srv", redirectUri: CB, browserBinding: "bb-2", actorId: OWNER });
    const forFirst = await codecs[0]!.seal({ plaintext: "pt-1" });
    await expect(codecs[1]!.open({ state: forFirst })).rejects.toThrow("aad mismatch");
  });
});

describe("shared sign-in: credentials without an audience or authorization endpoint", () => {
  it("refreshes a shared token without an audience and waits the refresher's asked-for time", async () => {
    const { owner, rig } = sharedRig({ row: { oauthEndpointsJson: null, url: null }, flow: { refreshAccessToken: async () => TOKENS } });
    const credentialId = await connectShared(rig, owner);
    expect(await rig.service.tokenResolver.resolveSharedAccessToken?.({ serverId: "srv" })).toBe(`tok:${credentialId}`);
    const deps = rig.refresherDeps.at(-1)!;
    await deps.port.refresh({ key: credentialId, refreshToken: "rt-0" });
    expect(rig.h.flowCalls.find(c => c.name === "refreshAccessToken")?.args[1]).toStrictEqual({ scopes: ["s1"], timeoutMs: 15_000 });
    vi.useFakeTimers();
    try {
      let woke = false;
      const slept = deps.sleep({ ms: 300 }).then(() => { woke = true; });
      await vi.advanceTimersByTimeAsync(299);
      expect(woke).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await slept;
      expect(woke).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("seals a confidential, connection-owned provider with an issuer and no authorization endpoint, and still authorizes it", async () => {
    const operatorProvider = { providerId: "connection-srv", label: "Server", tokenEndpoint: "https://as.test/token2", clientAuth: "client_secret_post" };
    const { owner, rig } = sharedRig({ row: { oauthEndpointsJson: JSON.stringify({ tokenEndpoint: "https://as.test/token2", issuer: "https://as.test", resource: "https://r.test" }) },
      flow: { buildOperatorOAuthProvider: () => operatorProvider } });
    const credentialId = await connectShared(rig, owner);
    const context = owner.contexts.get(credentialId);
    expect(context?.identity).toEqual({ pluginId: "external-mcp", connectionId: "oauth", clientId: "c1", tokenEndpoint: "https://as.test/token2", resource: "https://r.test", issuer: "https://as.test" });
    expect([context?.clientKind, context?.descriptor.authorizationEndpoint]).toEqual(["confidential", "https://as.test/token2"]);
    expect(await rig.service.assertSharedAuthorized?.({ serverId: "srv" })).toBe(true);
  });
});

describe("shared sign-in: the binding changes under a request", () => {
  it("starts a fresh shared selection when the binding is dropped between routing and selecting", async () => {
    const { owner, rig } = sharedRig();
    const first = await connectShared(rig, owner);
    dropBindingAfterNextRead(owner);
    const start = await rig.service.beginConnect({ serverId: "srv", redirectUri: CB, delivery: "hosted", actorId: OWNER });
    expect(start).toMatchObject({ kind: "redirect_required", authorizationUrl: `link:ws-1/srv?cb=${CB}` });
    const fresh = credentialOf(owner);
    expect(fresh).not.toBe(first);
    expect([owner.records.get(fresh)?.status, owner.records.get(first)?.status, owner.attached.has(fresh)]).toEqual(["disconnected", "connected", true]);
  });
  it("refuses a callback or a device poll whose binding is dropped after routing", async () => {
    const { owner, rig } = sharedRig({ grant: "device_code" });
    await rig.service.beginConnect({ serverId: "srv", destination: "shared", actorId: OWNER });
    dropBindingAfterNextRead(owner);
    await expect(rig.service.pollDeviceAuthorization({ serverId: "srv" })).rejects.toThrow("This shared sign-in was stopped or replaced.");
    const code = sharedRig();
    await code.rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER });
    dropBindingAfterNextRead(code.owner);
    await expect(code.rig.service.completeAuthorizationCallback({ serverId: "srv", redirectUri: CB, params: { code: "code-1", state: "st" } }))
      .rejects.toThrow("This shared sign-in was stopped or replaced.");
    expect(code.owner.installs).toEqual([]);
  });
  it("resolves no shared token for a server that is not bound", async () => {
    const { rig } = sharedRig();
    expect(await rig.service.tokenResolver.resolveSharedAccessToken?.({ serverId: "srv" })).toBeUndefined();
    expect(rig.refresherDeps).toHaveLength(1);
  });
  it("reports the current selection as disconnected once its owner record is gone", async () => {
    const { owner, rig } = sharedRig({ inventory: [] });
    const credentialId = await connectShared(rig, owner);
    owner.records.delete(credentialId);
    expect(await rig.service.listSharedConnections?.({ serverId: "srv", actorId: OWNER })).toEqual({ available: true, connections: [], current: { credentialId, status: "disconnected", granted: true } });
  });
});

describe("shared sign-in: refusals while starting", () => {
  it("refuses a shared start for a server that is gone or runs over stdio, before configuring anything", async () => {
    for (const row of [{ serverId: "other" }, { transport: "stdio" as const }]) {
      const { owner, rig } = sharedRig({ row });
      await expect(rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER })).rejects.toThrow("shared-unavailable");
      expect([owner.contexts.size, owner.bindings.size]).toEqual([0, 0]);
    }
  });
  it("refuses when the new owner record cannot be created, leaving no binding or grant", async () => {
    const { owner, rig } = sharedRig();
    Object.assign(owner.shared.owner.records, { compareAndSet: async () => false });
    await expect(rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER })).rejects.toThrow("shared-unavailable");
    expect([owner.bindings.size, owner.attached.size]).toEqual([0, 0]);
  });
});

describe("shared sign-in: refusals at completion", () => {
  const stopped = "This shared sign-in was stopped or replaced.";
  const callback = (rig: SignInRig) => rig.service.completeAuthorizationCallback({ serverId: "srv", redirectUri: CB, params: { code: "code-1", state: "st" } });
  async function begun(over: Parameters<typeof sharedRig>[0] = {}) {
    const made = sharedRig(over);
    await made.rig.service.beginConnect({ serverId: "srv", destination: "shared", redirectUri: CB, delivery: "hosted", actorId: OWNER });
    return { ...made, credentialId: credentialOf(made.owner) };
  }
  it("refuses a callback after this site stopped using the credential", async () => {
    const { owner, rig } = await begun();
    await rig.service.disconnect({ serverId: "srv" });
    await expect(callback(rig)).rejects.toThrow(stopped);
    expect(owner.installs).toEqual([]);
  });
  it("refuses a callback whose owner record is gone or is being revoked", async () => {
    const gone = await begun();
    gone.owner.records.delete(gone.credentialId);
    await expect(callback(gone.rig)).rejects.toThrow(stopped);
    const revoking = await begun();
    revoking.owner.records.set(revoking.credentialId, { ...revoking.owner.records.get(revoking.credentialId)!, status: "revocation-pending" });
    await expect(callback(revoking.rig)).rejects.toThrow(stopped);
    expect([gone.owner.installs, revoking.owner.installs]).toEqual([[], []]);
  });
  it("refuses a device poll whose owner record is gone", async () => {
    const { owner, rig } = sharedRig({ grant: "device_code" });
    await rig.service.beginConnect({ serverId: "srv", destination: "shared", actorId: OWNER });
    owner.records.delete(credentialOf(owner));
    await expect(rig.service.pollDeviceAuthorization({ serverId: "srv" })).rejects.toThrow(stopped);
  });
  it("refuses tokens that grant fewer scopes than the selection asked for", async () => {
    const { owner, rig, credentialId } = await begun({ flow: { completeAuthorizationCode: async () => ({ ...TOKENS, scopes: ["other"] }) } });
    await expect(callback(rig)).rejects.toThrow("shared-unavailable");
    expect([owner.records.get(credentialId)?.status, owner.installs]).toEqual(["disconnected", []]);
  });
  it("records the requested scopes as granted when the provider names none", async () => {
    const { owner, rig, credentialId } = await begun({ flow: { completeAuthorizationCode: async () => ({ ...TOKENS, scopes: [] }) } });
    await callback(rig);
    expect(owner.records.get(credentialId)?.grantedScopes).toEqual(["s1"]);
    expect(owner.installs).toEqual([{ key: credentialId, tokens: { ...TOKENS, scopes: ["s1"] }, generation: 1 }]);
  });
  it("refuses when another writer moves the owner record before the tokens are installed", async () => {
    const { owner, rig, credentialId } = await begun();
    Object.assign(owner.shared.owner.records, { compareAndSet: async () => false });
    await expect(callback(rig)).rejects.toThrow(stopped);
    expect([owner.records.get(credentialId)?.status, owner.installs]).toEqual(["disconnected", []]);
  });
});

describe("shared sign-in: refusals while serving a bound credential", () => {
  it("refuses a saved credential whose sealed context is missing or names another plugin or connection", async () => {
    const { owner, rig } = sharedRig();
    const credentialId = await connectShared(rig, owner);
    const context = owner.contexts.get(credentialId)!;
    owner.contexts.set("foreign-plugin", { ...context, identity: { ...context.identity, pluginId: "other" } });
    owner.contexts.set("foreign-connection", { ...context, identity: { ...context.identity, connectionId: "apikey" } });
    // Connected records too, so only the sealed context's identity can refuse them.
    for (const id of ["foreign-plugin", "foreign-connection"]) owner.records.set(id, { ...owner.records.get(credentialId)!, key: id });
    for (const id of ["missing", "foreign-plugin", "foreign-connection"]) {
      await expect(rig.service.useSharedConnection?.({ serverId: "srv", credentialId: id, actorId: OWNER })).rejects.toThrow("shared-unavailable");
    }
    expect(owner.bindings.get("mcp:srv")).toBe(credentialId);
  });
  it("refuses a bound server whose row is gone", async () => {
    const { owner, rig } = sharedRig();
    await connectShared(rig, owner);
    rig.h.repo.rows.delete("srv");
    await expect(rig.service.assertSharedAuthorized?.({ serverId: "srv" })).rejects.toThrow("shared-unavailable");
  });
  it("refuses a bound server that stopped being an OAuth server, moved to stdio, or changed its URL", async () => {
    for (const change of [{ authMode: "none" }, { transport: "stdio" as const }, { url: "https://elsewhere.test/mcp" }]) {
      const { owner, rig } = sharedRig();
      await connectShared(rig, owner);
      rig.h.repo.rows.set("srv", { ...rig.h.repo.rows.get("srv")!, ...change });
      await expect(rig.service.assertSharedAuthorized?.({ serverId: "srv" })).rejects.toThrow("shared-unavailable");
    }
  });
  it("authorizes a bound server whose row lists no scopes", async () => {
    const { owner, rig } = sharedRig({ row: { oauthScopesJson: null } });
    await connectShared(rig, owner);
    expect(await rig.service.assertSharedAuthorized?.({ serverId: "srv" })).toBe(true);
  });
  it("refuses a token when the credential was re-signed-in between reading its connection and its record", async () => {
    const { owner, rig } = sharedRig();
    const credentialId = await connectShared(rig, owner);
    const readConnection = owner.shared.owner.readConnection;
    Object.assign(owner.shared.owner, { readConnection: async (input: { credentialId: string }) => {
      const connection = await readConnection(input);
      const record = owner.records.get(credentialId)!;
      owner.records.set(credentialId, { ...record, generation: record.generation + 2, revision: record.revision + 1 });
      return connection;
    } });
    await expect(rig.service.tokenResolver.resolveSharedAccessToken?.({ serverId: "srv" })).rejects.toThrow("shared-unavailable");
  });
});
