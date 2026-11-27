import { describe, expect, it } from "vitest";
import type { OAuthProviderDescriptor } from "@jini-ai/core/contracts/oauth";
import {
  isSelfRegisteredClient, isStaleSelfRegisteredClient, noOAuthProviderError, oauthClientOptions, readStoredEndpoints,
  readStoredScopes, requireOAuthRecord, resolveClient, resolveProviderDescriptor, withoutSelfRegisteredClient,
  type ExternalMcpOAuthServiceDeps,
} from "../sign-in-provider.js";
import { FakeOAuthError, FakeRepo, makeHarness, makeRecord, sealed } from "./sign-in-harness.js";

const provider = (clientAuth: string) => ({ clientAuth }) as unknown as OAuthProviderDescriptor;
const built = { flow: { buildOperatorOAuthProvider: (...args: never[]) => ({ built: args }) } };

describe("oauthClientOptions / noOAuthProviderError", () => {
  it("registers exactly the given callback, or none", () => {
    const { deps } = makeHarness(new FakeRepo());
    expect(oauthClientOptions(deps.ports, makeRecord(), "https://h.test/cb")).toEqual({ clientDisplayName: "client for Server", softwareId: "sw-id", redirectUris: ["https://h.test/cb"] });
    expect(oauthClientOptions(deps.ports, makeRecord({ label: null }), undefined)).toEqual({ clientDisplayName: "client for srv", softwareId: "sw-id", redirectUris: [] });
  });
  it("names the server and the no-provider action", () => {
    const { deps } = makeHarness(new FakeRepo());
    const error = noOAuthProviderError({ ports: deps.ports, serverId: "x" }) as FakeOAuthError;
    expect([error.code, error.message, error.operatorAction]).toEqual(["OAUTH_INVALID_REQUEST", "external MCP server 'x' names no OAuth provider and defines no token endpoint", "act-provider"]);
  });
});

describe("requireOAuthRecord", () => {
  it("returns an oauth row", async () => {
    const row = makeRecord();
    const { deps } = makeHarness(new FakeRepo(row));
    await expect(requireOAuthRecord(deps, "srv")).resolves.toBe(row);
  });
  it("refuses a missing row and a non-oauth row", async () => {
    const { deps } = makeHarness(new FakeRepo(makeRecord({ serverId: "env", authMode: "static_env" })));
    await expect(requireOAuthRecord(deps, "nope")).rejects.toThrow("validation(id): no external MCP server is configured as 'nope'");
    await expect(requireOAuthRecord(deps, "env")).rejects.toThrow("validation(authMode): external MCP server 'env' is not configured to use OAuth");
  });
});

describe("readStoredEndpoints / readStoredScopes", () => {
  it("reads an object and falls back to {} for null, array, JSON null and garbage", () => {
    expect(readStoredEndpoints(makeRecord({ oauthEndpointsJson: '{"tokenEndpoint":"t"}' }))).toEqual({ tokenEndpoint: "t" });
    for (const json of [null, "[1]", "null", "{bad"]) expect(readStoredEndpoints(makeRecord({ oauthEndpointsJson: json }))).toEqual({});
  });
  it("keeps only string scopes and falls back to [] for null, non-array and garbage", () => {
    expect(readStoredScopes(makeRecord({ oauthScopesJson: '["a",2,"b"]' }))).toEqual(["a", "b"]);
    for (const json of [null, '{"a":1}', "[bad"]) expect(readStoredScopes(makeRecord({ oauthScopesJson: json }))).toEqual([]);
  });
});

describe("resolveProviderDescriptor", () => {
  it("builds a connection-owned provider from a stored token endpoint with every optional field", () => {
    const h = makeHarness(new FakeRepo(), built);
    const record = makeRecord({ label: null, oauthScopesJson: '["s1"]', oauthEndpointsJson: JSON.stringify({ tokenEndpoint: "https://a.test/token", authorizationEndpoint: "https://a.test/auth", deviceAuthorizationEndpoint: "https://a.test/device", clientAuth: "client_secret_post" }) });
    expect(resolveProviderDescriptor(h.deps as ExternalMcpOAuthServiceDeps, record)).toEqual({ built: [
      { guard: { tag: "guard" }, providerId: "connection-srv", label: "srv", tokenEndpoint: "https://a.test/token" },
      { authorizationEndpoint: "https://a.test/auth", deviceAuthorizationEndpoint: "https://a.test/device", scopes: ["s1"], clientAuth: "client_secret_post" },
    ] });
  });
  it("omits absent endpoints and an unrecognised clientAuth, and keeps a named provider id and label", () => {
    const h = makeHarness(new FakeRepo(), built);
    const record = makeRecord({ oauthProviderId: "p1", oauthEndpointsJson: JSON.stringify({ tokenEndpoint: "https://a.test/token", clientAuth: "bogus" }) });
    expect(resolveProviderDescriptor(h.deps as ExternalMcpOAuthServiceDeps, record)).toEqual({ built: [
      { guard: { tag: "guard" }, providerId: "p1", label: "Server", tokenEndpoint: "https://a.test/token" }, { scopes: [] },
    ] });
  });
  it("refuses a row with neither a token endpoint nor a provider id", () => {
    const h = makeHarness(new FakeRepo());
    expect(() => resolveProviderDescriptor(h.deps as ExternalMcpOAuthServiceDeps, makeRecord())).toThrow("external MCP server 'srv' names no OAuth provider and defines no token endpoint");
  });
  it("prefers an injected lookupProvider, else the registry", () => {
    const looked: string[] = [];
    const viaLookup = makeHarness(new FakeRepo(), { extra: { lookupProvider: id => { looked.push(id); return provider("lookup"); } } });
    expect(resolveProviderDescriptor(viaLookup.deps as ExternalMcpOAuthServiceDeps, makeRecord({ oauthProviderId: "p1" }))).toEqual({ clientAuth: "lookup" });
    expect(looked).toEqual(["p1"]);
    const asked: unknown[] = [];
    const registry = makeHarness(new FakeRepo());
    const deps = { ...registry.deps, providers: { get: (q: unknown) => { asked.push(q); return provider("registry"); } } } as unknown as ExternalMcpOAuthServiceDeps;
    expect(resolveProviderDescriptor(deps, makeRecord({ oauthProviderId: "p2" }))).toEqual({ clientAuth: "registry" });
    expect(asked).toEqual([{ providerId: "p2" }]);
  });
});

describe("resolveClient", () => {
  it("refuses a row with no client id", async () => {
    const { deps } = makeHarness(new FakeRepo());
    await expect(resolveClient(deps, makeRecord(), provider("none"))).rejects.toMatchObject({ code: "OAUTH_INVALID_REQUEST", message: "external MCP server 'srv' has no OAuth client id", operatorAction: "act-client" });
  });
  it("includes the sealed secret only when there is one", async () => {
    const { deps } = makeHarness(new FakeRepo());
    await expect(resolveClient(deps, makeRecord({ oauthClientId: "c1", sealedOAuth: sealed({ clientSecret: "pw-1" }) }), provider("client_secret_basic"))).resolves.toEqual({ clientId: "c1", clientSecret: "pw-1", authMethod: "client_secret_basic" });
    await expect(resolveClient(deps, makeRecord({ oauthClientId: "c1" }), provider("none"))).resolves.toEqual({ clientId: "c1", authMethod: "none" });
  });
});

describe("self-registered client marks", () => {
  it("isSelfRegisteredClient follows dynamicClientId, then clientAuth", () => {
    expect(isSelfRegisteredClient(makeRecord(), { dynamicClientId: "c1" })).toBe(false);
    expect(isSelfRegisteredClient(makeRecord({ oauthClientId: "c1" }), { dynamicClientId: "c1" })).toBe(true);
    expect(isSelfRegisteredClient(makeRecord({ oauthClientId: "c1" }), { dynamicClientId: "c2", clientAuth: "none" })).toBe(false);
    expect(isSelfRegisteredClient(makeRecord({ oauthClientId: "c1" }), { clientAuth: "none" })).toBe(true);
    expect(isSelfRegisteredClient(makeRecord({ oauthClientId: "c1" }), {})).toBe(false);
  });
  it("isStaleSelfRegisteredClient is true only for a self-registered client pinned to another callback", () => {
    const record = makeRecord({ oauthClientId: "c1" });
    const endpoints = { dynamicClientId: "c1", registeredRedirectUri: "https://old.test/cb" };
    expect(isStaleSelfRegisteredClient({ record, endpoints, redirectUri: "https://new.test/cb" })).toBe(true);
    expect(isStaleSelfRegisteredClient({ record, endpoints, redirectUri: "https://old.test/cb" })).toBe(false);
    expect(isStaleSelfRegisteredClient({ record, endpoints, redirectUri: undefined })).toBe(false);
    expect(isStaleSelfRegisteredClient({ record: makeRecord({ oauthClientId: "c1", oauthGrant: "device_code" }), endpoints, redirectUri: "https://new.test/cb" })).toBe(false);
    expect(isStaleSelfRegisteredClient({ record, endpoints: {}, redirectUri: "https://new.test/cb" })).toBe(false);
  });
  it("withoutSelfRegisteredClient drops only the client marks and leaves the input untouched", () => {
    const input = { tokenEndpoint: "t", clientAuth: "none", dynamicClientId: "c1", registeredRedirectUri: "r" };
    expect(withoutSelfRegisteredClient(input)).toEqual({ tokenEndpoint: "t" });
    expect(input.dynamicClientId).toBe("c1");
  });
});
