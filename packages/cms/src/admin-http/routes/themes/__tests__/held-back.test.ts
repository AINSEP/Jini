import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { describe, expect, it } from "vitest";

import {
  HELD_BACK_ERROR_STATUS, heldBackApprovalRoute, heldBackCheckRoute, heldBackListRoute, heldBackRestoreRoute,
  type HeldBackErrorCode, type HeldBackFailureDeps,
} from "../held-back.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal } from "./helpers.js";

/** Stand-ins for the host's two error families; the specs only see them through the injected recognizers. */
class FakeServiceError extends Error {
  constructor(readonly code: HeldBackErrorCode, readonly problems?: readonly string[]) { super(`service ${code}`); }
}
class FakeGatewayError extends Error {
  constructor(readonly status: number, readonly code: string) { super(`gateway ${code}`); }
}

const failures: HeldBackFailureDeps = {
  heldBackFailure: ({ err }) => (err instanceof FakeServiceError ? { code: err.code, message: err.message, problems: err.problems } : undefined),
  gatewayFailure: ({ err }) => (err instanceof FakeGatewayError ? { status: err.status, code: err.code, message: err.message } : undefined),
};

const ctx = { id: "principal-1", kind: "session" };
const checkRoute = heldBackCheckRoute<typeof ctx>();
const approvalRoute = heldBackApprovalRoute<typeof ctx>();
const restoreRoute = heldBackRestoreRoute<typeof ctx>();
const BASE = "/api/admin/v1/workspaces/:workspaceId/held-back-themes";
const READ = { permission: "theme.set", entityType: "theme" };
const WRITE = { permission: "theme.edit", entityType: "theme" };

/** Run `fn` and return whatever it throws, unchanged. */
async function refusalOrError(fn: () => unknown): Promise<unknown> {
  try { await fn(); } catch (error) { return error; }
  throw new Error("expected a throw");
}

describe("route shapes", () => {
  it("keeps every method and path, and only restore answers 201", () => {
    expect([heldBackListRoute.method, heldBackListRoute.path]).toEqual(["get", BASE]);
    expect([checkRoute.method, checkRoute.path]).toEqual(["post", `${BASE}/check`]);
    expect([approvalRoute.method, approvalRoute.path]).toEqual(["post", `${BASE}/restore/approval`]);
    expect([restoreRoute.method, restoreRoute.path]).toEqual(["post", `${BASE}/restore`]);
    expect(restoreRoute.successStatus).toBe(201);
    for (const spec of [heldBackListRoute, checkRoute, approvalRoute]) expect(spec.successStatus).toBeUndefined();
  });

  it("parses bodies leniently: missing, null and non-object bodies read as empty fields", () => {
    expect(checkRoute.parse(raw({}, { themeId: "static/a" }))).toEqual({ ok: true, value: { themeId: "static/a" } });
    expect(checkRoute.parse(raw({}, null))).toEqual({ ok: true, value: { themeId: "" } });
    expect(approvalRoute.parse(raw({}, { decision: "approve", planId: "p", planHash: 7 }))).toEqual({ ok: true, value: { decision: "approve", planId: "p", planHash: "" } });
    expect(restoreRoute.parse(raw({}, { themeId: "t", approvedDigest: "d", confirmationToken: "k" }))).toEqual({ ok: true, value: { themeId: "t", approvedDigest: "d", confirmationToken: "k" } });
    expect(restoreRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { themeId: "", approvedDigest: "", confirmationToken: "" } });
  });
});

describe("heldBackListRoute", () => {
  it("authorizes theme.set on theme, then answers the host's listing", async () => {
    const { authorize, calls } = recordingAuthorize();
    const listing = { themes: [{ id: "static/a" }], chosenThemeHeldBack: null };
    const result = await heldBackListRoute.handle({ input: undefined, deps: { ...failures, listHeldBack: () => listing }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([READ]);
    expect(result).toEqual({ ok: true, value: listing });
  });

  it("lists nothing when the permission is denied", async () => {
    let listed = 0;
    const { authorize } = recordingAuthorize(["theme.set"]);
    await expect(heldBackListRoute.handle({ input: undefined, deps: { ...failures, listHeldBack: () => { listed += 1; return { themes: [], chosenThemeHeldBack: null }; } }, context: PRINCIPAL, authorize }, { signal })).rejects.toThrow("denied theme.set");
    expect(listed).toBe(0);
  });
});

describe("heldBackCheckRoute", () => {
  function deps(order: string[], check: { passes: boolean; digest?: string | null }) {
    return {
      ...failures,
      checkTheme: ({ themeId }: { themeId: string }) => { order.push("check"); return { themeId, ...check, problems: [] }; },
      planRestore: async (r: { principal: typeof ctx; themeId: string; digest: string }) => { order.push(`plan:${r.principal.id}:${r.themeId}:${r.digest}`); return { planId: "p1", planHash: "h1", extra: "dropped" }; },
    };
  }

  it("checks permission before touching the host check", async () => {
    const order: string[] = [];
    const { authorize } = recordingAuthorize(["theme.set"]);
    await expect(checkRoute.handle({ input: { themeId: "t" }, deps: deps(order, { passes: true, digest: "d" }), context: ctx, authorize }, { signal })).rejects.toThrow("denied theme.set");
    expect(order).toEqual([]);
  });

  it("plans only for a passing check with a digest, answering just the plan's id and hash", async () => {
    const order: string[] = [];
    const { authorize, calls } = recordingAuthorize();
    const result = await checkRoute.handle({ input: { themeId: "t" }, deps: deps(order, { passes: true, digest: "d" }), context: ctx, authorize }, { signal });
    expect(calls).toEqual([READ]);
    expect(order).toEqual(["check", "plan:principal-1:t:d"]);
    expect(result).toEqual({ ok: true, value: { themeId: "t", passes: true, digest: "d", problems: [], approval: { planId: "p1", planHash: "h1" } } });
  });

  it.each([{ passes: false, digest: "d" }, { passes: true, digest: null }, { passes: true }])("plans nothing for %j", async (check) => {
    const order: string[] = [];
    const result = await checkRoute.handle({ input: { themeId: "t" }, deps: deps(order, check), context: ctx, authorize: recordingAuthorize().authorize }, { signal });
    expect(order).toEqual(["check"]);
    expect(result.ok && result.value.approval).toBeNull();
  });

  it("answers a service refusal with its status and flat body, CHECK_FAILED carrying the problems", async () => {
    const failing = { ...deps([], { passes: true }), checkTheme: () => { throw new FakeServiceError("CHECK_FAILED", ["a", "b"]); } };
    expect(await refusalOf(() => checkRoute.handle({ input: { themeId: "t" }, deps: failing, context: ctx, authorize: recordingAuthorize().authorize }, { signal }))).toEqual({
      status: 409, body: { code: "CHECK_FAILED", error: "service CHECK_FAILED", problems: ["a", "b"] },
    });
  });

  it("refuses a missing principal after the permission check, only when a plan is needed", async () => {
    await expect(checkRoute.handle({ input: { themeId: "t" }, deps: deps([], { passes: true, digest: "d" }), context: undefined, authorize: recordingAuthorize().authorize }, { signal })).rejects.toThrow("no authenticated principal");
  });
});

describe("heldBackApprovalRoute", () => {
  function deps(order: string[]) {
    return { ...failures, confirmRestore: async (r: { principal: typeof ctx; planId: string; planHash: string }) => { order.push(`confirm:${r.principal.id}:${r.planId}:${r.planHash}`); return { confirmationToken: "tok-1" }; } };
  }
  const input = (over: Record<string, unknown> = {}) => ({ decision: "approve" as unknown, planId: "p1", planHash: "h1", ...over });

  it("checks theme.edit before the decision is read", async () => {
    const order: string[] = [];
    const { authorize } = recordingAuthorize(["theme.edit"]);
    await expect(approvalRoute.handle({ input: input({ decision: "decline" }), deps: deps(order), context: ctx, authorize }, { signal })).rejects.toThrow("denied theme.edit");
    expect(order).toEqual([]);
  });

  it("mints a token only for an explicit approve", async () => {
    const order: string[] = [];
    const { authorize, calls } = recordingAuthorize();
    const result = await approvalRoute.handle({ input: input(), deps: deps(order), context: ctx, authorize }, { signal });
    expect(calls).toEqual([WRITE]);
    expect(order).toEqual(["confirm:principal-1:p1:h1"]);
    expect(result).toEqual({ ok: true, value: { approved: true, confirmationToken: "tok-1" } });
  });

  it.each(["decline", "APPROVE", true, undefined, null])("mints nothing for decision %j", async (decision) => {
    const order: string[] = [];
    const result = await approvalRoute.handle({ input: input({ decision }), deps: deps(order), context: ctx, authorize: recordingAuthorize().authorize }, { signal });
    expect(order).toEqual([]);
    expect(result).toEqual({ ok: true, value: { approved: false } });
  });

  it.each([{ planId: "" }, { planHash: "" }])("refuses an approve with %j as APPROVAL_REQUIRED, minting nothing", async (missing) => {
    const order: string[] = [];
    expect(await refusalOf(() => approvalRoute.handle({ input: input(missing), deps: deps(order), context: ctx, authorize: recordingAuthorize().authorize }, { signal }))).toEqual({
      status: 400, body: { code: "APPROVAL_REQUIRED", error: "Approve restoring this theme on the approval card first." },
    });
    expect(order).toEqual([]);
  });

  it("maps the gateway's refusals to their status and code", async () => {
    const forbidden = { ...deps([]), confirmRestore: async () => { throw new FakeGatewayError(403, "AGENT_CANNOT_CONFIRM"); } };
    expect(await refusalOf(() => approvalRoute.handle({ input: input(), deps: forbidden, context: ctx, authorize: recordingAuthorize().authorize }, { signal }))).toEqual({
      status: 403, body: { code: "AGENT_CANNOT_CONFIRM", error: "gateway AGENT_CANNOT_CONFIRM" },
    });
  });
});

describe("heldBackRestoreRoute", () => {
  const input = (over: Record<string, string> = {}) => ({ themeId: "t", approvedDigest: "d", confirmationToken: "tok-1", ...over });
  function deps(order: string[], redeemed = new Set<string>()) {
    return {
      ...failures,
      restoreTheme: async (r: { principal: typeof ctx; themeId: string; approvedDigest: string; confirmationToken: string }) => {
        order.push(`restore:${r.principal.id}:${r.themeId}:${r.approvedDigest}:${r.confirmationToken}`);
        if (redeemed.has(r.confirmationToken)) throw new FakeGatewayError(409, "TOKEN_ALREADY_REDEEMED");
        redeemed.add(r.confirmationToken);
        return { restored: r.themeId };
      },
      refreshPreviews: () => { order.push("refresh"); },
    };
  }

  it("checks theme.edit before the digest or token is read", async () => {
    const order: string[] = [];
    const { authorize } = recordingAuthorize(["theme.edit"]);
    await expect(restoreRoute.handle({ input: input({ confirmationToken: "" }), deps: deps(order), context: ctx, authorize }, { signal })).rejects.toThrow("denied theme.edit");
    expect(order).toEqual([]);
  });

  it("redeems the token, then refreshes previews, then answers the move's result", async () => {
    const order: string[] = [];
    const { authorize, calls } = recordingAuthorize();
    const result = await restoreRoute.handle({ input: input(), deps: deps(order), context: ctx, authorize }, { signal });
    expect(calls).toEqual([WRITE]);
    expect(order).toEqual(["restore:principal-1:t:d:tok-1", "refresh"]);
    expect(result).toEqual({ ok: true, value: { restored: "t" } });
  });

  it.each([{ approvedDigest: "" }, { confirmationToken: "" }])("refuses %j as APPROVAL_REQUIRED without restoring or refreshing", async (missing) => {
    const order: string[] = [];
    expect(await refusalOf(() => restoreRoute.handle({ input: input(missing), deps: deps(order), context: ctx, authorize: recordingAuthorize().authorize }, { signal }))).toEqual({
      status: 400, body: { code: "APPROVAL_REQUIRED", error: "Approve restoring this theme on the approval card first." },
    });
    expect(order).toEqual([]);
  });

  it("answers a replayed token as 409 TOKEN_ALREADY_REDEEMED and never refreshes for the refused move", async () => {
    const order: string[] = [];
    const shared = deps(order);
    const { authorize } = recordingAuthorize();
    await restoreRoute.handle({ input: input(), deps: shared, context: ctx, authorize }, { signal });
    order.length = 0;
    expect(await refusalOf(() => restoreRoute.handle({ input: input(), deps: shared, context: ctx, authorize }, { signal }))).toEqual({
      status: 409, body: { code: "TOKEN_ALREADY_REDEEMED", error: "gateway TOKEN_ALREADY_REDEEMED" },
    });
    expect(order).toEqual(["restore:principal-1:t:d:tok-1"]);
  });

  it("maps every service refusal to its status", async () => {
    for (const [code, status] of Object.entries(HELD_BACK_ERROR_STATUS)) {
      const failing = { ...deps([]), restoreTheme: async () => { throw new FakeServiceError(code as HeldBackErrorCode); } };
      const refused = await refusalOf(() => restoreRoute.handle({ input: input(), deps: failing, context: ctx, authorize: recordingAuthorize().authorize }, { signal }));
      expect(refused).toEqual({ status, body: { code, error: `service ${code}` } });
    }
  });

  it("rethrows an unrecognized failure unchanged so the mount can give it an ERR- reference", async () => {
    const boom = new Error("disk gone");
    const failing = { ...deps([]), restoreTheme: async () => { throw boom; } };
    const caught = await refusalOrError(() => restoreRoute.handle({ input: input(), deps: failing, context: ctx, authorize: recordingAuthorize().authorize }, { signal }));
    expect(caught).toBe(boom);
    expect(caught).not.toBeInstanceOf(RouteRefusalError);
  });
});
