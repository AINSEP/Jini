import { JINI_REQUEST_FACTS } from "@jini-ai/core/contracts/site/request-facts";
import { describe, expect, it } from "vitest";

import { EXTERNAL_MCP_OAUTH_CALLBACK_PATH, externalMcpOAuthCallbackUrl } from "../oauth-callback-url.js";
import { externalMcpOAuthCallbackRoute, type ExternalMcpOAuthCallbackRouteDeps } from "../oauth-callback.js";

/**
 * @file The external-MCP OAuth callback as a server-neutral route: no-store + no-referrer on every
 * answer, limiter first, state and browser binding checked before the service, the roster notified
 * only after a durable success, and failures classified by class/code only.
 */

class FakeOAuthError extends Error { constructor(readonly code: string) { super(`provider text secret-${code}`); } }
class FakeUnknownServerError extends Error {}

function harness(overrides: Partial<ExternalMcpOAuthCallbackRouteDeps> = {}) {
  const calls = { limiterKeys: [] as string[], complete: [] as unknown[], notified: 0, logs: [] as string[] };
  const deps: ExternalMcpOAuthCallbackRouteDeps = {
    messageType: "host:external-mcp-connected",
    callbackLimiter: { check: async ({ key }) => { calls.limiterKeys.push(key); return { allowed: true }; } },
    oauth: { completeAuthorizationCallback: async (input) => { calls.complete.push(input); } },
    readBrowserBinding: ({ cookieHeader }) => (cookieHeader === "mcp=b1" ? "b1" : ""),
    clearedBrowserBindingCookie: () => "mcp=; Max-Age=0",
    notifyRosterChanged: async () => { calls.notified += 1; },
    isOAuthError: (error): error is { readonly code: string } => error instanceof FakeOAuthError,
    isUnknownServerError: (error) => error instanceof FakeUnknownServerError,
    renderPage: ({ ok, reason, messageType }) => `${ok ? "ok" : `fail:${reason ?? "-"}`}|${messageType}`,
    publicOrigin: ({ facts }) => `${facts.servingProtocol}://site.test`,
    log: (line) => { calls.logs.push(line); },
    ...overrides,
  };
  return { deps, calls };
}

async function call(deps: ExternalMcpOAuthCallbackRouteDeps, { query = {}, cookie, serverId = "srv 1" }: { query?: Record<string, unknown>; cookie?: string; serverId?: string } = {}) {
  const route = externalMcpOAuthCallbackRoute(deps);
  const request = new Request(`http://site.test${EXTERNAL_MCP_OAUTH_CALLBACK_PATH}/x`, cookie === undefined ? {} : { headers: { cookie } });
  const facts = { clientAddress: "198.51.100.7", servingProtocol: "https", secure: true, query };
  const response = await route.handler({ request, params: { serverId }, locals: { [JINI_REQUEST_FACTS]: facts } });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

const PAGE = "host:external-mcp-connected";

describe("externalMcpOAuthCallbackUrl", () => {
  it("keeps the public path and puts the encoded server id in the path", () => {
    expect(EXTERNAL_MCP_OAUTH_CALLBACK_PATH).toBe("/api/mcp-servers/oauth/callback");
    expect(externalMcpOAuthCallbackUrl({ origin: "https://a.test", serverId: "a/b c" })).toBe("https://a.test/api/mcp-servers/oauth/callback/a%2Fb%20c");
  });
});

describe("externalMcpOAuthCallbackRoute", () => {
  it("is GET on the callback path with the server id as a path param", () => {
    const route = externalMcpOAuthCallbackRoute(harness().deps);
    expect(route.method).toBe("GET");
    expect(route.path).toBe(`${EXTERNAL_MCP_OAUTH_CALLBACK_PATH}/:serverId`);
  });

  it("completes with the narrowed params, notifies the roster, clears the binding and renders success", async () => {
    const { deps, calls } = harness();
    const res = await call(deps, { query: { state: "st", code: "cd", error: "", iss: "x" }, cookie: "mcp=b1" });
    expect(res).toMatchObject({ status: 200, body: `ok|${PAGE}` });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.getSetCookie()).toEqual(["mcp=; Max-Age=0"]);
    expect(calls.limiterKeys).toEqual(["198.51.100.7"]);
    expect(calls.complete).toEqual([{ serverId: "srv 1", redirectUri: "https://site.test/api/mcp-servers/oauth/callback/srv%201", params: { state: "st", code: "cd" }, browserBinding: "b1" }]);
    expect(calls.notified).toBe(1);
  });

  it("passes a provider error through to the service as a string field", async () => {
    const { deps, calls } = harness();
    await call(deps, { query: { state: "st", error: "access_denied", code: ["x"] }, cookie: "mcp=b1" });
    expect(calls.complete).toEqual([expect.objectContaining({ params: { state: "st", error: "access_denied" } })]);
  });

  it("answers 429 rate_limited with the fixed headers and no cookie work", async () => {
    const { deps, calls } = harness({ callbackLimiter: { check: async () => ({ allowed: false }) } });
    const res = await call(deps, { query: { state: "st" }, cookie: "mcp=b1" });
    expect(res).toMatchObject({ status: 429, body: `fail:rate_limited|${PAGE}` });
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(calls.complete).toEqual([]);
  });

  it.each([[{}], [{ state: "" }], [{ state: 7 }]])("answers 400 no_state for query %j before touching the binding", async (query) => {
    const { deps, calls } = harness();
    const res = await call(deps, { query, cookie: "mcp=b1" });
    expect(res).toMatchObject({ status: 400, body: `fail:no_state|${PAGE}` });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(calls.complete).toEqual([]);
  });

  it("answers 400 browser_mismatch without a binding cookie, still clearing it", async () => {
    const { deps, calls } = harness();
    const res = await call(deps, { query: { state: "st" } });
    expect(res).toMatchObject({ status: 400, body: `fail:browser_mismatch|${PAGE}` });
    expect(res.headers.getSetCookie()).toEqual(["mcp=; Max-Age=0"]);
    expect(calls.complete).toEqual([]);
  });

  it.each([
    ["an unknown server", new FakeUnknownServerError("no such server"), "server_unknown"],
    ["an invalid state", new FakeOAuthError("OAUTH_INVALID_STATE"), "state_expired"],
    ["a provider denial", new FakeOAuthError("OAUTH_ACCESS_DENIED"), "provider_denied"],
    ["another OAuth code", new FakeOAuthError("OAUTH_TOKEN_EXCHANGE_FAILED"), "exchange_failed"],
    ["an unclassified error", Object.assign(new Error("x"), { code: "OAUTH_ACCESS_DENIED" }), "exchange_failed"],
  ])("maps %s to %s, logs the message and never notifies", async (_label, error, reason) => {
    const { deps, calls } = harness({ oauth: { completeAuthorizationCallback: async () => { throw error; } } });
    const res = await call(deps, { query: { state: "st" }, cookie: "mcp=b1" });
    expect(res).toMatchObject({ status: 400, body: `fail:${reason}|${PAGE}` });
    expect(res.body).not.toContain("secret");
    expect(calls.logs).toEqual([`external-mcp oauth callback failed: ${error.message}`]);
    expect(calls.notified).toBe(0);
  });

  it("logs a non-Error throw as its string form", async () => {
    const { deps, calls } = harness({ oauth: { completeAuthorizationCallback: async () => { throw "plain"; } } });
    expect((await call(deps, { query: { state: "st" }, cookie: "mcp=b1" })).status).toBe(400);
    expect(calls.logs).toEqual(["external-mcp oauth callback failed: plain"]);
  });

  it("renders failure when the roster notification itself throws after a durable completion", async () => {
    // The hand-written route awaited the notifier inside the same try: a throw there answered the failure page.
    const { deps } = harness({ notifyRosterChanged: async () => { throw new Error("daemon unreachable"); } });
    expect((await call(deps, { query: { state: "st" }, cookie: "mcp=b1" })).body).toBe(`fail:exchange_failed|${PAGE}`);
  });

  it("falls back to an empty server id when the param is absent", async () => {
    const { deps, calls } = harness();
    const route = externalMcpOAuthCallbackRoute(deps);
    const facts = { clientAddress: "a", servingProtocol: "https", secure: true, query: { state: "st" } };
    await route.handler({ request: new Request("http://site.test/x", { headers: { cookie: "mcp=b1" } }), params: {}, locals: { [JINI_REQUEST_FACTS]: facts } });
    expect(calls.complete).toEqual([expect.objectContaining({ serverId: "", redirectUri: "https://site.test/api/mcp-servers/oauth/callback/" })]);
  });
});
