import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { memberSignOutRoute, type MemberSignOutRouteDeps } from "../sign-out.js";

/** @file The public member sign-out spec: revokes only a live presented session, always clears the
 * host's cookie with a bare 204, maps the host's credential refusals and rethrows anything else. */

const signal = new AbortController().signal;
const CLEARED = "member=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

type Session = { id: string; revokedAt?: string | null };

/** Recording fakes over one stored session; every field is the host's. */
function harness({ session = null as Session | null, refusal = undefined as { status: number; body: unknown } | undefined } = {}) {
  const calls = { lookups: [] as unknown[], revokes: [] as unknown[], cookieHeaders: [] as (string | undefined)[] };
  const deps: MemberSignOutRouteDeps = {
    workspaceId: "ws-1",
    clock: { nowMs: () => Date.parse("2026-11-23T10:00:00.000Z") },
    sessions: {
      findByTokenHash: async (input) => { calls.lookups.push(input); return session; },
      revoke: async (input) => { calls.revokes.push(input); },
    },
    hashToken: ({ rawToken }) => `hash(${rawToken})`,
    readSessionToken: ({ cookieHeader }) => { calls.cookieHeaders.push(cookieHeader); return cookieHeader?.match(/member=([^;]*)/)?.[1]; },
    clearedSessionCookie: () => CLEARED,
    refusalFor: () => refusal,
  };
  return { deps, calls };
}

/** Run the handler with the opted-in headers only, as the raw mount does. */
function run(deps: MemberSignOutRouteDeps, headers: Record<string, string> = {}) {
  return memberSignOutRoute.handle({ raw: { body: {}, query: {}, params: { workspaceId: "ws-1" }, headers }, deps }, { signal });
}

describe("memberSignOutRoute", () => {
  it("pins method, path and the one header it reads", () => {
    expect(memberSignOutRoute.method).toBe("post");
    expect(memberSignOutRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/sign-out");
    expect(memberSignOutRoute.readHeaders).toEqual(["cookie"]);
    expect(memberSignOutRoute.requestFacts).toBeUndefined();
  });

  it("revokes a live presented session at the host clock and answers a bare 204 that clears the cookie", async () => {
    const { deps, calls } = harness({ session: { id: "s-1", revokedAt: null } });
    const response = await run(deps, { cookie: "member=raw-1" });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([CLEARED]);
    expect(calls.cookieHeaders).toEqual(["member=raw-1"]);
    expect(calls.lookups).toEqual([{ workspaceId: "ws-1", tokenHash: "hash(raw-1)" }]);
    expect(calls.revokes).toEqual([{ workspaceId: "ws-1", id: "s-1", revokedAt: "2026-11-23T10:00:00.000Z" }]);
  });

  it("is idempotent: an already-revoked session is not revoked again, and still clears the cookie", async () => {
    const { deps, calls } = harness({ session: { id: "s-1", revokedAt: "2026-11-01T00:00:00.000Z" } });
    const response = await run(deps, { cookie: "member=raw-1" });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([CLEARED]);
    expect(calls.revokes).toEqual([]);
  });

  it("an absent cookie never reaches the repository and still answers 204", async () => {
    const { deps, calls } = harness({ session: { id: "s-1" } });
    const response = await run(deps);
    expect(response.status).toBe(204);
    expect(calls.cookieHeaders).toEqual([undefined]);
    expect(calls.lookups).toEqual([]);
    expect(calls.revokes).toEqual([]);
  });

  it("an unknown token answers 204 without a revoke", async () => {
    const { deps, calls } = harness({ session: null });
    expect((await run(deps, { cookie: "member=nope" })).status).toBe(204);
    expect(calls.lookups).toHaveLength(1);
    expect(calls.revokes).toEqual([]);
  });

  it("a host credential refusal becomes that exact refusal (flat body, host status)", async () => {
    const refusal = { status: 401, body: { error: "invalid credentials", code: "INVALID_CREDENTIALS" } };
    const { deps } = harness({ refusal });
    deps.sessions.findByTokenHash = async () => { throw new Error("credential"); };
    const error = await run(deps, { cookie: "member=raw-1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RouteRefusalError);
    expect((error as RouteRefusalError).response).toEqual(refusal);
  });

  it("an unmapped failure is rethrown unchanged for the host 500, and no cookie answer is built", async () => {
    const { deps, calls } = harness({ session: { id: "s-1" } });
    const boom = new Error("database down");
    deps.sessions.revoke = async () => { throw boom; };
    let cleared = 0;
    deps.clearedSessionCookie = () => { cleared += 1; return CLEARED; };
    await expect(run(deps, { cookie: "member=raw-1" })).rejects.toBe(boom);
    expect(cleared).toBe(0);
    expect(calls.lookups).toHaveLength(1);
  });
});
