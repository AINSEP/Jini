import { describe, expect, it } from "vitest";
import { ok, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { memberMeRoute, type MemberMeRouteDeps } from "../me.js";
import { memberLoginProvidersRoute, type MemberLoginProvidersRouteDeps } from "../login-providers.js";

/** @file The public member identity reads: `/me` (never cached, current status enforced) and the
 * safe sign-in provider list; every failure is the host's refusal. */

const signal = new AbortController().signal;
const raw = (headers: Record<string, string> = {}): RouteInputContext => ({ body: undefined, query: {}, params: { workspaceId: "ws-1" }, headers });
async function call<D>(route: { parse: (raw: RouteInputContext) => unknown; handle: (...args: never[]) => unknown }, deps: D, input: RouteInputContext) {
  const parsed = route.parse(input) as { ok: true; value: unknown };
  return (route.handle as (r: unknown, o: unknown) => Promise<unknown>)({ input: parsed.value, deps, raw: input, context: undefined, authorize: async () => {} }, { signal });
}
const refusal = { status: 401, body: { error: "member login failed", code: "LOGIN_INVALID" } };

describe("memberMeRoute", () => {
  type Member = { id: string; status: string };
  const deps = (member: Member | null, over: Partial<MemberMeRouteDeps<Member>> = {}): MemberMeRouteDeps<Member> => ({
    workspaceId: "ws-1", refusalFor: () => undefined,
    readSessionToken: ({ cookieHeader }) => cookieHeader?.match(/member=([^;]*)/)?.[1],
    resolveMemberId: async ({ sessionToken }) => sessionToken === "tok" ? "m-1" : null,
    findMember: async ({ id }) => member && member.id === id ? member : null,
    toPublicMember: ({ member: m }) => ({ public: m.id }),
    listPublicIdentities: async ({ memberId }) => [{ providerId: "google", label: `G ${memberId}` }], ...over });

  it("pins method, path, the cookie header and no-store", () => {
    expect(memberMeRoute.method).toBe("get");
    expect(memberMeRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/me");
    expect(memberMeRoute.readHeaders).toEqual(["cookie"]);
    expect(memberMeRoute.responseHeaders).toEqual({ "Cache-Control": "no-store" });
  });
  it("answers an active or pending member with its identities", async () => {
    for (const status of ["active", "pending"]) {
      expect(await call(memberMeRoute, deps({ id: "m-1", status }), raw({ cookie: "member=tok" })))
        .toEqual(ok({ value: { member: { public: "m-1" }, identities: [{ providerId: "google", label: "G m-1" }] } }));
    }
  });
  it("answers a null member with no identities for no session, a missing row or another status", async () => {
    let listed = false;
    const none = ok({ value: { member: null, identities: [] } });
    const over = { listPublicIdentities: async () => { listed = true; return []; } };
    expect(await call(memberMeRoute, deps({ id: "m-1", status: "active" }, over), raw())).toEqual(none);
    expect(await call(memberMeRoute, deps(null, over), raw({ cookie: "member=tok" }))).toEqual(none);
    expect(await call(memberMeRoute, deps({ id: "m-1", status: "disabled" }, over), raw({ cookie: "member=tok" }))).toEqual(none);
    expect(listed).toBe(false);
  });
  it("throws the host refusal for a known failure and rethrows the unexpected", async () => {
    const boom = new Error("dup");
    const reader = { readSessionToken: () => { throw boom; } };
    await expect(call(memberMeRoute, deps(null, { ...reader, refusalFor: () => refusal }), raw())).rejects.toEqual(new RouteRefusalError(refusal));
    await expect(call(memberMeRoute, deps(null, reader), raw())).rejects.toBe(boom);
  });
});

describe("memberLoginProvidersRoute", () => {
  const deps = (over: Partial<MemberLoginProvidersRouteDeps> = {}): MemberLoginProvidersRouteDeps => ({
    workspaceId: "ws-1", refusalFor: () => refusal,
    listProviders: async () => [{ id: "google", label: "Google", secret: "s" } as { id: string; label: string }], ...over });

  it("pins method, path and the no-store, no-referrer headers", () => {
    expect(memberLoginProvidersRoute.method).toBe("get");
    expect(memberLoginProvidersRoute.path).toBe("/api/members/v1/workspaces/:workspaceId/login-providers");
    expect(memberLoginProvidersRoute.responseHeaders).toEqual({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  });
  it("answers only each provider's id and label", async () => {
    expect(await call(memberLoginProvidersRoute, deps(), raw())).toEqual(ok({ value: { providers: [{ id: "google", label: "Google" }] } }));
  });
  it("answers every failure with the host refusal", async () => {
    await expect(call(memberLoginProvidersRoute, deps({ listProviders: async () => { throw new Error("x"); } }), raw())).rejects.toEqual(new RouteRefusalError(refusal));
  });
});
