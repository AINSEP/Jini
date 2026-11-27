import { describe, expect, it } from "vitest";
import { selfConfigureConnection } from "../sign-in-configuration.js";
import { discovery, FakeRepo, makeHarness, makeRecord, NOW_ISO, sealed } from "./sign-in-harness.js";

const CB = "https://h.test/cb";
const secretClient = { clientId: "c-new", clientSecret: "pw-new", tokenEndpointAuthMethod: "client_secret_post" };
const publicClient = { clientId: "c-pub", clientSecret: null, tokenEndpointAuthMethod: "none" };

function harness(record = makeRecord(), minted: object = secretClient, discovered = discovery()) {
  return makeHarness(new FakeRepo(record), { flow: { discoverAuthorizationServer: async () => discovered, registerOAuthClientDynamically: async () => minted } });
}

describe("selfConfigureConnection: nothing to do", () => {
  it("returns a fully configured row untouched with zero outbound calls", async () => {
    const row = makeRecord({ oauthProviderId: "p", oauthGrant: "authorization_code", oauthClientId: "c1" });
    const h = harness(row);
    await expect(selfConfigureConnection({ deps: h.deps, record: row, redirectUri: CB })).resolves.toBe(row);
    expect([h.flowCalls, h.repo.ifVersionCalls]).toEqual([[], []]);
  });
});

describe("selfConfigureConnection: discover and register", () => {
  it("discovers, resolves the grant, registers a client and persists it one version up", async () => {
    const row = makeRecord({ sealedOAuth: sealed({ tokens: { accessToken: "at" } as never }) });
    const h = harness(row);
    const result = await selfConfigureConnection({ deps: h.deps, record: row, redirectUri: CB });
    expect(h.flowCalls.map(c => c.name)).toEqual(["discoverAuthorizationServer", "registerOAuthClientDynamically"]);
    expect(h.seals).toEqual([{ clientSecret: "pw-new", tokens: { accessToken: "at" } }]);
    expect(result).toEqual({ ...row, oauthGrant: "authorization_code", oauthClientId: "c-new", oauthScopesJson: '["offline_access"]',
      oauthEndpointsJson: JSON.stringify({ issuer: "https://as.test", tokenEndpoint: "https://as.test/token", authorizationEndpoint: "https://as.test/auth", clientAuth: "client_secret_post", dynamicClientId: "c-new", registeredRedirectUri: CB }),
      sealedOAuth: sealed({ clientSecret: "pw-new", tokens: { accessToken: "at" } as never }), oauthAadVersion: 9, updatedAt: NOW_ISO, version: 4 });
    expect(h.repo.rows.get("srv")).toEqual(result);
  });

  it("mints a public device client without inheriting the old secret, clientAuth or a callback", async () => {
    const row = makeRecord({ sealedOAuth: sealed({ clientSecret: "pw-old" }) });
    const h = harness(row, publicClient, discovery({ grantTypesSupported: ["urn:ietf:params:oauth:grant-type:device_code"], authorizationEndpoint: null }));
    const result = await selfConfigureConnection({ deps: h.deps, record: row, redirectUri: undefined });
    expect(h.seals).toEqual([{}]);
    expect(result.oauthGrant).toBe("device_code");
    expect(JSON.parse(result.oauthEndpointsJson ?? "")).toEqual({ issuer: "https://as.test", tokenEndpoint: "https://as.test/token", dynamicClientId: "c-pub" });
  });

  it("replaces a self-registered client pinned to a different callback", async () => {
    const row = makeRecord({ oauthGrant: "authorization_code", oauthClientId: "c-old", oauthScopesJson: '["mine"]',
      oauthEndpointsJson: JSON.stringify({ tokenEndpoint: "https://typed.test/token", dynamicClientId: "c-old", registeredRedirectUri: "https://old.test/cb", resource: "https://typed.test/res" }) });
    const h = harness(row);
    const result = await selfConfigureConnection({ deps: h.deps, record: row, redirectUri: CB });
    expect(result.oauthClientId).toBe("c-new");
    expect(result.oauthScopesJson).toBe('["mine"]');
    // Typed endpoints win over discovered ones; the stored resource survives a discovery without one.
    expect(JSON.parse(result.oauthEndpointsJson ?? "")).toEqual({ issuer: "https://as.test", tokenEndpoint: "https://typed.test/token", authorizationEndpoint: "https://as.test/auth",
      resource: "https://typed.test/res", clientAuth: "client_secret_post", dynamicClientId: "c-new", registeredRedirectUri: CB });
  });
});

describe("selfConfigureConnection: keep the client", () => {
  it("keeps an operator client and its sealed secret, resolving only the grant and the discovered resource", async () => {
    const row = makeRecord({ oauthProviderId: "p", oauthClientId: "c1", sealedOAuth: sealed({ clientSecret: "pw-1" }), oauthEndpointsJson: JSON.stringify({ resource: "https://old.test/res" }) });
    const h = harness(row, secretClient, { ...discovery({ grantTypesSupported: ["urn:ietf:params:oauth:grant-type:device_code"] }), resource: "https://mcp.test/res" } as ReturnType<typeof discovery>);
    const result = await selfConfigureConnection({ deps: h.deps, record: row, redirectUri: CB });
    expect(h.flowCalls.map(c => c.name)).toEqual(["discoverAuthorizationServer"]);
    expect(h.seals).toEqual([{ clientSecret: "pw-1" }]);
    expect([result.oauthClientId, result.oauthGrant, JSON.parse(result.oauthEndpointsJson ?? "").resource]).toEqual(["c1", "device_code", "https://mcp.test/res"]);
  });

  it("builds without writing when configurationOnly is set", async () => {
    const row = makeRecord({ oauthProviderId: "p", oauthClientId: "c1" });
    const h = harness(row);
    const result = await selfConfigureConnection({ deps: h.deps, record: row, redirectUri: CB, options: { configurationOnly: true } });
    expect([result.oauthGrant, result.version, h.repo.ifVersionCalls.length]).toEqual(["authorization_code", 3, 0]);
  });

  it("re-reads through requireOAuthRecord when the row vanished before the write", async () => {
    const row = makeRecord({ oauthProviderId: "p", oauthClientId: "c1" });
    const h = harness(row);
    h.repo.rows.clear();
    await expect(selfConfigureConnection({ deps: h.deps, record: row, redirectUri: CB })).rejects.toThrow("validation(id): no external MCP server is configured as 'srv'");
  });
});
