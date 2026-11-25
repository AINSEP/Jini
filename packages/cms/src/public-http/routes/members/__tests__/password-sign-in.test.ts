import { describe, expect, it } from "vitest";
import { ok, routeReply, type RateLimitResult, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { memberPasswordSignInRoute, type MemberPasswordSignInRouteDeps, type MemberPasswordSignInResult } from "../password-sign-in.js";

/** @file The public member password sign-in spec: string-only body (400 before any counter), the IP-first
 * limit ladder (an IP-denied request charges no email counter and reaches no service), the unchanged
 * password bytes handed to the host service, the host's session cookie on the 200, the host's analytics
 * hooks in their hand-written order, and the host's credential refusals; anything else is rethrown. */

const signal = new AbortController().signal;
const FACTS = { clientAddress: "203.0.113.7", userAgent: "UA/1" };

function limiter(result: RateLimitResult = { allowed: true } as RateLimitResult) {
  const keys: string[] = [];
  return { keys, check: async ({ key }: { key: string }) => { keys.push(key); return result; } };
}
const denied = (retryAfterSeconds: number) => limiter({ allowed: false, retryAfterSeconds } as RateLimitResult);
const tooMany = (retryAfterSeconds: number) => ok({ value: routeReply({ status: 429, headers: { "Retry-After": String(retryAfterSeconds) },
  body: { error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds } } }) });

const raw = (body: unknown, facts: { clientAddress: string; userAgent?: string } = FACTS): RouteInputContext =>
  ({ body, query: {}, params: { workspaceId: "ws-1" }, facts }) as RouteInputContext;

const RESULT: MemberPasswordSignInResult = { rawSessionToken: "raw-token", session: { expiresAt: "2030-01-01T00:00:00.000Z" }, member: { id: "m-1", secret: "x" } };

function harness(over: Partial<MemberPasswordSignInRouteDeps> = {}) {
  const calls: string[] = [];
  const inputs: unknown[] = [];
  const deps: MemberPasswordSignInRouteDeps = {
    workspaceId: "ws-1", ipLimiter: limiter(), emailLimiter: limiter(),
    signInRequested: () => { calls.push("requested"); },
    signInWithPassword: async (input) => { calls.push("service"); inputs.push(input); return RESULT; },
    sessionCookie: ({ rawToken, expiresAtIso }) => { calls.push("cookie"); return `member=${rawToken}; Expires=${expiresAtIso}`; },
    signedIn: ({ result }) => { calls.push(`signed-in:${result.rawSessionToken}`); },
    toPublicMember: ({ member }) => ({ id: (member as { id: string }).id }),
    refusalFor: () => undefined,
    ...over,
  };
  return { deps, calls, inputs };
}

async function call(deps: MemberPasswordSignInRouteDeps, input: RouteInputContext) {
  const parsed = memberPasswordSignInRoute.parse(input) as { ok: true; value: never };
  return memberPasswordSignInRoute.handle({ input: parsed.value, deps }, { signal });
}

describe("memberPasswordSignInRoute", () => {
  it("pins method, path and request facts", () => {
    expect(memberPasswordSignInRoute.method).toBe("post");
    expect(memberPasswordSignInRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/password/sign-in");
    expect(memberPasswordSignInRoute.requestFacts).toBe(true);
  });

  it("refuses a missing, non-string or extra-field body with the 400 (empty strings pass, as hand-written)", () => {
    for (const body of [null, [], "x", { email: "a@b.c" }, { email: 1, password: "p" }, { email: "a@b.c", password: "p", extra: "y" }]) {
      expect(() => memberPasswordSignInRoute.parse(raw(body))).toThrow(new RouteRefusalError({ status: 400, body: { error: "expected email and password strings" } }));
    }
    expect(memberPasswordSignInRoute.parse(raw({ email: "", password: "" })).ok).toBe(true);
  });

  it("answers the IP 429 first: no email counter charged, no analytics, no service", async () => {
    const emailLimiter = limiter();
    const { deps, calls } = harness({ ipLimiter: denied(7), emailLimiter });
    expect(await call(deps, raw({ email: " A@B.C ", password: "p" }))).toEqual(tooMany(7));
    expect(emailLimiter.keys).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("answers the email 429 keyed by the trimmed lower-cased address, before analytics or the service", async () => {
    const ipLimiter = limiter();
    const emailLimiter = denied(30);
    const { deps, calls } = harness({ ipLimiter, emailLimiter });
    expect(await call(deps, raw({ email: " A@B.C ", password: "p" }))).toEqual(tooMany(30));
    expect(ipLimiter.keys).toEqual(["203.0.113.7"]);
    expect(emailLimiter.keys).toEqual(["a@b.c"]);
    expect(calls).toEqual([]);
  });

  it("signs in with the unchanged password bytes and answers the public member with the host session cookie", async () => {
    const { deps, calls, inputs } = harness();
    const reply = await call(deps, raw({ email: " A@B.C ", password: "  pässword  " }));
    expect(reply).toEqual(ok({ value: routeReply({ status: 200, body: { member: { id: "m-1" } }, headers: { "Set-Cookie": "member=raw-token; Expires=2030-01-01T00:00:00.000Z" } }) }));
    expect(inputs).toEqual([{ workspaceId: "ws-1", email: " A@B.C ", password: "  pässword  ", userAgent: "UA/1", ip: "203.0.113.7" }]);
    expect(calls).toEqual(["requested", "service", "cookie", "signed-in:raw-token"]);
  });

  it("passes an absent user agent as undefined", async () => {
    const { deps, inputs } = harness();
    await call(deps, raw({ email: "a@b.c", password: "p" }, { clientAddress: "198.51.100.1" }));
    expect(inputs).toEqual([{ workspaceId: "ws-1", email: "a@b.c", password: "p", userAgent: undefined, ip: "198.51.100.1" }]);
  });

  it("throws the host refusal for a credential failure (no session cookie, no signed-in event) and rethrows the unexpected", async () => {
    const refusal = { status: 401, body: { error: "invalid credentials", code: "INVALID_CREDENTIALS" } };
    const failing = harness({ signInWithPassword: async () => { throw new Error("bad"); }, refusalFor: () => refusal });
    await expect(call(failing.deps, raw({ email: "a@b.c", password: "p" }))).rejects.toEqual(new RouteRefusalError(refusal));
    expect(failing.calls).toEqual(["requested"]);
    const boom = new Error("boom");
    const unexpected = harness({ ipLimiter: { check: async () => { throw boom; } } });
    await expect(call(unexpected.deps, raw({ email: "a@b.c", password: "p" }))).rejects.toBe(boom);
  });
});
