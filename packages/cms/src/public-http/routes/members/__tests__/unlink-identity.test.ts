import { describe, expect, it } from "vitest";
import type { RateLimitResult, RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { bindMemberUnlinkIdentityRoute, memberUnlinkIdentityRoute, type MemberUnlinkIdentityRouteDeps } from "../unlink-identity.js";

/** @file The public member identity-unlink spec: an EMPTY JSON object body only, the presenting member
 * session before any counter, the strict per-IP then per-member counters before the unlink, the host session
 * cookie only on success, and every failure (missing session, foreign identity, host outage) answered by the
 * host's fail-closed refusal mapping — never a pass-through. */

const signal = new AbortController().signal;
const FACTS = { clientAddress: "203.0.113.7", userAgent: "UA/1" };
const COOKIE = "member=raw-old";

class HostLoginError extends Error { constructor(readonly code: string) { super(code); } }

function limiter(result: RateLimitResult = { allowed: true } as RateLimitResult) {
  const keys: string[] = [];
  return { keys, check: async ({ key }: { key: string }) => { keys.push(key); return result; } };
}

const raw = (body: unknown, headers: Record<string, string> = { cookie: COOKIE }): RouteInputContext =>
  ({ body, query: {}, params: { workspaceId: "ws-1", providerId: "google" }, headers, facts: FACTS }) as RouteInputContext;

function harness(over: Partial<MemberUnlinkIdentityRouteDeps> = {}) {
  const calls: string[] = [];
  const inputs: unknown[] = [];
  const deps: MemberUnlinkIdentityRouteDeps = {
    ipLimiter: limiter(), perMemberLimiter: limiter(),
    currentMemberId: async ({ cookieHeader }) => { calls.push(`current:${cookieHeader}`); return "m-1"; },
    unlinkIdentity: async (input) => { calls.push("unlink"); inputs.push(input); return { rawSessionToken: "raw-new", session: { expiresAt: "2030-01-01T00:00:00.000Z" } }; },
    sessionCookie: ({ rawToken, expiresAtIso }) => { calls.push("cookie"); return `member=${rawToken}; Expires=${expiresAtIso}`; },
    // Fail-closed, as the host's: its own code when it knows the error, LOGIN_INVALID for anything else.
    refusalFor: ({ error }) => {
      const code = error instanceof HostLoginError ? error.code : "LOGIN_INVALID";
      return { status: code === "LOGIN_UNAVAILABLE" ? 503 : 401, body: { error: "member login failed", code } };
    },
    ...over,
  };
  return { deps, calls, inputs };
}

const call = (deps: MemberUnlinkIdentityRouteDeps, input: RouteInputContext) => memberUnlinkIdentityRoute.handle({ raw: input, deps }, { signal });

async function refusal(promise: Promise<Response>): Promise<RouteRefusalError> {
  const error = await promise.then(() => undefined, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return error as RouteRefusalError;
}

const INVALID = { status: 401, body: { error: "member login failed", code: "LOGIN_INVALID" } };

describe("memberUnlinkIdentityRoute", () => {
  it("declares the public POST path, the cookie header and the request facts", () => {
    expect(memberUnlinkIdentityRoute).toMatchObject({ method: "post", path: "/api/members/v1/workspaces/:workspaceId/identities/:providerId/unlink", readHeaders: ["cookie"], requestFacts: true, bufferedReply: true });
  });

  it("unlinks behind both counters and appends only the reissued member session cookie", async () => {
    const ip = limiter(); const perMember = limiter();
    const { deps, calls, inputs } = harness({ ipLimiter: ip, perMemberLimiter: perMember });
    const response = await call(deps, raw({}));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.getSetCookie()).toEqual(["member=raw-new; Expires=2030-01-01T00:00:00.000Z"]);
    expect(await response.text()).toBe('{"ok":true}');
    expect(calls).toEqual([`current:${COOKIE}`, "unlink", "cookie"]);
    expect(ip.keys).toEqual(["203.0.113.7"]);
    expect(perMember.keys).toEqual(["m-1"]);
    expect(inputs).toEqual([{ cookieHeader: COOKIE, providerId: "google", userAgent: "UA/1", ip: "203.0.113.7" }]);
  });

  it.each([["a field", { providerId: "google" }], ["an array", []], ["null", null], ["a string", "x"]])("refuses %s as the body before any session read or counter", async (_label, body) => {
    const ip = limiter();
    const { deps, calls } = harness({ ipLimiter: ip });
    const error = await refusal(call(deps, raw(body)));
    expect(error.response).toEqual(INVALID);
    expect(calls).toEqual([]);
    expect(ip.keys).toEqual([]);
  });

  it("refuses a request with no live member session (absent cookie) before charging any counter", async () => {
    const ip = limiter();
    const { deps, calls } = harness({ ipLimiter: ip, currentMemberId: async ({ cookieHeader }) => { calls.push(`current:${cookieHeader}`); return null; } });
    const error = await refusal(call(deps, raw({}, {})));
    expect(error.response).toEqual(INVALID);
    expect(calls).toEqual(["current:undefined"]);
    expect(ip.keys).toEqual([]);
  });

  it("answers the host's own code when the session owner refuses (a disabled member)", async () => {
    const { deps } = harness({ currentMemberId: async () => { throw new HostLoginError("LOGIN_BLOCKED"); } });
    const error = await refusal(call(deps, raw({})));
    expect(error.response.body).toEqual({ error: "member login failed", code: "LOGIN_BLOCKED" });
  });

  it("refuses unlinking an identity the member does not own, without a cookie", async () => {
    const { deps, calls } = harness({ unlinkIdentity: async () => { calls.push("unlink"); throw new HostLoginError("LOGIN_INVALID"); } });
    const error = await refusal(call(deps, raw({})));
    expect(error.response).toEqual(INVALID);
    expect(calls).toEqual([`current:${COOKIE}`, "unlink"]);
  });

  it("fails closed on an unexpected error (no 500 pass-through) and keeps 503 for an unavailable owner", async () => {
    const unexpected = await refusal(call(harness({ unlinkIdentity: async () => { throw new Error("db down: secret"); } }).deps, raw({})));
    expect(unexpected.response).toEqual(INVALID);
    const unavailable = await refusal(call(harness({ unlinkIdentity: async () => { throw new HostLoginError("LOGIN_UNAVAILABLE"); } }).deps, raw({})));
    expect(unavailable.response.status).toBe(503);
  });

  it("answers 429 from the IP counter before the per-member counter or the unlink", async () => {
    const perMember = limiter();
    const { deps, calls } = harness({ ipLimiter: limiter({ allowed: false, retryAfterSeconds: 9 } as RateLimitResult), perMemberLimiter: perMember });
    const response = await call(deps, raw({}));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("9");
    expect(await response.json()).toEqual({ error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 9 } });
    expect(perMember.keys).toEqual([]);
    expect(calls).toEqual([`current:${COOKIE}`]);
  });

  it("answers 429 from the per-member counter without unlinking", async () => {
    const { deps, calls } = harness({ perMemberLimiter: limiter({ allowed: false, retryAfterSeconds: 4 } as RateLimitResult) });
    const response = await call(deps, raw({}));
    expect(response.status).toBe(429);
    expect(calls).toEqual([`current:${COOKIE}`]);
  });
});

it("keeps the unlink preflight headers before its no-op observer and refuses before the raw spec", async () => {
  const order: string[] = [];
  const { deps } = harness();
  const binding = bindMemberUnlinkIdentityRoute({ deps, writeHeaders: () => { order.push("headers"); }, observe: () => {}, check: () => { order.push("check"); return false; } });
  binding.preflight({}, () => { order.push("raw"); });
  expect(order).toEqual(["headers", "check"]);
});
