import { describe, expect, it } from "vitest";
import type { RateLimitResult, RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { memberRequestLimitReply } from "../shared.js";
import { memberCompleteSignInRoute, type MemberCompleteSignInRouteDeps, type MemberCompleteSignInResult } from "../complete-sign-in.js";

/** @file The public member complete-sign-in spec: exactly one credential form (a non-empty link token, or a
 * challenge id plus a six-digit code) or the 400 before any counter, the per-IP attempt counter before the
 * service, the host session cookie only on success, the analytics hook after the cookie, and refusals. */

const signal = new AbortController().signal;
const FACTS = { clientAddress: "203.0.113.7", userAgent: "UA/1" };
const BAD_BODY = new RouteRefusalError({ status: 400, body: { error: "expected token or challengeId and six-digit code strings" } });

function limiter(result: RateLimitResult = { allowed: true } as RateLimitResult) {
  const keys: string[] = [];
  return { keys, check: async ({ key }: { key: string }) => { keys.push(key); return result; } };
}

const raw = (body: unknown, facts: { clientAddress: string; userAgent?: string } = FACTS): RouteInputContext =>
  ({ body, query: {}, params: { workspaceId: "ws-1" }, facts }) as RouteInputContext;

const RESULT: MemberCompleteSignInResult = { rawSessionToken: "raw-token", session: { expiresAt: "2030-01-01T00:00:00.000Z" }, member: { id: "m-1", secret: "x" } };

function harness(over: Partial<MemberCompleteSignInRouteDeps> = {}) {
  const calls: string[] = [];
  const inputs: unknown[] = [];
  const deps: MemberCompleteSignInRouteDeps = {
    workspaceId: "ws-1", attemptLimiter: limiter(),
    completeSignIn: async (input) => { calls.push("service"); inputs.push(input); return RESULT; },
    sessionCookie: ({ rawToken, expiresAtIso }) => { calls.push("cookie"); return `member=${rawToken}; Expires=${expiresAtIso}`; },
    signedIn: ({ result }) => { calls.push(`signed-in:${result.rawSessionToken}`); },
    toPublicMember: ({ member }) => ({ id: (member as { id: string }).id }),
    refusalFor: () => undefined,
    ...over,
  };
  return { deps, calls, inputs };
}

const call = (deps: MemberCompleteSignInRouteDeps, input: RouteInputContext) => memberCompleteSignInRoute.handle({ raw: input, deps }, { signal });

/** Status, every header line (Set-Cookie each on its own) and the JSON body of an answer. */
async function answer(response: Response) {
  return { status: response.status, headers: [...response.headers], cookies: response.headers.getSetCookie(), body: await response.json() };
}

describe("memberCompleteSignInRoute", () => {
  it("pins method, path, request facts and the buffered reply", () => {
    // The hand-written route answered with `res.json`: Content-Length and the app's ETag, never chunked.
    expect(Object.keys(memberCompleteSignInRoute).sort()).toEqual(["bufferedReply", "handle", "method", "path", "requestFacts"]);
    expect(memberCompleteSignInRoute.bufferedReply).toBe(true);
    expect(memberCompleteSignInRoute.method).toBe("post");
    expect(memberCompleteSignInRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/sign-in/complete");
    expect(memberCompleteSignInRoute.requestFacts).toBe(true);
  });

  it("refuses every body that is not exactly one well-formed credential form, before any counter or service", async () => {
    for (const body of [null, [], {}, { token: "" }, { token: 1 }, { token: "t", code: "123456" }, { token: "t", extra: "x" },
      { challengeId: "", code: "123456" }, { code: "123456" }, { challengeId: "ch", code: "12345" }, { challengeId: "ch", code: "1234567" },
      { challengeId: "ch", code: "12345a" }, { challengeId: "ch", code: " 123456" }, { challengeId: "ch", code: "123456\n" }, { challengeId: "ch", code: 123456 }]) {
      const { deps, calls } = harness();
      await expect(call(deps, raw(body)), JSON.stringify(body)).rejects.toEqual(BAD_BODY);
      expect(calls).toEqual([]);
    }
  });

  it("answers the attempt 429 before the service, keyed by the client address", async () => {
    const attemptLimiter = limiter({ allowed: false, retryAfterSeconds: 9 } as RateLimitResult);
    const { deps, calls } = harness({ attemptLimiter });
    expect(await answer(await call(deps, raw({ token: "t" })))).toEqual({ status: 429, cookies: [],
      headers: [["content-type", "application/json; charset=utf-8"], ["retry-after", "9"]],
      body: { error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 9 } } });
    expect(attemptLimiter.keys).toEqual(["203.0.113.7"]);
    expect(calls).toEqual([]);
  });

  it("completes a link token: the host cookie on the 200, then the analytics hook", async () => {
    const { deps, calls, inputs } = harness();
    expect(await answer(await call(deps, raw({ token: "link-token" })))).toEqual({ status: 200, body: { member: { id: "m-1" } },
      cookies: ["member=raw-token; Expires=2030-01-01T00:00:00.000Z"],
      headers: [["content-type", "application/json; charset=utf-8"], ["set-cookie", "member=raw-token; Expires=2030-01-01T00:00:00.000Z"]] });
    expect(inputs).toEqual([{ workspaceId: "ws-1", token: "link-token", userAgent: "UA/1", ip: "203.0.113.7" }]);
    expect(calls).toEqual(["service", "cookie", "signed-in:raw-token"]);
  });

  it("completes a challenge code with the exact id and code bytes", async () => {
    const { deps, inputs } = harness();
    await call(deps, raw({ challengeId: "ch-1", code: "012345" }, { clientAddress: "198.51.100.2" }));
    expect(inputs).toEqual([{ workspaceId: "ws-1", challengeId: "ch-1", code: "012345", userAgent: undefined, ip: "198.51.100.2" }]);
  });

  it("maps a credential failure with no cookie and no analytics; anything unknown is rethrown unchanged", async () => {
    const bad = new Error("bad");
    const refused = harness({ completeSignIn: async () => { throw bad; }, refusalFor: ({ error }) => error === bad ? { status: 401, body: { error: "invalid credentials" } } : undefined });
    await expect(call(refused.deps, raw({ token: "t" }))).rejects.toEqual(new RouteRefusalError({ status: 401, body: { error: "invalid credentials" } }));
    expect(refused.calls).toEqual([]);
    const boom = new Error("boom");
    const failed = harness({ completeSignIn: async () => { throw boom; } });
    await expect(call(failed.deps, raw({ token: "t" }))).rejects.toBe(boom);
  });
});

it("completes a valid link when the host has no user-agent without inventing a value", async () => {
  const { deps, inputs } = harness();
  const response = await call(deps, raw({ token: "t" }, { clientAddress: "203.0.113.9" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ member: { id: "m-1" } });
  expect(inputs).toEqual([{ workspaceId: "ws-1", token: "t", userAgent: undefined, ip: "203.0.113.9" }]);
});

it("reports the longest denied member limit while using normalized email and exact identity keys", async () => {
  const ipLimiter = limiter();
  const emailLimiter = limiter({ allowed: false, retryAfterSeconds: 3 });
  const identity = limiter({ allowed: false, retryAfterSeconds: 11 });
  expect(await memberRequestLimitReply({ clientAddress: "203.0.113.9", ipLimiter, email: " Ada@Example.test ",
    emailLimiter, identity: { limiter: identity, key: "member-a" } })).toEqual({
    status: 429, headers: { "Retry-After": "11" },
    body: { error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 11 } },
  });
  expect(ipLimiter.keys).toEqual(["203.0.113.9"]);
  expect(emailLimiter.keys).toEqual(["ada@example.test"]);
  expect(identity.keys).toEqual(["member-a"]);
  const empty = limiter();
  expect(await memberRequestLimitReply({ clientAddress: "203.0.113.9", ipLimiter, emailLimiter: empty })).toBeUndefined();
  expect(empty.keys).toEqual(["<empty>"]);
});
