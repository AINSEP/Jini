import { describe, expect, it } from "vitest";
import { IdentityValidationError, OwnerRequiredError } from "../../../core/types.js";
import { answerOwnerPasskeyFailure, ownerPasskeySite, resolveOwnerPasskeyRouteDeps } from "../passkey-route-deps.js";
import { ownerPasskeyActionRoute, ownerPasskeyStatusRoute } from "../passkey-routes.js";

type Admission = Parameters<typeof ownerPasskeyActionRoute>[0]["admission"];
type Deps = Awaited<ReturnType<Admission["passkeyDeps"]>>;
const SITE = "https://site.example";

/** A strict admission: every effect is recorded in order; services record the exact input they get. */
function admission(overrides: Partial<Admission> = {}, listed: Array<{ id: string; secret?: string }> = []) {
  const events: unknown[] = [];
  const lists: unknown[] = [];
  const deps = { site: { origin: SITE }, mfa: { seededOwnerPrincipalId: "owner" },
    credentials: { list: async (input: unknown) => { lists.push(input); return listed; } } } as unknown as Deps;
  const service = (name: string, result: unknown) => async ({ input }: { input: unknown }) => { events.push([name, input]); return result as never; };
  const value: Admission = {
    workspaceId: "ws", passkeyDeps: async () => deps,
    authenticate: async () => ({ kind: "session", principal: { id: "owner" } }), ownerPrincipalId: async () => "owner",
    isJson: () => true, fetchSite: () => "same-origin", origin: () => SITE, body: () => ({}), byteCount: () => 10,
    rate: async () => ({ allowed: true }), noStore: () => { events.push("no-store"); }, retryAfter: (v) => { events.push(["retry-after", v]); },
    json: (body, status) => { events.push(["json", body, status]); }, empty: () => { events.push("empty"); },
    failure: (error) => { events.push(["failure", error]); }, signedIn: async (result) => { events.push(["signed-in", result]); },
    services: {
      beginOwnerPasskeyEnrollment: service("enroll", { pendingToken: "t" }), confirmOwnerPasskeyEnrollment: service("confirm", undefined),
      beginOwnerPasskeyLogin: service("begin-login", { pendingToken: "t" }), completeOwnerPasskeyLogin: service("login", { session: "s" }),
      removeOwnerPasskey: service("remove", undefined),
    },
    copy: { ownerRequired: "Only the owner.", origin: "Wrong origin.", tooLarge: "Too large.", rate: "Slow down." },
    ...overrides,
  };
  return { value, events, lists };
}
const expectedInput = (body: Record<string, string>) => ({ workspaceId: "ws", principalId: "owner", password: "", code: "", pendingToken: "", id: "", response: undefined, ...body });

describe("ownerPasskeyActionRoute", () => {
  it("confirm and remove pass only string body fields to the service and answer empty; login signs in with the result", async () => {
    const body = { password: "pw", code: 123456, pendingToken: "pending", response: { raw: 1 }, id: "cred-1" };
    for (const action of ["confirm", "remove"] as const) {
      const a = admission({ body: () => body });
      await ownerPasskeyActionRoute({ admission: a.value, action });
      expect(a.events).toEqual(["no-store", [action, { ...expectedInput({ password: "pw", pendingToken: "pending", id: "cred-1" }), response: { raw: 1 } }], "empty"]);
    }
    const login = admission({ authenticate: async () => null });
    await ownerPasskeyActionRoute({ admission: login.value, action: "login" });
    expect(login.events).toEqual(["no-store", ["login", expectedInput({})], ["signed-in", { session: "s" }]]);
  });

  it("refuses a non-JSON or cross-site request with the origin refusal before any service", async () => {
    for (const overrides of [{ isJson: () => false }, { fetchSite: () => "cross-site" }]) {
      const a = admission(overrides);
      await ownerPasskeyActionRoute({ admission: a.value, action: "enroll" });
      expect(a.events).toEqual(["no-store", ["json", { error: "Wrong origin.", code: "PASSKEY_ORIGIN_REFUSED" }, 403]]);
    }
  });

  it("answers a refused rate with Retry-After and 429, before admission or any service", async () => {
    let authenticated = 0;
    const a = admission({ rate: async () => ({ allowed: false, retryAfterSeconds: 30 }), authenticate: async () => { authenticated += 1; return null; } });
    await ownerPasskeyActionRoute({ admission: a.value, action: "enroll" });
    expect(a.events).toEqual(["no-store", ["retry-after", "30"], ["json", { error: "Slow down.", code: "RATE_LIMIT_EXCEEDED" }, 429]]);
    expect(authenticated).toBe(0);
  });

  it("refuses management by anyone but the owner's session: no caller, another principal or a non-session credential", async () => {
    const callers = [null, { kind: "session", principal: { id: "editor" } }, { kind: "api-key", principal: { id: "owner" } }];
    for (const caller of callers) {
      const a = admission({ authenticate: async () => caller });
      await ownerPasskeyActionRoute({ admission: a.value, action: "remove" });
      const [, failure] = a.events as [string, [string, unknown]];
      expect(a.events).toHaveLength(2);
      expect(failure[1]).toBeInstanceOf(OwnerRequiredError);
      expect((failure[1] as Error).message).toBe("Only the owner.");
    }
  });

  it("hands a deps failure to the failure answer", async () => {
    const boom = new Error("store down");
    const a = admission({ passkeyDeps: async () => { throw boom; } });
    await ownerPasskeyActionRoute({ admission: a.value, action: "enroll" });
    expect(a.events).toEqual(["no-store", ["failure", boom]]);
  });
});

describe("ownerPasskeyStatusRoute", () => {
  it("lists only public credential ids for the owner's session and reports a store failure", async () => {
    const a = admission({}, [{ id: "c1", secret: "x" }, { id: "c2" }]);
    await ownerPasskeyStatusRoute({ admission: a.value });
    expect(a.lists).toEqual([{ workspaceId: "ws", principalId: "owner" }]);
    expect(a.events).toEqual(["no-store", ["json", { isOwner: true, credentials: [{ id: "c1" }, { id: "c2" }] }, undefined]]);
    const boom = new Error("list failed");
    const failing = admission({ passkeyDeps: async () => { throw boom; } });
    await ownerPasskeyStatusRoute({ admission: failing.value });
    expect(failing.events).toEqual(["no-store", ["failure", boom]]);
  });
});

describe("passkey route deps", () => {
  const copy = { unavailable: "Passkeys are unavailable.", insecure: "Passkeys need HTTPS." };
  it("refuses without any configured origin and over plain HTTP off localhost; keeps a configured localhost port", () => {
    expect(() => ownerPasskeySite({ deps: {}, name: "Site", copy })).toThrow(new IdentityValidationError({ message: "Passkeys are unavailable." }));
    expect(() => ownerPasskeySite({ deps: { derivedPublicOrigin: "http://site.example" }, name: "Site", copy })).toThrow("Passkeys need HTTPS.");
    expect(ownerPasskeySite({ deps: { passkeyOrigin: "http://localhost:3000" }, localPort: 4000, name: "Site", copy })).toEqual({ origin: "http://localhost:3000", rpId: "localhost", name: "Site" });
    expect(ownerPasskeySite({ deps: { derivedPublicOrigin: "http://localhost:3000" }, name: "Site", copy }).origin).toBe("http://localhost:3000");
  });

  it("refuses when the site has no credential store, before reading MFA", async () => {
    let mfaReads = 0;
    await expect(resolveOwnerPasskeyRouteDeps({ store: () => undefined, mfa: async () => { mfaReads += 1; return {} as Deps["mfa"]; }, webauthn: () => ({}) as Deps["webauthn"],
      site: { deps: { passkeyOrigin: SITE }, name: "Site", copy }, unavailableMessage: "No passkey store." })).rejects.toThrow(new IdentityValidationError({ message: "No passkey store." }));
    expect(mfaReads).toBe(0);
  });

  it("answers expected refusals as PASSKEY_REFUSED (owner 403, validation 400) and routes anything else to the incident", () => {
    const answers: unknown[] = [];
    const incidents: unknown[] = [];
    const incidentOptions = { operation: "passkey.enroll", code: "PASSKEY_FAILED", message: "Failed.", failure: { step: "enroll", action: "retry" } };
    const answer = (error: unknown) => answerOwnerPasskeyFailure({ error, operation: "enroll", incidentOptions,
      json: (body, status) => { answers.push([body, status]); }, incident: (err, options) => { incidents.push([err, options]); } });
    answer(new OwnerRequiredError({ message: "Owner only." }));
    answer(new IdentityValidationError({ message: "Bad proof." }));
    const unexpected = new Error("db down");
    answer(unexpected);
    expect(answers).toEqual([[{ error: "Owner only.", code: "PASSKEY_REFUSED", details: { operation: "enroll" } }, 403],
      [{ error: "Bad proof.", code: "PASSKEY_REFUSED", details: { operation: "enroll" } }, 400]]);
    expect(incidents).toEqual([[unexpected, incidentOptions]]);
  });
});

describe("createOwnerPasskeyAdmission", () => {
  it("forwards each transport call with the request, response and host it was created for", async () => {
    const { createOwnerPasskeyAdmission } = await import("../passkey-admission.js");
    const calls: Array<[string, unknown]> = [];
    const rec = (name: string, result?: unknown) => (args: unknown) => { calls.push([name, args]); return result; };
    const host = { id: "host" }; const req = { id: "req" }; const res = { id: "res" };
    const required = { workspaceId: () => "ws", header: ({ name }: { name: string }) => `${name}-value`, retryAfter: rec("retryAfter"), json: rec("json"),
      empty: rec("empty"), rate: rec("rate", { allowed: true }), byteCount: rec("byteCount", 4), body: rec("body", {}), isJson: rec("isJson", true),
      ownerPrincipalId: rec("ownerPrincipalId", "owner"), noStore: rec("noStore"), signedIn: rec("signedIn"), services: {}, copy: {} };
    const a = createOwnerPasskeyAdmission({ required: required as unknown as Parameters<typeof createOwnerPasskeyAdmission<object, object, object>>[0]["required"], host, req, res });
    expect([a.workspaceId, a.fetchSite(), a.origin(), a.byteCount(), a.isJson()]).toEqual(["ws", "sec-fetch-site-value", "origin-value", 4, true]);
    a.retryAfter("12"); a.json({ ok: 1 }, 418); a.json({ ok: 2 }); a.empty(); a.noStore();
    await a.rate(); await a.ownerPrincipalId(); await a.signedIn({ sessionToken: "s" } as unknown as Parameters<typeof a.signedIn>[0]);
    expect(calls).toEqual([["byteCount", { req }], ["isJson", { req }], ["retryAfter", { res, value: "12" }], ["json", { res, value: { ok: 1 }, status: 418 }],
      ["json", { res, value: { ok: 2 } }], ["empty", { res }], ["noStore", { res }], ["rate", { host, req }], ["ownerPrincipalId", { host }],
      ["signedIn", { host, req, res, result: { sessionToken: "s" } }]]);
  });
});
