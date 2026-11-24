import { JINI_REQUEST_FACTS } from "@jini-ai/core/contracts/site/request-facts";
import { describe, expect, it } from "vitest";

import { apiConnectionOAuthCallbackRoute, type ApiConnectionOAuthCallbackRouteDeps } from "../oauth-callback.js";

/**
 * @file The API-connection OAuth callback as a server-neutral route: limiter first, state checks, the
 * attempt routed (never consumed) before Jini completes it, the binding cookie cleared once used,
 * callback fields deposited only after success, and failures classified by CODE only.
 */

const PATH = "/host/connections/oauth/callback";
type Connection = { descriptor: { connectionId: string } };

function harness(overrides: Partial<ApiConnectionOAuthCallbackRouteDeps<Connection>> = {}) {
  const calls = { limiterKeys: [] as string[], complete: [] as unknown[], deposits: [] as unknown[], logs: [] as string[], peeks: 0 };
  const attempt = { workspaceId: "ws-1", pluginId: "acme", connectionId: "c1", actorId: "u1" };
  const deps: ApiConnectionOAuthCallbackRouteDeps<Connection> = {
    path: PATH,
    messageType: "host:api-connection-connected",
    callbackLimiter: { check: async ({ key }) => { calls.limiterKeys.push(key); return { allowed: true }; } },
    host: {
      workspaceId: "ws-1",
      records: { peekAttempt: async () => { calls.peeks += 1; return attempt; } },
      listConnections: async () => [{ descriptor: { connectionId: "c0" } }, { descriptor: { connectionId: "c1" } }],
      serviceFor: () => ({ complete: async (input) => { calls.complete.push(input); return { attemptId: "att-9", callbackFields: { shop: "s1" } }; } }),
      callbackInbox: { deposit: (input) => { calls.deposits.push(input); } },
    },
    readBrowserBinding: ({ cookieHeader }) => (cookieHeader === "bind=b1" ? "b1" : ""),
    clearedBrowserBindingCookie: () => "bind=; Max-Age=0",
    isApiConnectionError: (error): error is { readonly code: string } => error instanceof CodedError,
    renderPage: ({ ok, reason, messageType }) => `${ok ? "ok" : `fail:${reason ?? "-"}`}|${messageType}`,
    publicOrigin: ({ facts }) => `${facts.servingProtocol}://site.test`,
    log: (line) => { calls.logs.push(line); },
    ...overrides,
  };
  return { deps, calls, attempt };
}

class CodedError extends Error {
  constructor(readonly code: string, message = `provider said: secret-${code}`) { super(message); }
}

async function call(deps: ApiConnectionOAuthCallbackRouteDeps<Connection>, { query = {}, cookie }: { query?: Record<string, unknown>; cookie?: string } = {}) {
  const route = apiConnectionOAuthCallbackRoute(deps);
  const request = new Request(`http://site.test${PATH}`, cookie === undefined ? {} : { headers: { cookie } });
  const facts = { clientAddress: "203.0.113.9", servingProtocol: "https", secure: true, query };
  const response = await route.handler({ request, params: {}, locals: { [JINI_REQUEST_FACTS]: facts } });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

describe("apiConnectionOAuthCallbackRoute", () => {
  it("is GET on the injected path", () => {
    const route = apiConnectionOAuthCallbackRoute(harness().deps);
    expect(route.method).toBe("GET");
    expect(route.path).toBe(PATH);
  });

  it("completes, deposits the declared fields, clears the binding and renders success", async () => {
    const { deps, calls } = harness();
    const res = await call(deps, { query: { state: "st", code: "cd", extra: ["a", "b"] }, cookie: "bind=b1" });
    expect(res).toMatchObject({ status: 200, body: "ok|host:api-connection-connected" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.getSetCookie()).toEqual(["bind=; Max-Age=0"]);
    expect(calls.limiterKeys).toEqual(["203.0.113.9"]);
    // Only string query values pass, as the provider sent them; the redirect URI is origin + the fixed path.
    expect(calls.complete).toEqual([{ workspaceId: "ws-1", actorId: "u1", redirectUri: `https://site.test${PATH}`, callbackParams: { state: "st", code: "cd" }, browserBinding: "b1" }]);
    expect(calls.deposits).toEqual([{ workspaceId: "ws-1", pluginId: "acme", connectionId: "c1", attemptId: "att-9", fields: { shop: "s1" } }]);
  });

  it("deposits nothing when the plugin declared no callback fields", async () => {
    const { deps, calls } = harness();
    deps.host.serviceFor = () => ({ complete: async () => ({ attemptId: "a", callbackFields: {} }) });
    expect((await call(deps, { query: { state: "st" } })).status).toBe(200);
    expect(calls.deposits).toEqual([]);
  });

  it("answers 429 rate_limited before reading anything else", async () => {
    const { deps, calls } = harness({ callbackLimiter: { check: async () => ({ allowed: false }) } });
    const res = await call(deps, { query: { state: "st" } });
    expect(res).toMatchObject({ status: 429, body: "fail:rate_limited|host:api-connection-connected" });
    expect(calls.peeks).toBe(0);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it.each([[{}], [{ state: "" }], [{ state: ["a"] }], [{ state: "x".repeat(513) }]])("answers 400 no_state for query %j", async (query) => {
    const { deps, calls } = harness();
    expect(await call(deps, { query })).toMatchObject({ status: 400, body: "fail:no_state|host:api-connection-connected" });
    expect(calls.peeks).toBe(0);
  });

  it("accepts a state of exactly 512 characters", async () => {
    expect((await call(harness().deps, { query: { state: "x".repeat(512) } })).status).toBe(200);
  });

  it.each([
    ["an unknown attempt", { peekAttempt: null }],
    ["a foreign-workspace attempt", { peekAttempt: { workspaceId: "ws-2", pluginId: "acme", connectionId: "c1", actorId: "u1" } }],
    ["a no-longer-declared connection", { peekAttempt: { workspaceId: "ws-1", pluginId: "acme", connectionId: "gone", actorId: "u1" } }],
  ])("answers 400 state_expired for %s without clearing the binding", async (_label, { peekAttempt }) => {
    const { deps, calls } = harness();
    deps.host.records.peekAttempt = async () => peekAttempt;
    const res = await call(deps, { query: { state: "st" } });
    expect(res).toMatchObject({ status: 400, body: "fail:state_expired|host:api-connection-connected" });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(calls.complete).toEqual([]);
  });

  it.each([
    ["invalid-attempt", "state_expired"], ["attempt-superseded", "state_expired"], ["access-denied", "provider_denied"],
    ["account-unchanged", "account_unchanged"], ["token-exchange-failed", "exchange_failed"],
  ])("maps a %s failure to %s by code, logging name + code only", async (code, reason) => {
    const { deps, calls } = harness();
    deps.host.serviceFor = () => ({ complete: async () => { throw new CodedError(code); } });
    const res = await call(deps, { query: { state: "st" } });
    expect(res).toMatchObject({ status: 400, body: `fail:${reason}|host:api-connection-connected` });
    expect(res.headers.getSetCookie()).toEqual(["bind=; Max-Age=0"]);
    expect(calls.logs).toEqual([`api-connection oauth callback failed: Error ${code}`]);
    expect(calls.logs.join()).not.toContain("secret");
  });

  it("maps an error the injected predicate does not recognise to exchange_failed, and a non-Error to 'unknown'", async () => {
    const { deps, calls } = harness();
    deps.host.serviceFor = () => ({ complete: async () => { throw Object.assign(new TypeError("boom"), { code: "access-denied" }); } });
    expect((await call(deps, { query: { state: "st" } })).body).toBe("fail:exchange_failed|host:api-connection-connected");
    deps.host.serviceFor = () => ({ complete: async () => { throw "plain"; } });
    await call(deps, { query: { state: "st" } });
    expect(calls.logs).toEqual(["api-connection oauth callback failed: TypeError access-denied", "api-connection oauth callback failed: unknown"]);
  });

  it("rethrows a limiter failure for the host's error path", async () => {
    const { deps } = harness({ callbackLimiter: { check: async () => { throw new Error("limiter down"); } } });
    await expect(call(deps, { query: { state: "st" } })).rejects.toThrow("limiter down");
  });

  it("fails loudly when mounted without the host's request facts", async () => {
    const route = apiConnectionOAuthCallbackRoute(harness().deps);
    await expect(route.handler({ request: new Request(`http://site.test${PATH}`), params: {}, locals: {} })).rejects.toThrow(/request facts are missing/);
  });
});
