import { describe, expect, it } from "vitest";
import { redirectCreateRoute } from "../create.js";
import { makeWriteDeps, MANAGE, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (body?: unknown, params: Record<string, string> = {}) => ({ body, query: {}, params });
const VALID = { matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 301 };
const flat = (error: string) => ({ status: 400, body: { error, code: "VALIDATION_ERROR" } });

/** `context: null` means no session (an explicit `undefined` would just pick the default principal). */
const call = (input: Parameters<typeof redirectCreateRoute.handle>[0]["input"], redirectsWriteDeps: ReturnType<typeof makeWriteDeps>, context: { id: string } | null = PRINCIPAL) =>
  redirectCreateRoute.handle({ input, deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps }, context: context ?? undefined, authorize: recordingAuthorize().authorize }, { signal });
const input = (overrides: Record<string, unknown> = {}) => ({ ...VALID, override: undefined, priority: undefined, ...overrides }) as Parameters<typeof call>[0];

describe("redirectCreateRoute", () => {
  it("POSTs to the redirects collection, answers 201 and has no body cap of its own", () => {
    expect(redirectCreateRoute.method).toBe("post");
    expect(redirectCreateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/redirects");
    expect(redirectCreateRoute.successStatus).toBe(201);
    expect(redirectCreateRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the five body fields; override and priority are kept only with the right primitive type", () => {
    expect(redirectCreateRoute.parse(raw({ ...VALID, override: true, priority: 7, extra: "dropped" }))).toEqual({ ok: true, value: { ...VALID, override: true, priority: 7 } });
    expect(redirectCreateRoute.parse(raw({ ...VALID, override: "yes", priority: "9" }))).toEqual({ ok: true, value: { ...VALID, override: undefined, priority: undefined } });
    expect(redirectCreateRoute.parse(raw({ ...VALID, matchType: "regex", statusCode: 308 }))).toEqual({ ok: true, value: { ...VALID, matchType: "regex", statusCode: 308, override: undefined, priority: undefined } });
  });

  it("refuses a missing or unknown matchType, flat 400 VALIDATION_ERROR, including a missing body", async () => {
    const message = "matchType must be one of exact/prefix/wildcard/regex";
    expect(await refusalOf(() => redirectCreateRoute.parse(raw(undefined)))).toEqual(flat(message));
    expect(await refusalOf(() => redirectCreateRoute.parse(raw(null)))).toEqual(flat(message));
    expect(await refusalOf(() => redirectCreateRoute.parse(raw({ ...VALID, matchType: "glob" })))).toEqual(flat(message));
  });

  it("refuses a non-string fromPattern or toTarget", async () => {
    const message = "fromPattern and toTarget are required strings";
    expect(await refusalOf(() => redirectCreateRoute.parse(raw({ ...VALID, fromPattern: 5 })))).toEqual(flat(message));
    expect(await refusalOf(() => redirectCreateRoute.parse(raw({ ...VALID, toTarget: undefined })))).toEqual(flat(message));
  });

  it("refuses a statusCode outside 301/302/307/308 (a numeric string is not a number)", async () => {
    const message = "statusCode must be one of 301/302/307/308";
    for (const statusCode of [200, "301", undefined, 303]) {
      expect(await refusalOf(() => redirectCreateRoute.parse(raw({ ...VALID, statusCode })))).toEqual(flat(message));
    }
  });

  it("checks matchType, then the strings, then statusCode, so a body wrong in several ways names the first", async () => {
    expect(await refusalOf(() => redirectCreateRoute.parse(raw({ matchType: "x", fromPattern: 1, statusCode: 1 })))).toEqual(flat("matchType must be one of exact/prefix/wildcard/regex"));
    expect(await refusalOf(() => redirectCreateRoute.parse(raw({ ...VALID, fromPattern: 1, statusCode: 1 })))).toEqual(flat("fromPattern and toTarget are required strings"));
  });

  it("asks the manage permission on the redirect entity type with no entity id (create acts on no single rule)", async () => {
    const { authorize, calls } = recordingAuthorize();
    await redirectCreateRoute.handle({ input: input(), deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps: makeWriteDeps() }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([MANAGE]);
  });

  it("a refused authorization creates nothing", async () => {
    const redirectsWriteDeps = makeWriteDeps();
    await expect(redirectCreateRoute.handle({ input: input(), deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps }, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } }, { signal })).rejects.toThrow("denied");
    expect(await redirectsWriteDeps.repo.findById({ workspaceId: WORKSPACE_ID, id: "redirect-1" })).toBeNull();
  });

  it("creates the rule through the injected chokepoint as the principal and answers its DTO", async () => {
    const redirectsWriteDeps = makeWriteDeps();
    const result = await call(input({ override: true, priority: 4 }), redirectsWriteDeps);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.data).toMatchObject({
      id: "redirect-1", workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 301,
      override: true, priority: 4, createdByPrincipal: PRINCIPAL.id, source: "manual",
    });
    expect(await redirectsWriteDeps.repo.findById({ workspaceId: WORKSPACE_ID, id: "redirect-1" })).not.toBeNull();
  });

  it("maps the chokepoint's errors to the same status/code pairs (a regex rule is a chokepoint validation, not a shape refusal)", async () => {
    expect(await refusalOf(() => call(input({ matchType: "regex" }), makeWriteDeps()))).toMatchObject({ status: 400, body: { code: "REDIRECT_VALIDATION_ERROR" } });
    expect(await refusalOf(() => call(input({ fromPattern: "/loop", toTarget: "/loop" }), makeWriteDeps()))).toMatchObject({ status: 409, body: { code: "REDIRECT_LOOP_DETECTED" } });
    const taken = makeWriteDeps();
    await call(input(), taken);
    expect(await refusalOf(() => call(input({ toTarget: "/elsewhere" }), taken))).toMatchObject({ status: 409, body: { code: "REDIRECT_CONFLICT" } });
  });

  it("lets an unexpected failure through unmapped so the host answers its redacted 500", async () => {
    const redirectsWriteDeps = makeWriteDeps();
    redirectsWriteDeps.idGen = { newId: () => { throw new Error("id source down"); } };
    await expect(call(input(), redirectsWriteDeps)).rejects.toThrow("id source down");
  });

  it("fails closed without a principal or an authorizer (wiring bugs, not caller errors)", async () => {
    await expect(call(input(), makeWriteDeps(), null)).rejects.toThrow(/no authenticated principal/);
    await expect(redirectCreateRoute.handle({ input: input(), deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps: makeWriteDeps() }, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
  });
});
