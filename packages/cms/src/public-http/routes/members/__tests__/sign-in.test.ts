import { describe, expect, it } from "vitest";
import { ok, routeReply, type RateLimitResult, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { memberSignInRequestRoute, type MemberSignInRequestRouteDeps } from "../sign-in.js";

/** @file The public member sign-in-request spec: string-only body and the empty-email 400 before any
 * counter, the IP-first limit ladder (an IP-denied request charges no email counter and mints no
 * challenge), the generic acceptance that never waits on per-address delivery, and the host's refusals. */

const signal = new AbortController().signal;
const FACTS = { clientAddress: "203.0.113.7", userAgent: "UA/1" };

function limiter(result: RateLimitResult = { allowed: true } as RateLimitResult) {
  const keys: string[] = [];
  return { keys, check: async ({ key }: { key: string }) => { keys.push(key); return result; } };
}
const denied = (retryAfterSeconds: number) => limiter({ allowed: false, retryAfterSeconds } as RateLimitResult);
const tooMany = (retryAfterSeconds: number) => ok({ value: routeReply({ status: 429, headers: { "Retry-After": String(retryAfterSeconds) },
  body: { error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds } } }) });

const raw = (body: unknown): RouteInputContext => ({ body, query: {}, params: { workspaceId: "ws-1" }, facts: FACTS }) as RouteInputContext;

function harness(over: Partial<MemberSignInRequestRouteDeps> = {}) {
  const calls: string[] = [];
  const inputs: unknown[] = [];
  const deps: MemberSignInRequestRouteDeps = {
    workspaceId: "ws-1", ipLimiter: limiter(), emailLimiter: limiter(),
    prepareSignIn: async (input) => { calls.push("prepare"); inputs.push(input); return { challengeId: "ch-1", deliver: async () => { calls.push("deliver"); } }; },
    signInRequested: () => { calls.push("requested"); },
    deliverInBackground: () => { calls.push("scheduled"); },
    refusalFor: () => undefined,
    ...over,
  };
  return { deps, calls, inputs };
}

async function call(deps: MemberSignInRequestRouteDeps, input: RouteInputContext) {
  const parsed = memberSignInRequestRoute.parse(input) as { ok: true; value: never };
  return memberSignInRequestRoute.handle({ input: parsed.value, deps }, { signal });
}

describe("memberSignInRequestRoute", () => {
  it("pins method, path and request facts", () => {
    expect(memberSignInRequestRoute.method).toBe("post");
    expect(memberSignInRequestRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/sign-in");
    expect(memberSignInRequestRoute.requestFacts).toBe(true);
  });

  it("refuses a missing, non-string or extra-field body with the 400", () => {
    for (const body of [null, [], "x", {}, { email: 1 }, { email: "a@b.c", redirectPath: 2 }, { email: "a@b.c", password: "p" }]) {
      expect(() => memberSignInRequestRoute.parse(raw(body))).toThrow(new RouteRefusalError({ status: 400, body: { error: "expected email and optional redirectPath strings" } }));
    }
  });

  it("refuses a blank email with the service's validation copy, quoting the bytes sent", () => {
    expect(() => memberSignInRequestRoute.parse(raw({ email: "  " }))).toThrow(new RouteRefusalError({ status: 400, body: { error: "'  ' is not a valid email address" } }));
  });

  it("answers the IP 429 first: no email counter charged, no challenge, no analytics", async () => {
    const emailLimiter = limiter();
    const { deps, calls } = harness({ ipLimiter: denied(7), emailLimiter });
    expect(await call(deps, raw({ email: " A@B.C " }))).toEqual(tooMany(7));
    expect(emailLimiter.keys).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("answers the email 429 keyed by the trimmed lower-cased address before any challenge", async () => {
    const ipLimiter = limiter();
    const emailLimiter = denied(30);
    const { deps, calls } = harness({ ipLimiter, emailLimiter });
    expect(await call(deps, raw({ email: " A@B.C " }))).toEqual(tooMany(30));
    expect(ipLimiter.keys).toEqual(["203.0.113.7"]);
    expect(emailLimiter.keys).toEqual(["a@b.c"]);
    expect(calls).toEqual([]);
  });

  it("accepts generically: prepare, analytics, then schedules delivery without awaiting it", async () => {
    let deliver: (() => Promise<unknown>) | undefined;
    const { deps, calls, inputs } = harness({ deliverInBackground: (d) => { calls.push("scheduled"); deliver = d.deliver; } });
    expect(await call(deps, raw({ email: "A@B.C", redirectPath: "/x" }))).toEqual(ok({ value: { accepted: true, challengeId: "ch-1" } }));
    expect(inputs).toEqual([{ workspaceId: "ws-1", email: "A@B.C", redirectPath: "/x" }]);
    expect(calls).toEqual(["prepare", "requested", "scheduled"]);
    await deliver?.();
    expect(calls).toEqual(["prepare", "requested", "scheduled", "deliver"]);
  });

  it("maps a host refusal and schedules nothing; anything unknown is rethrown unchanged", async () => {
    const setup = new Error("setup");
    const refused = harness({ prepareSignIn: async () => { throw setup; }, refusalFor: ({ error }) => error === setup ? { status: 503, body: { error: "unavailable" } } : undefined });
    await expect(call(refused.deps, raw({ email: "a@b.c" }))).rejects.toEqual(new RouteRefusalError({ status: 503, body: { error: "unavailable" } }));
    expect(refused.calls).toEqual([]);
    const boom = new Error("boom");
    const failed = harness({ prepareSignIn: async () => { throw boom; } });
    await expect(call(failed.deps, raw({ email: "a@b.c" }))).rejects.toBe(boom);
  });
});
