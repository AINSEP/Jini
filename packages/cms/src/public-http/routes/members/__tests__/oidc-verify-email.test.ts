import { describe, expect, it } from "vitest";
import type { RateLimitResult, RouteInputContext } from "@jini-ai/core/contracts/server";
import { memberOidcVerifyEmailRoute, type MemberOidcEmailProof, type MemberOidcVerifyEmailRouteDeps } from "../oidc-verify-email.js";

/** @file The public member OIDC email-proof spec: the shared per-IP counter before the host's strict body
 * parser, the host's verification (proof cookie, sealed continuation, emailed code) before any cookie, the proof
 * clear then the session cookie on success only, and EVERY failure — a refused counter aside — answered by the
 * host's fail-closed refusal (401/503), keeping the cookies already decided, in order; never a pass-through. */

const signal = new AbortController().signal;
const FACTS = { clientAddress: "203.0.113.7", userAgent: "UA/1" };
const BODY = { continuation: "sealed", challengeId: "ch-1", code: "123456" };
const PROOF_CLEAR = "proof=; Path=/oidc/google/verify-email; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
const SESSION = "member=raw-new; Path=/";

class HostLoginError extends Error { constructor(readonly code: string) { super(code); } }

function limiter(result: RateLimitResult = { allowed: true } as RateLimitResult) {
  const keys: string[] = [];
  return { keys, check: async ({ key }: { key: string }) => { keys.push(key); return result; } };
}

const raw = (body: unknown = BODY, facts: RouteInputContext["facts"] | null = FACTS): RouteInputContext =>
  ({ body, query: {}, params: { workspaceId: "ws-1", providerId: "google" }, headers: {}, facts }) as RouteInputContext;

function harness(over: Partial<MemberOidcVerifyEmailRouteDeps> = {}) {
  const calls: string[] = [];
  const deps: MemberOidcVerifyEmailRouteDeps = {
    ipLimiter: limiter(),
    parseProof: ({ body }) => {
      calls.push("parse");
      if (JSON.stringify(body) !== JSON.stringify(BODY)) throw new HostLoginError("LOGIN_INVALID");
      return body as MemberOidcEmailProof;
    },
    verify: async ({ proof }) => {
      calls.push(`verify:${proof.challengeId}:${proof.code}`);
      return {
        kind: "signed_in",
        sessionCookie: () => { calls.push("session"); return SESSION; },
        announce: () => { calls.push("announce"); },
        member: () => { calls.push("member"); return { id: "m-1", email: "a@example.com" }; },
      };
    },
    callbackUrl: async () => { calls.push("callbackUrl"); return "https://site.example/oidc/google/callback"; },
    flowCookie: ({ callbackUrl, kind, binding }) => { calls.push(`flow:${kind}:${binding ?? "clear"}:${callbackUrl}`); return PROOF_CLEAR; },
    signedInLocation: "/account",
    // Fail-closed, as the host's: its own code when it knows the error, LOGIN_INVALID for anything else.
    refusalFor: ({ error }) => {
      const code = error instanceof HostLoginError ? error.code : "LOGIN_INVALID";
      return { status: code === "LOGIN_UNAVAILABLE" ? 503 : 401, body: { error: "member login failed", code } };
    },
    ...over,
  };
  return { deps, calls };
}

const call = (deps: MemberOidcVerifyEmailRouteDeps, input: RouteInputContext = raw()) => memberOidcVerifyEmailRoute.handle({ raw: input, deps }, { signal });

async function expectRefusal(response: Response, { status = 401, code = "LOGIN_INVALID", cookies = [] as string[] } = {}) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.getSetCookie()).toEqual(cookies);
  expect(await response.text()).toBe(JSON.stringify({ error: "member login failed", code }));
}

describe("memberOidcVerifyEmailRoute", () => {
  it("declares the public POST path, the request facts and the buffered JSON reply", () => {
    expect(memberOidcVerifyEmailRoute).toMatchObject({ method: "post", path: "/api/members/v1/workspaces/:workspaceId/oidc/:providerId/verify-email", requestFacts: true, bufferedReply: true });
  });

  it("verifies behind the counter, clears the proof cookie, then sets the session cookie and answers the member", async () => {
    const ip = limiter();
    const { deps, calls } = harness({ ipLimiter: ip });
    const response = await call(deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.getSetCookie()).toEqual([PROOF_CLEAR, SESSION]);
    expect(await response.text()).toBe(JSON.stringify({ member: { id: "m-1", email: "a@example.com" }, returnPath: "/account" }));
    expect(ip.keys).toEqual([FACTS.clientAddress]);
    expect(calls).toEqual(["parse", "verify:ch-1:123456", "callbackUrl", "flow:proof:clear:https://site.example/oidc/google/callback", "session", "announce", "member"]);
  });

  it("answers the counter's 429 with Retry-After before parsing or verifying anything", async () => {
    const { deps, calls } = harness({ ipLimiter: limiter({ allowed: false, retryAfterSeconds: 42 } as RateLimitResult) });
    const response = await call(deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({ error: "too many member authentication requests", code: "RATE_LIMIT_EXCEEDED", details: { retryAfterSeconds: 42 } });
    expect(calls).toEqual([]);
  });

  it("refuses a body the host parser rejects (claims, intent or proof booleans) without verifying", async () => {
    const { deps, calls } = harness();
    await expectRefusal(await call(deps, raw({ ...BODY, emailVerified: true })));
    expect(calls).toEqual(["parse"]);
  });

  it.each([
    ["a missing proof cookie", "LOGIN_INVALID"],
    ["an expired continuation", "LOGIN_EXPIRED"],
    ["a consumed challenge", "LOGIN_INVALID"],
    ["a wrong emailed code", "LOGIN_INVALID"],
  ])("refuses %s with the host's code and sets no cookie", async (_case, code) => {
    const { deps, calls } = harness({ verify: async () => { calls.push("verify"); throw new HostLoginError(code); } });
    await expectRefusal(await call(deps), { code });
    expect(calls).toEqual(["parse", "verify"]);
  });

  it("refuses a verification that did not sign in (email mismatch, further proof) with no cookie and no announcement", async () => {
    const { deps, calls } = harness({ verify: async () => { calls.push("verify"); return { kind: "not_signed_in" }; } });
    await expectRefusal(await call(deps));
    expect(calls).toEqual(["parse", "verify"]);
  });

  it("answers the host's 503 for an unavailable provider", async () => {
    const { deps } = harness({ verify: async () => { throw new HostLoginError("LOGIN_UNAVAILABLE"); } });
    await expectRefusal(await call(deps), { status: 503, code: "LOGIN_UNAVAILABLE" });
  });

  it("fails closed on an unexpected error: the fixed 401, never a 500 or upstream text", async () => {
    const { deps } = harness({ verify: async () => { throw new TypeError("token endpoint said client_secret=s3cr3t"); } });
    const response = await call(deps);
    await expectRefusal(response);
  });

  it("fails closed when mounted without request facts, before any counter", async () => {
    const ip = limiter();
    const { deps, calls } = harness({ ipLimiter: ip });
    await expectRefusal(await call(deps, raw(BODY, null)));
    expect(ip.keys).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("keeps the proof clear on the refusal when the session cookie cannot be written", async () => {
    const { deps, calls } = harness();
    const verify = deps.verify;
    deps.verify = async (input) => ({ ...(await verify(input)), sessionCookie: () => { throw new RangeError("option expires is invalid"); } }) as Awaited<ReturnType<typeof verify>>;
    await expectRefusal(await call(deps), { cookies: [PROOF_CLEAR] });
    expect(calls).not.toContain("announce");
  });

  it("keeps both decided cookies, in order, on the refusal when the member answer fails", async () => {
    const { deps } = harness();
    const verify = deps.verify;
    deps.verify = async (input) => ({ ...(await verify(input)), member: () => { throw new Error("projection failed"); } }) as Awaited<ReturnType<typeof verify>>;
    await expectRefusal(await call(deps), { cookies: [PROOF_CLEAR, SESSION] });
  });
});
