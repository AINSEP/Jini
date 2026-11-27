import { describe, expect, it } from "vitest";
import type { RateLimitResult, RouteInputContext } from "@jini-ai/core/contracts/server";
import { memberOidcLimitResponse, runMemberOidcPreflight } from "../oidc-shared.js";
import { memberOidcStartRoute, type MemberOidcStartRouteDeps } from "../oidc-start.js";
import { completeMemberOidcRouteOutcome, bindMemberOidcCallbackRoute, memberOidcCallbackRoute, type MemberOidcCallbackRouteDeps, type MemberOidcCallbackOutcome } from "../oidc-callback.js";

/** @file The public member OIDC start and callback specs: top-level browser pages, so every failure (a refused
 * cross-site start, a bad provider, a missing/forged state, a nonce mismatch, an expired flow cookie, a provider
 * error) is the host's fixed sign-in error redirect — never upstream text — and the callback's binding-clearing
 * cookie rides on EVERY answer after it is computed, including that error redirect and the 429. The protocol
 * itself (state/nonce/PKCE) is the host's injected `begin` / `complete`; these specs own the HTTP sequencing.
 * Named mutations: `start-cross-site-admitted` (the Sec-Fetch-Site gate removed) and
 * `callback-error-drops-binding-clear` (the error redirect answered without the cookies set so far). */

const signal = new AbortController().signal;
const FACTS = { clientAddress: "203.0.113.7", userAgent: "UA/1" };
const CALLBACK_URL = "https://site.example/api/members/v1/workspaces/ws-1/oidc/google/callback";
const BINDING = "b".repeat(43);

class HostLoginError extends Error { constructor(readonly code: string, message = code) { super(message); } }

function limiter(result: RateLimitResult = { allowed: true } as RateLimitResult) {
  const keys: string[] = [];
  return { keys, check: async ({ key }: { key: string }) => { keys.push(key); return result; } };
}

const raw = (headers: Record<string, string> = {}): RouteInputContext =>
  ({ body: undefined, query: {}, params: { workspaceId: "ws-1", providerId: "google" }, headers, facts: FACTS }) as RouteInputContext;

/** Host-shaped cookie and error-location bindings shared by both harnesses. */
function hostBindings(calls: string[]) {
  return {
    flowCookie: ({ callbackUrl, kind, binding }: { callbackUrl: string; kind: "callback" | "proof"; binding?: string }) => {
      if (binding !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new HostLoginError("LOGIN_INVALID");
      calls.push(`cookie:${kind}:${binding === undefined ? "clear" : "set"}`);
      return `${kind}=${binding ?? ""}; Path=${new URL(callbackUrl).pathname}`;
    },
    errorLocation: ({ error }: { error: unknown }) => `/signin#oidcError=${error instanceof HostLoginError ? error.code : "LOGIN_INVALID"}`,
    onFailed: () => { calls.push("failed"); },
  };
}

function startHarness(over: Partial<MemberOidcStartRouteDeps> = {}) {
  const calls: string[] = [];
  const deps: MemberOidcStartRouteDeps = {
    ...hostBindings(calls),
    ipLimiter: limiter(),
    crossSiteRefusal: () => new HostLoginError("LOGIN_INVALID"),
    begin: async () => { calls.push("begin"); return { authorizationUrl: "https://idp.example/authorize?state=s", callbackUrl: CALLBACK_URL, browserBinding: BINDING }; },
    onRequested: () => { calls.push("requested"); },
    ...over,
  };
  return { deps, calls };
}

function callbackHarness(outcome: () => Promise<MemberOidcCallbackOutcome>, over: Partial<MemberOidcCallbackRouteDeps> = {}) {
  const calls: string[] = [];
  const deps: MemberOidcCallbackRouteDeps = {
    ...hostBindings(calls),
    ipLimiter: limiter(),
    signedInLocation: "/account",
    callbackUrl: async () => { calls.push("callback-url"); return CALLBACK_URL; },
    complete: async () => { calls.push("complete"); return outcome(); },
    ...over,
  };
  return { deps, calls };
}

const answer = (response: Response) => ({ status: response.status, location: response.headers.get("location"), cookies: response.headers.getSetCookie() });

describe("memberOidcStartRoute", () => {
  it("declares a GET on the OIDC start path, the headers it reads, request facts and the redirect reply", () => {
    expect(memberOidcStartRoute).toMatchObject({ method: "get", path: "/api/members/v1/workspaces/:workspaceId/oidc/:providerId/start",
      readHeaders: ["sec-fetch-site"], requestFacts: true, bufferedReply: "redirect" });
  });

  it("sets the binding cookie on the callback path and answers 303 to the provider", async () => {
    const { deps, calls } = startHarness();
    const response = await memberOidcStartRoute.handle({ raw: raw({ "sec-fetch-site": "same-origin" }), deps }, { signal });
    expect(answer(response)).toEqual({ status: 303, location: "https://idp.example/authorize?state=s",
      cookies: [`callback=${BINDING}; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback`] });
    expect(calls).toEqual(["begin", "cookie:callback:set", "requested"]);
  });

  it("refuses a cross-site start before any protocol work, as the fixed error redirect", async () => {
    const { deps, calls } = startHarness();
    const response = await memberOidcStartRoute.handle({ raw: raw({ "sec-fetch-site": "cross-site" }), deps }, { signal });
    expect(answer(response)).toEqual({ status: 303, location: "/signin#oidcError=LOGIN_INVALID", cookies: [] });
    expect(calls).toEqual(["failed"]);
  });

  it("answers the limiter's 429 JSON without beginning a login", async () => {
    const { deps, calls } = startHarness({ ipLimiter: limiter({ allowed: false, retryAfterSeconds: 9 } as RateLimitResult) });
    const response = await memberOidcStartRoute.handle({ raw: raw(), deps }, { signal });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("9");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 9 } });
    expect(calls).toEqual([]);
  });

  it("fails closed on a provider outage or a malformed binding, never echoing upstream text", async () => {
    for (const over of [
      { begin: async () => { throw new HostLoginError("LOGIN_UNAVAILABLE", "upstream said client_secret=abc"); } },
      { begin: async () => ({ authorizationUrl: "https://idp.example/a", callbackUrl: CALLBACK_URL, browserBinding: "short" }) },
      { begin: async () => { throw new Error("access_token=leak"); } },
    ] satisfies Partial<MemberOidcStartRouteDeps>[]) {
      const { deps, calls } = startHarness(over);
      const response = await memberOidcStartRoute.handle({ raw: raw(), deps }, { signal });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toMatch(/^\/signin#oidcError=LOGIN_(UNAVAILABLE|INVALID)$/);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.text()).toBe("");
      expect(calls.at(-1)).toBe("failed");
    }
  });
});

describe("memberOidcCallbackRoute", () => {
  const signedIn = async (): Promise<MemberOidcCallbackOutcome> => ({ kind: "signed_in", sessionCookie: () => "member=raw; Path=/", announce: () => {} });

  it("declares a GET on the OIDC callback path with request facts and the redirect reply", () => {
    expect(memberOidcCallbackRoute).toMatchObject({ method: "get", path: "/api/members/v1/workspaces/:workspaceId/oidc/:providerId/callback",
      requestFacts: true, bufferedReply: "redirect" });
  });

  it("signs in: clears the binding then the proof cookie, sets the session, announces, and redirects to the signed-in page", async () => {
    let announced = 0;
    const { deps, calls } = callbackHarness(async () => ({ kind: "signed_in", sessionCookie: () => "member=raw; Path=/", announce: () => { announced++; } }));
    const response = await memberOidcCallbackRoute.handle({ raw: raw(), deps }, { signal });
    expect(answer(response)).toEqual({ status: 303, location: "/account", cookies: [
      "callback=; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback",
      "proof=; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback",
      "member=raw; Path=/",
    ] });
    expect(calls).toEqual(["callback-url", "cookie:callback:clear", "complete", "cookie:proof:clear"]);
    expect(announced).toBe(1);
  });

  it("continues by email: clears the binding, sets the browser-bound proof cookie and redirects to the sealed fragment", async () => {
    const { deps, calls } = callbackHarness(async () => ({ kind: "email_verification_required",
      continueByEmail: async () => ({ browserBinding: BINDING, location: "/signin#oidc=google&challengeId=c&continuation=x" }) }));
    const response = await memberOidcCallbackRoute.handle({ raw: raw(), deps }, { signal });
    expect(answer(response)).toEqual({ status: 303, location: "/signin#oidc=google&challengeId=c&continuation=x", cookies: [
      "callback=; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback",
      `proof=${BINDING}; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback`,
    ] });
    expect(calls).toEqual(["callback-url", "cookie:callback:clear", "complete", "cookie:proof:set"]);
  });

  it("refuses every protocol failure with the fixed error redirect that still clears the binding cookie", async () => {
    for (const [label, error] of [
      ["missing or forged state", new HostLoginError("LOGIN_INVALID", "state=forged")],
      ["nonce mismatch", new HostLoginError("LOGIN_INVALID", "nonce mismatch id_token=eyJ")],
      ["expired flow cookie", new HostLoginError("LOGIN_EXPIRED", "flow expired")],
      ["provider error", new HostLoginError("LOGIN_INVALID", "error=server_error")],
      ["cancelled at the provider", new HostLoginError("LOGIN_CANCELLED")],
      ["unexpected upstream failure", new Error("code=one-time-secret")],
    ] as const) {
      const { deps, calls } = callbackHarness(async () => { throw error; });
      const response = await memberOidcCallbackRoute.handle({ raw: raw(), deps }, { signal });
      const code = error instanceof HostLoginError ? error.code : "LOGIN_INVALID";
      expect(answer(response), label).toEqual({ status: 303, location: `/signin#oidcError=${code}`,
        cookies: ["callback=; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback"] });
      expect(await response.text(), label).toBe("");
      expect(calls, label).toEqual(["callback-url", "cookie:callback:clear", "complete", "failed"]);
    }
  });

  it("refuses a bad provider before any cookie, and a rate-limited email continuation as the error redirect", async () => {
    const bad = callbackHarness(signedIn, { callbackUrl: async () => { throw new HostLoginError("LOGIN_INVALID"); } });
    expect(answer(await memberOidcCallbackRoute.handle({ raw: raw(), deps: bad.deps }, { signal }))).toEqual({ status: 303, location: "/signin#oidcError=LOGIN_INVALID", cookies: [] });
    const limited = callbackHarness(async () => ({ kind: "email_verification_required", continueByEmail: async () => { throw new HostLoginError("LOGIN_UNAVAILABLE"); } }));
    const response = await memberOidcCallbackRoute.handle({ raw: raw(), deps: limited.deps }, { signal });
    expect(answer(response)).toEqual({ status: 303, location: "/signin#oidcError=LOGIN_UNAVAILABLE", cookies: ["callback=; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback"] });
  });

  it("answers the limiter's 429 JSON with the binding-clearing cookie and never spends the one-time code", async () => {
    const ipLimiter = limiter({ allowed: false, retryAfterSeconds: 4 } as RateLimitResult);
    const { deps, calls } = callbackHarness(signedIn, { ipLimiter });
    const response = await memberOidcCallbackRoute.handle({ raw: raw(), deps }, { signal });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(response.headers.getSetCookie()).toEqual(["callback=; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback"]);
    expect(calls).toEqual(["callback-url", "cookie:callback:clear"]);
    expect(ipLimiter.keys).toEqual(["203.0.113.7"]);
  });
});

it("assembles a callback outcome without reading the session cookie or announcing before the raw spec", async () => {
  const calls: string[] = [];
  const result = { token: "raw" };
  const outcome = await completeMemberOidcRouteOutcome({ readContext: async () => ({}), readBrowserBinding: () => "binding", complete: async () => ({ kind: "signed_in", result }),
    sessionCookie: () => { calls.push("session"); return "member=raw"; }, announce: () => { calls.push("announce"); } });
  expect(calls).toEqual([]);
  const { deps } = callbackHarness(async () => outcome);
  const binding = bindMemberOidcCallbackRoute({ deps, requestDeps: () => deps,
    writeHeaders: () => { calls.push("headers"); }, observe: () => { calls.push("observe"); }, check: () => false });
  binding.preflight({}, () => { calls.push("raw"); });
  expect(calls).toEqual(["headers", "observe"]);
  const response = await binding.spec.handle({ raw: raw(), deps: binding.requestDeps({ request: {}, deps: binding.deps }) }, { signal });
  expect(response.headers.getSetCookie().at(-1)).toBe("member=raw");
  expect(calls.slice(-2)).toEqual(["session", "announce"]);
});

it("callback outcome forwards the bound email continuation without issuing a session", async () => {
  const calls: unknown[] = [];
  const linked = { kind: "email_verification_required" as const, continueByEmail: async () =>
    ({ browserBinding: BINDING, location: "/signin#email-proof" }) };
  const outcome = await completeMemberOidcRouteOutcome({
    readContext: async () => ({ provider: "google" }), readBrowserBinding: () => "browser-bound",
    complete: async (request) => { calls.push(request); return linked; },
    sessionCookie: () => { throw new Error("no session should be issued"); },
    announce: () => { throw new Error("not signed in"); },
  });
  expect(outcome).toBe(linked);
  expect(calls).toEqual([{ context: { provider: "google" }, browserBinding: "browser-bound" }]);
  const { deps } = callbackHarness(async () => outcome);
  const response = await memberOidcCallbackRoute.handle({ raw: raw(), deps }, { signal });
  expect(response.headers.get("location")).toBe("/signin#email-proof");
  expect(response.headers.getSetCookie()).toEqual([
    "callback=; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback",
    `proof=${BINDING}; Path=/api/members/v1/workspaces/ws-1/oidc/google/callback`,
  ]);
});

it("OIDC preflight commits headers and observation before checking and returns the admitted handler result", async () => {
  const order: string[] = [];
  const result = Promise.resolve("handled");
  const callbacks = {
    writeHeaders: () => { order.push("headers"); }, observe: () => { order.push("observe"); },
    check: () => { order.push("check"); return true; },
    run: () => { order.push("run"); return result; },
  };
  expect(runMemberOidcPreflight(callbacks)).toBe(result);
  expect(order).toEqual(["headers", "observe", "check", "run"]);
});

it("OIDC limiter replies with JSON and the decided cookies even without custom limit headers", async () => {
  const cookies = ["callback=; Path=/callback", "proof=; Path=/proof"];
  const response = memberOidcLimitResponse({ limited: { status: 429, body: { code: "LIMIT" } }, cookies });
  expect(response.status).toBe(429);
  expect(response.headers.getSetCookie()).toEqual(cookies);
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await response.json()).toEqual({ code: "LIMIT" });
});
