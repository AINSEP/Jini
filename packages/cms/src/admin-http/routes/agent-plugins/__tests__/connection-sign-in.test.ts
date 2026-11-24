import { describe, expect, it } from "vitest";

import { apiConnectionSignInRoute, type ApiConnectionSignInRouteDeps } from "../connection-sign-in.js";

/** @file The hosted sign-in hop: session credentials only, one handoff consume, binding cookie + 302; every answer no-store, no-referrer. */

const PATH = "/admin/ws/:workspaceId/sign-in/:handoffId";

function harness(overrides: Partial<ApiConnectionSignInRouteDeps> = {}) {
  const takes: unknown[] = [];
  const deps: ApiConnectionSignInRouteDeps = {
    path: PATH,
    workspaceId: "ws-1",
    credentialKind: ({ locals }) => locals.kind as string | undefined,
    actorId: ({ locals }) => locals.actor as string,
    forbidden: { message: "Sign-in links need a signed-in admin session.", permission: "admin.assistant.use" },
    takeHandoff: (input) => { takes.push(input); return input.handoffId === "h1" ? { browserBinding: "b".repeat(43), authorizationUrl: "https://idp.test/authorize?x=1" } : null; },
    bindingCookie: ({ browserBinding }) => `bind=${browserBinding}`,
    messageType: "host:api-connection-connected",
    renderPage: ({ ok, reason, messageType }) => `${ok ? "ok" : `fail:${reason ?? "-"}`}|${messageType}`,
    ...overrides,
  };
  return { deps, takes };
}

async function call(deps: ApiConnectionSignInRouteDeps, params: Record<string, string>, locals: Record<string, unknown> = { kind: "session", actor: "u1" }) {
  const response = await apiConnectionSignInRoute(deps).handler({ request: new Request("http://h/x"), params, locals });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

describe("apiConnectionSignInRoute", () => {
  it("is GET on the injected path", () => {
    const route = apiConnectionSignInRoute(harness().deps);
    expect([route.method, route.path]).toEqual(["GET", PATH]);
  });

  it("consumes the handoff for this actor, sets the binding cookie and redirects", async () => {
    const { deps, takes } = harness();
    const res = await call(deps, { workspaceId: "ws-1", handoffId: "h1" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://idp.test/authorize?x=1");
    expect(res.headers.getSetCookie()).toEqual([`bind=${"b".repeat(43)}`]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.body).toBe("Found. Redirecting to https://idp.test/authorize?x=1");
    expect(takes).toEqual([{ handoffId: "h1", actorId: "u1" }]);
  });

  it.each([[undefined], ["api_key"]])("refuses a %s credential with the host's 403 body before any consume", async (kind) => {
    const { deps, takes } = harness();
    const res = await call(deps, { workspaceId: "ws-1", handoffId: "h1" }, { kind, actor: "u1" });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(res.body)).toEqual({ error: "Sign-in links need a signed-in admin session.", code: "FORBIDDEN", details: { permission: "admin.assistant.use", reason: "credential_kind_not_permitted" } });
    expect(takes).toEqual([]);
  });

  it("answers state_expired without consuming when the workspace differs", async () => {
    const { deps, takes } = harness();
    const res = await call(deps, { workspaceId: "ws-2", handoffId: "h1" });
    expect(res).toMatchObject({ status: 400, body: "fail:state_expired|host:api-connection-connected" });
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(takes).toEqual([]);
  });

  it("answers state_expired for an unknown, foreign-actor or spent handoff", async () => {
    const { deps, takes } = harness();
    expect((await call(deps, { workspaceId: "ws-1", handoffId: "nope" })).status).toBe(400);
    expect(takes).toEqual([{ handoffId: "nope", actorId: "u1" }]);
  });

  it("reads absent params as the literal 'undefined', as the host's String(req.params.x) did", async () => {
    const { deps, takes } = harness({ workspaceId: "undefined" });
    await call(deps, {});
    expect(takes).toEqual([{ handoffId: "undefined", actorId: "u1" }]);
  });
});
