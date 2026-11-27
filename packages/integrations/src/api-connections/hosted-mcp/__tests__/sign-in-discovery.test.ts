import { describe, expect, it } from "vitest";
import { discoverConnectionAuthorizationServer, mintClientForConnection, needsEndpointDiscovery, resolveGrantFromDiscovery, toStoredEndpoints } from "../sign-in-discovery.js";
import { discovery, FakeRepo, makeHarness, makeRecord } from "./sign-in-harness.js";


describe("needsEndpointDiscovery / toStoredEndpoints", () => {
  it("discovers only when neither a token endpoint nor a provider is named", () => {
    expect(needsEndpointDiscovery(makeRecord(), {})).toBe(true);
    expect(needsEndpointDiscovery(makeRecord(), { tokenEndpoint: "t" })).toBe(false);
    expect(needsEndpointDiscovery(makeRecord({ oauthProviderId: "p" }), {})).toBe(false);
  });
  it("stores every advertised endpoint and the resource, omitting the absent ones", () => {
    expect(toStoredEndpoints({ ...discovery({ deviceAuthorizationEndpoint: "https://as.test/device" }), resource: "https://mcp.test" })).toEqual({
      issuer: "https://as.test", tokenEndpoint: "https://as.test/token", resource: "https://mcp.test", authorizationEndpoint: "https://as.test/auth", deviceAuthorizationEndpoint: "https://as.test/device" });
    expect(toStoredEndpoints(discovery({ authorizationEndpoint: null }))).toEqual({ issuer: "https://as.test", tokenEndpoint: "https://as.test/token" });
  });
});

describe("discoverConnectionAuthorizationServer", () => {
  it("refuses a row with no resource URL", async () => {
    const h = makeHarness(new FakeRepo());
    await expect(discoverConnectionAuthorizationServer(h.deps, makeRecord({ url: null }))).rejects.toMatchObject({ code: "OAUTH_INVALID_REQUEST", operatorAction: "act-provider" });
    expect(h.flowCalls).toEqual([]);
  });
  it("asks the flow with the guarded transport, a 10s timeout and the host's metadata policy", async () => {
    const h = makeHarness(new FakeRepo(), { flow: { discoverAuthorizationServer: async () => discovery() } });
    await expect(discoverConnectionAuthorizationServer(h.deps, makeRecord())).resolves.toEqual(discovery());
    expect(h.flowCalls).toEqual([{ name: "discoverAuthorizationServer", args: [
      { guard: { tag: "guard" }, resourceUrl: "https://mcp.example.test/mcp" }, { timeoutMs: 10_000, metadataPolicy: { policyFor: { tag: "guard" } } }] }]);
  });
});

describe("resolveGrantFromDiscovery", () => {
  const ports = makeHarness(new FakeRepo()).deps.ports;
  it("prefers authorization_code, then device_code", () => {
    expect(resolveGrantFromDiscovery({ grantTypesSupported: ["urn:ietf:params:oauth:grant-type:device_code", "authorization_code"], serverId: "srv", ports })).toBe("authorization_code");
    expect(resolveGrantFromDiscovery({ grantTypesSupported: ["urn:ietf:params:oauth:grant-type:device_code"], serverId: "srv", ports })).toBe("device_code");
  });
  it("refuses a server offering neither, naming what it offered", () => {
    expect(() => resolveGrantFromDiscovery({ grantTypesSupported: ["client_credentials", "implicit"], serverId: "srv", ports })).toThrow("no grant for srv: client_credentials|implicit");
  });
});

describe("mintClientForConnection", () => {
  it("refuses when the authorization server offers no registration", async () => {
    const h = makeHarness(new FakeRepo());
    await expect(mintClientForConnection({ deps: h.deps, record: makeRecord(), discovered: discovery({ registrationEndpoint: null }), input: { redirectUri: undefined, scopes: [], grant: "authorization_code" } }))
      .rejects.toMatchObject({ message: "external MCP server 'srv' has no OAuth client id and its authorization server offers no dynamic client registration", operatorAction: "act-registration" });
  });
  it("registers a redirect client for authorization_code and a callback-less one for device_code", async () => {
    const minted = { clientId: "c-new", clientSecret: null, tokenEndpointAuthMethod: "none" };
    const h = makeHarness(new FakeRepo(), { flow: { registerOAuthClientDynamically: async () => minted } });
    await expect(mintClientForConnection({ deps: h.deps, record: makeRecord(), discovered: discovery(), input: { redirectUri: "https://h.test/cb", scopes: ["s"], grant: "authorization_code" } })).resolves.toBe(minted);
    await mintClientForConnection({ deps: h.deps, record: makeRecord(), discovered: discovery(), input: { redirectUri: undefined, scopes: [], grant: "device_code" } });
    expect(h.flowCalls.map(c => c.args)).toEqual([
      [{ guard: { tag: "guard" }, options: { clientDisplayName: "client for Server", softwareId: "sw-id", redirectUris: ["https://h.test/cb"] }, registrationEndpoint: "https://as.test/register", scopes: ["s"] },
        { messages: { tag: "messages" }, grantTypes: ["authorization_code", "refresh_token"], authMethodsSupported: ["none"], timeoutMs: 15_000 }],
      [{ guard: { tag: "guard" }, options: { clientDisplayName: "client for Server", softwareId: "sw-id", redirectUris: [] }, registrationEndpoint: "https://as.test/register", scopes: [] },
        { messages: { tag: "messages" }, grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"], authMethodsSupported: ["none"], timeoutMs: 15_000 }],
    ]);
  });
});
