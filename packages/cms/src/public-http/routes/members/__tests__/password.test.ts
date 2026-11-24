import { describe, expect, it } from "vitest";
import { ok, routeReply, type RateLimitResult, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { memberResetPasswordRoute, type MemberResetPasswordRouteDeps } from "../reset-password.js";
import { memberSetPasswordRoute, type MemberSetPasswordRouteDeps } from "../set-password.js";
import { memberForgotPasswordRoute, type MemberForgotPasswordRouteDeps } from "../forgot-password.js";

/** @file The public member password specs: string-only bodies, the IP-first limit ladder with its
 * 429 (Retry-After + details), and the host's credential refusals; anything else is rethrown. */

const signal = new AbortController().signal;
const FACTS = { clientAddress: "203.0.113.7" };

/** A limiter that records its keys and answers a fixed decision. */
function limiter(result: RateLimitResult = { allowed: true } as RateLimitResult) {
  const keys: string[] = [];
  return { keys, check: async ({ key }: { key: string }) => { keys.push(key); return result; } };
}
const denied = (retryAfterSeconds: number) => limiter({ allowed: false, retryAfterSeconds } as RateLimitResult);
const tooMany = (retryAfterSeconds: number) => ok({ value: routeReply({ status: 429, headers: { "Retry-After": String(retryAfterSeconds) },
  body: { error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds } } }) });

const raw = (body: unknown, extra: Record<string, unknown> = {}): RouteInputContext =>
  ({ body, query: {}, params: { workspaceId: "ws-1" }, facts: FACTS, ...extra }) as RouteInputContext;

/** Parse then handle, as the JSON mount does. */
async function call<D>(route: { parse: (raw: RouteInputContext) => unknown; handle: (...args: never[]) => unknown }, deps: D, input: RouteInputContext) {
  const parsed = route.parse(input) as { ok: true; value: unknown };
  return (route.handle as (r: unknown, o: unknown) => Promise<unknown>)({ input: parsed.value, deps, raw: input, context: undefined, authorize: async () => {} }, { signal });
}

const refusal = { status: 401, body: { error: "invalid credentials", code: "INVALID_CREDENTIALS" } };

describe("memberResetPasswordRoute", () => {
  const deps = (over: Partial<MemberResetPasswordRouteDeps> = {}): MemberResetPasswordRouteDeps => ({
    workspaceId: "ws-1", attemptLimiter: limiter(), refusalFor: () => undefined,
    resetPassword: async (input) => ({ reset: true, input }), ...over });

  it("pins method, path and request facts", () => {
    expect(memberResetPasswordRoute.method).toBe("post");
    expect(memberResetPasswordRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/reset-password");
    expect(memberResetPasswordRoute.requestFacts).toBe(true);
  });
  it("refuses a missing, empty or extra-field body with the 400 before any limiter", async () => {
    for (const body of [null, [], { token: "", password: "p" }, { token: "t" }, { token: "t", password: "p", x: "y" }, { token: 1, password: "p" }]) {
      expect(() => memberResetPasswordRoute.parse(raw(body))).toThrow(new RouteRefusalError({ status: 400, body: { error: "expected nonempty token and password strings" } }));
    }
  });
  it("answers the service result, keyed by workspace", async () => {
    expect(await call(memberResetPasswordRoute, deps(), raw({ token: "t", password: "p" })))
      .toEqual(ok({ value: { reset: true, input: { workspaceId: "ws-1", token: "t", password: "p" } } }));
  });
  it("answers the 429 when the attempt limiter (keyed by client address) denies", async () => {
    const attemptLimiter = denied(9);
    let called = false;
    expect(await call(memberResetPasswordRoute, deps({ attemptLimiter, resetPassword: async () => { called = true; } }), raw({ token: "t", password: "p" }))).toEqual(tooMany(9));
    expect(attemptLimiter.keys).toEqual(["203.0.113.7"]);
    expect(called).toBe(false);
  });
  it("throws the host refusal for a credential failure and rethrows the unexpected", async () => {
    const boom = new Error("db");
    await expect(call(memberResetPasswordRoute, deps({ refusalFor: () => refusal, resetPassword: async () => { throw boom; } }), raw({ token: "t", password: "p" })))
      .rejects.toEqual(new RouteRefusalError(refusal));
    await expect(call(memberResetPasswordRoute, deps({ resetPassword: async () => { throw boom; } }), raw({ token: "t", password: "p" }))).rejects.toBe(boom);
  });
  it("fails loudly when mounted without request facts", async () => {
    await expect(call(memberResetPasswordRoute, deps(), raw({ token: "t", password: "p" }, { facts: undefined }))).rejects.toThrow(/request facts/);
  });
});

describe("memberSetPasswordRoute", () => {
  const deps = (over: Partial<MemberSetPasswordRouteDeps> = {}): MemberSetPasswordRouteDeps => ({
    workspaceId: "ws-1", ipLimiter: limiter(), perMemberLimiter: limiter(), refusalFor: () => undefined,
    readSessionToken: ({ cookieHeader }) => cookieHeader?.match(/member=([^;]*)/)?.[1],
    requireSessionMemberId: async ({ sessionToken }) => { if (sessionToken !== "tok") throw new Error("no session"); return "m-1"; },
    setPassword: async (input) => ({ changed: true, input }), ...over });

  it("pins method, path, the cookie header and request facts", () => {
    expect(memberSetPasswordRoute.method).toBe("post");
    expect(memberSetPasswordRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/password/set");
    expect(memberSetPasswordRoute.readHeaders).toEqual(["cookie"]);
    expect(memberSetPasswordRoute.requestFacts).toBe(true);
  });
  it("refuses a malformed body with the 400", () => {
    for (const body of [undefined, { currentPassword: "c" }, { password: "p", currentPassword: 2 }]) {
      expect(() => memberSetPasswordRoute.parse(raw(body))).toThrow(new RouteRefusalError({ status: 400, body: { error: "expected password and optional currentPassword strings" } }));
    }
  });
  it("resolves the session first, then charges the IP and per-member counters, then sets", async () => {
    const ipLimiter = limiter(), perMemberLimiter = limiter();
    expect(await call(memberSetPasswordRoute, deps({ ipLimiter, perMemberLimiter }), raw({ password: "p", currentPassword: "c" }, { headers: { cookie: "member=tok" } })))
      .toEqual(ok({ value: { changed: true, input: { workspaceId: "ws-1", sessionToken: "tok", password: "p", currentPassword: "c" } } }));
    expect([ipLimiter.keys, perMemberLimiter.keys]).toEqual([["203.0.113.7"], ["m-1"]]);
  });
  it("answers the longest denied wait among the checked counters", async () => {
    expect(await call(memberSetPasswordRoute, deps({ perMemberLimiter: denied(40) }), raw({ password: "p" }, { headers: { cookie: "member=tok" } }))).toEqual(tooMany(40));
    expect(await call(memberSetPasswordRoute, deps({ ipLimiter: denied(3), perMemberLimiter: denied(40) }), raw({ password: "p" }, { headers: { cookie: "member=tok" } }))).toEqual(tooMany(3));
  });
  it("maps a missing session through the host refusal before any counter", async () => {
    const ipLimiter = limiter();
    await expect(call(memberSetPasswordRoute, deps({ ipLimiter, refusalFor: () => refusal }), raw({ password: "p" }))).rejects.toEqual(new RouteRefusalError(refusal));
    expect(ipLimiter.keys).toEqual([]);
  });
});

describe("memberForgotPasswordRoute", () => {
  const scheduled: (() => Promise<unknown>)[] = [];
  const deps = (over: Partial<MemberForgotPasswordRouteDeps> = {}): MemberForgotPasswordRouteDeps => ({
    workspaceId: "ws-1", emailLimiter: limiter(), ipLimiter: limiter(), refusalFor: () => undefined,
    prepareReset: async () => ({ deliver: async () => "sent" }),
    deliverInBackground: ({ deliver }) => { scheduled.push(deliver); }, ...over });

  it("pins method, path and request facts", () => {
    expect(memberForgotPasswordRoute.method).toBe("post");
    expect(memberForgotPasswordRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/forgot-password");
    expect(memberForgotPasswordRoute.requestFacts).toBe(true);
  });
  it("refuses a malformed body with the 400", () => {
    expect(() => memberForgotPasswordRoute.parse(raw({ email: "a@b.c", x: "1" }))).toThrow(new RouteRefusalError({ status: 400, body: { error: "expected email string" } }));
  });
  it("accepts generically and hands delivery to the host's background owner", async () => {
    const prepared: unknown[] = [];
    scheduled.length = 0;
    expect(await call(memberForgotPasswordRoute, deps({ prepareReset: async (input) => { prepared.push(input); return { deliver: async () => "sent" }; } }), raw({ email: "A@B.c" })))
      .toEqual(ok({ value: { accepted: true } }));
    expect(prepared).toEqual([{ workspaceId: "ws-1", email: "A@B.c" }]);
    expect(await scheduled[0]?.()).toBe("sent");
  });
  it("checks the IP first: a limited IP never charges the email counter", async () => {
    const emailLimiter = limiter();
    expect(await call(memberForgotPasswordRoute, deps({ ipLimiter: denied(5), emailLimiter }), raw({ email: "a@b.c" }))).toEqual(tooMany(5));
    expect(emailLimiter.keys).toEqual([]);
  });
  it("keys the email counter trimmed and lower-cased, an empty one as <empty>", async () => {
    const emailLimiter = limiter();
    await call(memberForgotPasswordRoute, deps({ emailLimiter }), raw({ email: "  A@B.C " }));
    await call(memberForgotPasswordRoute, deps({ emailLimiter }), raw({ email: "  " }));
    expect(emailLimiter.keys).toEqual(["a@b.c", "<empty>"]);
  });
  it("throws the host refusal for a known failure and rethrows the unexpected", async () => {
    const boom = new Error("x");
    await expect(call(memberForgotPasswordRoute, deps({ refusalFor: () => refusal, prepareReset: async () => { throw boom; } }), raw({ email: "a@b.c" }))).rejects.toEqual(new RouteRefusalError(refusal));
    await expect(call(memberForgotPasswordRoute, deps({ prepareReset: async () => { throw boom; } }), raw({ email: "a@b.c" }))).rejects.toBe(boom);
  });
});
