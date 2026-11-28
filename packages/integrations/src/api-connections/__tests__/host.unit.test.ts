import { describe, expect, it, vi } from "vitest";
import { createApiConnectionHost } from "../host.js";
import { ApiConnectionError } from "../errors.js";
import { deriveApiConnectionKey } from "../keys.js";
import type { ApiConnectionRuntimeHostDeps, DeclaredApiConnection } from "../host-ports.js";
import type { ApiConnectionRecord } from "../types.js";
import { memoryRecordStore } from "./fixtures/harness.js";
import { realOAuthCapabilities } from "./fixtures/real-capabilities.js";

const REF = deriveApiConnectionKey({ workspaceId: "ws-1", pluginId: "plug", connectionId: "acct" });

function declared(over: Record<string, unknown> = {}): DeclaredApiConnection {
  return { pluginId: "plug", apiOrigins: ["https://api.test"], budgets: [], scopeSets: [], byoClient: false,
    descriptor: { pluginId: "plug", connectionId: "acct", label: "Acct", tokenEndpoint: "https://idp.test/token", authorizationEndpoint: "https://idp.test/auth", callbackFields: [] },
    clients: { web: { clientIdEnv: "WEB_ID", clientSecretEnv: "WEB_SECRET", redirectOrigins: ["https://site.test"] }, desktop: { clientIdEnv: "DESK_ID" } },
    module: { createHooks: () => ({ resolveScopes: async ({ scopeSetIds }: { scopeSetIds: string[] }) => ["base", ...scopeSetIds] }) },
    ...over } as unknown as DeclaredApiConnection;
}

class TokenStoreError extends Error { constructor(readonly code: string) { super(code); this.name = "OAuthTokenStoreError"; } }

interface Opts { runtime?: "hosted" | "desktop"; env?: Record<string, string>; origin?: string; connections?: DeclaredApiConnection[]; load?: () => Promise<unknown>; byo?: unknown; shared?: Record<string, unknown>; storage?: Record<string, unknown>; oauth?: unknown }

function build(o: Opts = {}) {
  const records = memoryRecordStore();
  const sharedCalls: unknown[] = [];
  const deps = {
    workspaceId: "ws-1", runtime: o.runtime ?? "hosted", clock: { nowMs: () => Date.UTC(2026, 0, 1) },
    env: o.env ?? { WEB_ID: " web-client ", WEB_SECRET: "pw-1", DESK_ID: "desk-client", ORIGINS: "https://extra.test/x, not a url" },
    publicOrigin: () => o.origin ?? "https://site.test", callbackPath: "/cb", appIdentity: { clientDisplayName: "App", softwareId: "sw" },
    messages: { callbackOriginsEnv: "ORIGINS", notConfigured: ({ label, runtime, what }: Record<string, string>) => `${label}/${runtime}: no ${what}`,
      missingReturnAddress: ({ label }: { label: string }) => `${label}: no return address`, unregisteredOrigin: ({ label }: { label: string }) => `${label}: origin not registered`,
      noPublicOrigin: ({ label }: { label: string }) => `${label}: no public origin` },
    loadDeclaredConnections: async () => ({ connections: o.connections ?? [declared()], refusals: [] }),
    byoCredentials: { read: async () => o.byo ?? null, refuse: async () => new ApiConnectionError({ code: "descriptor-invalid", message: "byo refused" }) },
    apiConnectionStorage: { records, tokensFor: () => ({ load: o.load ?? (async () => null) }) },
    createLimiter: () => ({ check: async () => ({ allowed: true }) }),
    createSharedConnections: (input: unknown) => { sharedCalls.push(input); return o.shared; },
    oauthHttp: {}, oauth: o.oauth ?? realOAuthCapabilities, pluginHttp: {}, pluginState: { s: 1 }, callbackInbox: {}, startLoopback: async () => ({}),
  } as unknown as ApiConnectionRuntimeHostDeps<unknown>;
  const host = createApiConnectionHost(deps, o.shared ? { shared: (o.storage ?? { readContext: async () => null }) as never } : {});
  return { host, records, sharedCalls };
}

async function seed(records: ReturnType<typeof memoryRecordStore>, over: Partial<ApiConnectionRecord> = {}) {
  await records.compareAndSet({ key: REF, expectedRevision: 0, record: { key: REF, workspaceId: "ws-1", pluginId: "plug", connectionId: "acct", status: "connected", revision: 1, generation: 1,
    account: { accountId: "a1", displayName: "Ann" }, grantedScopes: ["base"], staged: null, revocationFailure: null, updatedAt: "2025-01-01T00:00:00.000Z", ...over } });
}

describe("host: declared connections", () => {
  it("lists by plugin, reports API origins only for its own workspace, and resolves scopes through hooks", async () => {
    const other = declared({ pluginId: "other" });
    const { host } = build({ connections: [declared(), other] });
    expect(await host.listConnections({ pluginId: "other" })).toEqual([other]);
    expect(await host.listConnections()).toHaveLength(2);
    expect(await host.apiOriginsFor({ workspaceId: "ws-2", pluginId: "plug" })).toEqual([]);
    expect(await host.apiOriginsFor({ workspaceId: "ws-1", pluginId: "plug" })).toEqual(["https://api.test"]);
    expect(await host.requestedScopes({ connection: declared(), scopeSetIds: ["x"] })).toEqual(["base", "x"]);
    expect(await host.declaredFor({ pluginId: "plug", connectionRef: "nope" })).toBeUndefined();
    expect([host.sharingAvailable, host.workspaceId, host.runtime]).toEqual([false, "ws-1", "hosted"]);
  });
});

describe("host: hosted callback address", () => {
  it("accepts a declared or configured origin and refuses the rest", () => {
    expect(build().host.hostedCallbackUrl({ connection: declared() })).toBe("https://site.test/cb");
    expect(build({ origin: "https://extra.test" }).host.hostedCallbackUrl({ connection: declared() })).toBe("https://extra.test/cb");
    expect(() => build({ origin: "https://evil.test" }).host.hostedCallbackUrl({ connection: declared() })).toThrow("Acct: origin not registered");
    expect(() => build({ env: {} }).host.hostedCallbackUrl({ connection: declared({ clients: {} }) })).toThrow("Acct: no return address");
  });
  it("uses the site's own origin for a BYO client, and refuses when there is none", async () => {
    const byo = { allowedOrigins: () => ["https://idp.test"], connection: { username: "byo-id", token: "pw-b" } };
    const ok = build({ byo, origin: "https://anything.test", connections: [declared({ byoClient: true })] });
    const [connection] = await ok.host.listConnections();
    expect(ok.host.hostedCallbackUrl({ connection: connection! })).toBe("https://anything.test/cb");
    const none = build({ byo, origin: "", connections: [declared({ byoClient: true })] });
    const [c2] = await none.host.listConnections();
    expect(() => none.host.hostedCallbackUrl({ connection: c2! })).toThrow("Acct: no public origin");
  });
});

describe("host: sign-in client resolution", () => {
  it("refuses a missing client id or a missing confidential secret, and a refused BYO client", async () => {
    expect(() => build({ env: {} }).host.serviceFor({ connection: declared() })).toThrow("Acct/hosted: no sign-in client");
    expect(() => build({ env: { WEB_ID: "id" } }).host.serviceFor({ connection: declared() })).toThrow("Acct/hosted: no sign-in client secret");
    const refused = build({ byo: { allowedOrigins: () => [], connection: {} }, connections: [declared({ byoClient: true })] });
    const [connection] = await refused.host.listConnections();
    expect(() => refused.host.serviceFor({ connection: connection! })).toThrow("byo refused");
  });
  it("builds a desktop public service without a secret", () => {
    const service = build({ runtime: "desktop" }).host.serviceFor({ connection: declared() });
    expect(typeof service.start).toBe("function");
  });
});

describe("host: honest status", () => {
  it("reports disconnected without a record and the stored state with one", async () => {
    const { host, records } = build();
    expect(await host.statusOf({ connection: declared() })).toEqual({ connectionRef: REF, status: "disconnected", grantedScopes: [] });
    await seed(records);
    expect(await host.statusOf({ connection: declared() })).toEqual({ connectionRef: REF, status: "connected", grantedScopes: ["base"] });
  });
  it("marks a connection whose tokens belong to another client as reconnect-required", async () => {
    const { host, records } = build({ load: async () => { throw new TokenStoreError("owner-mismatch"); } });
    await seed(records);
    expect((await host.statusOf({ connection: declared() })).status).toBe("reconnect-required");
    expect(await records.read({ key: REF })).toMatchObject({ status: "reconnect-required", revision: 2, updatedAt: "2026-01-01T00:00:00.000Z" });
  });
  it("rethrows an unrelated token-store failure and trusts a row it cannot check", async () => {
    const broken = build({ load: async () => { throw new Error("db down"); } });
    await seed(broken.records);
    await expect(broken.host.records.read({ key: REF })).rejects.toThrow("db down");
    const unconfigured = build({ env: {}, load: async () => { throw new TokenStoreError("invalid-record"); } });
    await seed(unconfigured.records);
    expect((await unconfigured.host.records.read({ key: REF }))?.status).toBe("connected");
  });
});

describe("host: honest status leaves rows it need not check", () => {
  it("never opens tokens for a row that is not connected or whose connection is no longer declared", async () => {
    let loads = 0;
    const load = async () => { loads++; throw new TokenStoreError("owner-mismatch"); };
    const pending = build({ load });
    await seed(pending.records, { status: "revocation-pending" });
    expect(await pending.host.records.read({ key: REF })).toMatchObject({ status: "revocation-pending", revision: 1 });
    const undeclared = build({ load, connections: [declared({ pluginId: "other" })] });
    await seed(undeclared.records);
    expect(await undeclared.host.records.read({ key: REF })).toMatchObject({ status: "connected", revision: 1 });
    expect(loads).toBe(0);
  });

  it("when another writer wins the race to mark the row, the read returns what won", async () => {
    let records: ReturnType<typeof memoryRecordStore> | undefined;
    const built = build({ load: async () => {
      const current = await records!.read({ key: REF });
      await records!.compareAndSet({ key: REF, expectedRevision: 1, record: { ...current!, status: "disconnected", revision: 2, generation: 2 } });
      throw new TokenStoreError("owner-mismatch");
    } });
    records = built.records;
    await seed(records);
    expect(await built.host.records.read({ key: REF })).toMatchObject({ status: "disconnected", revision: 2, generation: 2 });
    expect(await records.read({ key: REF })).toMatchObject({ status: "disconnected", revision: 2 });
  });
});

describe("host: tool connections", () => {
  it("reads the connected account only for its own workspace and declared connections", async () => {
    const { host, records } = build();
    const target = { workspaceId: "ws-1", pluginId: "plug", connectionRef: REF };
    expect(await host.toolConnections.readAccount(target)).toBeNull();
    await seed(records);
    expect(await host.toolConnections.readAccount(target)).toEqual({ accountId: "a1", displayName: "Ann" });
    expect(await host.toolConnections.readAccount({ ...target, workspaceId: "ws-2" })).toBeNull();
    expect(await host.toolConnections.readAccount({ ...target, connectionRef: "x" })).toBeNull();
  });
  it("refuses tokens for another workspace or an undeclared connection", async () => {
    const { host } = build();
    await expect(host.toolConnections.getAccessToken({ workspaceId: "ws-2", pluginId: "plug", connectionRef: REF })).rejects.toThrow("This connection is not available to this plugin here.");
    await expect(host.accessTokensFor({ pluginId: "plug" }).getAccessToken({ connectionRef: "x" })).rejects.toMatchObject({ code: "connection-not-found" });
  });
});

describe("host: shared connections (desktop)", () => {
  it("routes status, account and tokens to a bound shared connection", async () => {
    const shared = { hasBinding: async () => true, getStatus: async () => ({ status: "connected", grantedScopes: ["s"] }), readAccount: async () => ({ accountId: "sh" }), getAccessToken: async () => "tok-a" };
    const { host, sharedCalls } = build({ runtime: "desktop", shared });
    expect(host.sharingAvailable).toBe(true);
    expect(sharedCalls).toHaveLength(1);
    const target = { workspaceId: "ws-1", pluginId: "plug", connectionRef: REF };
    expect(await host.statusOf({ connection: declared() })).toEqual({ connectionRef: REF, status: "connected", grantedScopes: ["s"] });
    expect(await host.toolConnections.readAccount(target)).toEqual({ accountId: "sh" });
    expect(await host.toolConnections.getAccessToken(target)).toBe("tok-a");
  });
  it("refuses a shared sign-in when sharing is unavailable", async () => {
    await expect(build().host.prepareSignIn({ connection: declared(), actorId: "a", destination: "shared" })).rejects.toMatchObject({ code: "connection-not-found" });
  });
});

describe("host: randomness and waiting it hands each service it builds", () => {
  const LOOPBACK = "http://127.0.0.1:5555/cb";
  type Sleep = (input: { ms: number }) => Promise<void>;
  type Started = { attemptId: string; browserBinding: string };
  type Service = { start: (input: unknown) => Promise<Started> };
  /** The host's real assembly, with an OAuth port that records what each service hands it. */
  function rig() {
    const refresherDeps: { sleep: Sleep }[] = [];
    const begun: { randomBytesFn: unknown }[] = [];
    const oauth = { ...realOAuthCapabilities, flow: { ...realOAuthCapabilities.flow,
      createTokenRefresher: (deps: { sleep: Sleep }) => { refresherDeps.push(deps); return { getAccessToken: async () => "tok-a" }; },
      beginAuthorizationCode: async (input: { randomBytesFn: unknown }) => { begun.push(input); return { authorizationUrl: "https://idp.test/auth?x=1", state: "st-a", expiresAt: "2026-01-01T00:10:00.000Z" }; } } };
    const storage = { readContext: async () => null, records: memoryRecordStore(), tokensFor: () => ({}) };
    const descriptor = { ...declared().descriptor, startParams: [], authorizationParams: { public: {}, confidential: {} }, forceConsentParams: {} };
    const connection = declared({ descriptor });
    const { host, sharedCalls } = build({ runtime: "desktop", connections: [connection], shared: { hasBinding: async () => false }, storage, oauth });
    const { createService } = sharedCalls[0] as { createService: (input: unknown) => Service };
    const services: Record<"shared" | "site", () => Service> = {
      shared: () => createService({ connection, redirectUri: LOOPBACK, context: { descriptor, client: { clientId: "desk-client", authMethod: "none" }, clientKind: "public" } }),
      site: () => host.serviceFor({ connection, redirectUri: LOOPBACK }) as unknown as Service,
    };
    return { host, services, refresherDeps, begun };
  }
  for (const kind of ["shared", "site"] as const) {
    it(`gives the ${kind} service real random bytes of the requested length for each OAuth start`, async () => {
      const { services, begun } = rig();
      const service = services[kind]();
      const start = () => service.start({ workspaceId: "ws-1", actorId: "a1", intent: "connect", scopeSetIds: [], redirectUri: LOOPBACK });
      const first = await start();
      const second = await start();
      expect([Buffer.from(first.attemptId, "base64url").length, Buffer.from(first.browserBinding, "base64url").length]).toEqual([16, 32]);
      expect(new Set([first.attemptId, second.attemptId, first.browserBinding, second.browserBinding]).size).toBe(4);
      expect(begun).toHaveLength(2);
      const bytes = (begun[0]?.randomBytesFn as (input: { byteLength: number }) => Uint8Array)({ byteLength: 7 });
      expect(bytes.length).toBe(7);
    });
    it(`gives the ${kind} service's token refresher a sleep that waits the asked-for time`, async () => {
      const { services, refresherDeps } = rig();
      services[kind]();
      expect(refresherDeps).toHaveLength(1);
      vi.useFakeTimers();
      try {
        let woke = false;
        const slept = refresherDeps[0]!.sleep({ ms: 250 }).then(() => { woke = true; });
        await vi.advanceTimersByTimeAsync(249);
        expect(woke).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await slept;
        expect(woke).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  }
  it("issues distinct 32-byte sign-in handoff ids, each redeemable once by its starter", () => {
    const { host } = rig();
    const handoff = { authorizationUrl: "https://idp.test/auth?x=1", browserBinding: "bb-a", actorId: "a1", expiresAt: "2026-01-01T00:10:00.000Z" };
    const first = host.signInHandoffs.issue(handoff);
    const second = host.signInHandoffs.issue({ ...handoff, actorId: "a2" });
    expect(Buffer.from(first, "base64url").length).toBe(32);
    expect(first).not.toBe(second);
    expect(host.signInHandoffs.take({ handoffId: first, actorId: "a1" })).toEqual(handoff);
    expect(host.signInHandoffs.take({ handoffId: first, actorId: "a1" })).toBeNull();
  });
});

describe("host: access tokens through the site service", () => {
  it("turns an unreadable token record into reconnect-required and marks the row", async () => {
    const { host, records } = build({ load: async () => { throw new TokenStoreError("invalid-record"); } });
    await seed(records);
    const error = await host.accessTokensFor({ pluginId: "plug" }).getAccessToken({ connectionRef: REF }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "reconnect-required", message: "This connection's sign-in client changed, so its stored sign-in can no longer be used. Reconnect the account in the connection settings." });
    expect((await records.read({ key: REF }))?.status).toBe("reconnect-required");
  });
  it("passes any other service failure through unchanged", async () => {
    const { host } = build();
    const error = await host.accessTokensFor({ pluginId: "plug" }).getAccessToken({ connectionRef: REF }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiConnectionError);
    expect((error as ApiConnectionError).code).not.toBe("reconnect-required");
  });
});

describe("host: preparing sign-ins", () => {
  const sharedWith = (prepared: unknown[], selected: unknown[]) => ({ hasBinding: async () => false, selectLocal: async (c: unknown) => { selected.push(c); }, prepare: async (input: unknown) => { prepared.push(input); return "prepared"; } });

  it("prepares a site sign-in that selects the local copy when it completes", async () => {
    const selected: unknown[] = [];
    const { host } = build({ runtime: "desktop", shared: sharedWith([], selected) });
    const [connection] = await host.listConnections();
    const target = await host.prepareSignIn({ connection: connection!, actorId: "a", destination: "site" });
    expect(target.workspaceId).toBe("ws-1");
    await target.onCompleted();
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(connection);
  });
  it("reuses a stored shared context, else builds one from the resolved BYO client", async () => {
    const prepared: unknown[] = [];
    const reuse = build({ runtime: "desktop", shared: sharedWith(prepared, []), storage: { readContext: async () => ({ credentialId: "c" }) } });
    const [reused] = await reuse.host.listConnections();
    expect(await reuse.host.prepareSignIn({ connection: reused!, actorId: "a", destination: "shared" })).toBe("prepared");
    expect(prepared[0]).toEqual({ connection: reused, actorId: "a", destination: "shared", context: { credentialId: "c" } });
    const byo = { allowedOrigins: () => ["https://idp.test"], connection: { username: "byo-id", token: "pw-b" } };
    const fresh = build({ runtime: "desktop", byo, connections: [declared({ byoClient: true })], shared: sharedWith(prepared, []) });
    const [connection] = await fresh.host.listConnections();
    await fresh.host.prepareSignIn({ connection: connection!, actorId: "a", destination: "shared" });
    expect((prepared[1] as { context: unknown }).context).toEqual({
      credentialId: deriveApiConnectionKey({ workspaceId: "project", pluginId: "plug", connectionId: "acct" }),
      client: { clientId: "byo-id", clientSecret: "pw-b", authMethod: "client_secret_post" }, clientKind: "public", descriptor: connection!.descriptor,
      identity: { pluginId: "plug", connectionId: "acct", tokenEndpoint: "https://idp.test/token", authorizationEndpoint: "https://idp.test/auth", clientId: "byo-id" } });
  });
  it("hands the shared factory a service builder over the shared storage", async () => {
    const tokensAsked: unknown[] = [];
    const storage = { readContext: async () => null, records: memoryRecordStore(), tokensFor: (input: unknown) => { tokensAsked.push(input); return { load: async () => null }; } };
    const { sharedCalls } = build({ runtime: "desktop", shared: sharedWith([], []), storage });
    const factory = sharedCalls[0] as { createService: (i: unknown) => { start: unknown }; listConnections: (i: unknown) => Promise<unknown[]>; requestedScopes: (i: unknown) => Promise<unknown> };
    const context = { descriptor: declared().descriptor, client: { clientId: "c", authMethod: "none" }, clientKind: "public" };
    expect(typeof factory.createService({ connection: declared(), context, redirectUri: "http://127.0.0.1:1/cb" }).start).toBe("function");
    expect(typeof factory.createService({ connection: declared(), context, redirectUri: undefined }).start).toBe("function");
    expect(tokensAsked).toEqual([{ context }, { context }]);
    expect(await factory.listConnections({})).toHaveLength(1);
    expect(await factory.requestedScopes({ connection: declared(), scopeSetIds: [] })).toEqual(["base"]);
  });
});
