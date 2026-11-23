import { ToolInputError } from "@jini-ai/core";
import { describe, expect, it } from "vitest";
import {
  mailActivityGetRoute, mailActivityListRoute, mailFeedbackRoute, mailSuppressionRemoveRoute, mailSuppressionsListRoute, mailUsesRoute,
  type MailActivityFailure, type MailActivityGetRouteDeps, type MailActivityListRouteDeps, type MailFeedbackRouteDeps,
  type MailSuppressionRemoveRouteDeps, type MailSuppressionsListRouteDeps, type MailUsesRouteDeps,
} from "../mail-activity.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal } from "./mail-test-helpers.js";

const BASE = "/api/admin/v1/workspaces/:workspaceId/system";
type AllDeps = MailUsesRouteDeps & MailActivityListRouteDeps & MailActivityGetRouteDeps & MailSuppressionsListRouteDeps & MailSuppressionRemoveRouteDeps & MailFeedbackRouteDeps;

interface Seen { permissionChecks: unknown[]; listed: unknown[]; fetched: unknown[]; suppressions: unknown[]; planned: unknown[]; removed: unknown[] }

function makeDeps(overrides: Partial<AllDeps> = {}): AllDeps & { seen: Seen } {
  const seen: Seen = { permissionChecks: [], listed: [], fetched: [], suppressions: [], planned: [], removed: [] };
  return {
    classifyMailActivityError: () => undefined,
    statusPermission: "test.status",
    checkPermission: async (required) => { seen.permissionChecks.push(required); return { allowed: true, reason: "ok" }; },
    readMailUseReadiness: async () => ({ uses: ["u"] }),
    listMailActivity: async (required) => { seen.listed.push(required); return { items: [] }; },
    getMailActivity: async (required) => { seen.fetched.push(required); return { id: "a1" }; },
    listMailSuppressions: async (required) => { seen.suppressions.push(required); return { items: [] }; },
    planSuppressionRemoval: async (required) => {
      seen.planned.push(required);
      return { plan: { revision: "r1", address: "a@b.co" }, revision: "r1", remove: async () => { seen.removed.push("removed"); return { removed: true }; } };
    },
    readMailFeedbackSetup: async () => ({ ready: true }),
    seen,
    ...overrides,
  };
}

const ROUTES = [
  { name: "mail-uses", route: mailUsesRoute, method: "get", path: `${BASE}/mail-uses`, input: {} },
  { name: "mail-activity", route: mailActivityListRoute, method: "get", path: `${BASE}/mail-activity`, input: { query: { limit: "5" } } },
  { name: "mail-activity/:activityId", route: mailActivityGetRoute, method: "get", path: `${BASE}/mail-activity/:activityId`, input: { activityId: "a1" } },
  { name: "mail-suppressions", route: mailSuppressionsListRoute, method: "get", path: `${BASE}/mail-suppressions`, input: { query: {} } },
  { name: "mail-suppressions/remove", route: mailSuppressionRemoveRoute, method: "post", path: `${BASE}/mail-suppressions/remove`, input: { body: { confirmed: true, revision: "r1" } } },
  { name: "mail-feedback", route: mailFeedbackRoute, method: "get", path: `${BASE}/mail-feedback`, input: {} },
] as const;

/** Drive one route's handler through the shared deps, as the host would. */
const run = (route: (typeof ROUTES)[number], deps: AllDeps, input: unknown = route.input, context: { id: string } | null = PRINCIPAL) =>
  (route.route.handle as (a: unknown, b: unknown) => Promise<unknown>)({ input, deps, context: context ?? undefined, authorize: recordingAuthorize().authorize }, { signal });

describe("mail activity route specs", () => {
  it.each(ROUTES)("$name keeps its method and byte-identical path, with no status or body cap of its own", ({ route, method, path }) => {
    expect([route.method, route.path]).toEqual([method, path]);
    expect(route.successStatus).toBeUndefined();
    expect(route.maxBodyBytes).toBeUndefined();
  });

  it("parses each route's input: the query, the :activityId param (unset stays undefined) and the body object", () => {
    expect(mailUsesRoute.parse(raw())).toEqual({ ok: true, value: {} });
    expect(mailFeedbackRoute.parse(raw())).toEqual({ ok: true, value: {} });
    expect(mailActivityListRoute.parse(raw({ query: { outcome: "failed" } }))).toEqual({ ok: true, value: { query: { outcome: "failed" } } });
    expect(mailSuppressionsListRoute.parse(raw({ query: { scope: "all" } }))).toEqual({ ok: true, value: { query: { scope: "all" } } });
    expect(mailActivityGetRoute.parse(raw({ params: { activityId: "a1" } }))).toEqual({ ok: true, value: { activityId: "a1" } });
    expect(mailActivityGetRoute.parse(raw())).toEqual({ ok: true, value: { activityId: undefined } });
    expect(mailSuppressionRemoveRoute.parse(raw({ body: { address: "a@b.co" } }))).toEqual({ ok: true, value: { body: { address: "a@b.co" } } });
  });

  it.each([[undefined], [null], [[1]], ["text"], [7]])("treats the non-object remove body %j as an empty object", (body) => {
    expect(mailSuppressionRemoveRoute.parse(raw({ body }))).toEqual({ ok: true, value: { body: {} } });
  });

  it.each([["mail-uses", mailUsesRoute, { uses: ["u"] }], ["mail-feedback", mailFeedbackRoute, { ready: true }]] as const)(
    "%s answers the host report under the status permission, asked as the principal", async (_name, route, report) => {
      const deps = makeDeps();
      expect(await (route.handle as (a: unknown) => Promise<unknown>)({ input: {}, deps, context: PRINCIPAL })).toEqual({ ok: true, value: report });
      expect(deps.seen.permissionChecks).toEqual([{ principalId: "principal-1", permission: "test.status" }]);
    },
  );

  it.each([["mail-uses", 0], ["mail-feedback", 5]])("%s answers a denied status permission as a 403 naming it, without the principal, and reads nothing", async (_name, index) => {
    let reads = 0;
    const deps = makeDeps({ checkPermission: async () => ({ allowed: false, reason: "no_grant" }), readMailUseReadiness: async () => { reads += 1; return {}; }, readMailFeedbackSetup: async () => { reads += 1; return {}; } });
    expect(await refusalOf(() => run(ROUTES[index]!, deps))).toEqual({ status: 403, body: {
      error: "not authorized for 'test.status' (no_grant)", code: "FORBIDDEN", details: { permission: "test.status", reason: "no_grant" },
    } });
    expect(reads).toBe(0);
  });

  it("lists activity and suppressions as the principal with the raw query (the host reads it, so a bad query is its 400)", async () => {
    const deps = makeDeps();
    expect(await run(ROUTES[1], deps)).toEqual({ ok: true, value: { items: [] } });
    expect(await run(ROUTES[3], deps, { query: { search: "x" } })).toEqual({ ok: true, value: { items: [] } });
    expect(deps.seen.listed).toEqual([{ principalId: "principal-1", input: { limit: "5" } }]);
    expect(deps.seen.suppressions).toEqual([{ principalId: "principal-1", input: { search: "x" } }]);
  });

  it("answers one send's detail, passing the unvalidated id to the host, and 404 when none exists", async () => {
    const deps = makeDeps();
    expect(await run(ROUTES[2], deps)).toEqual({ ok: true, value: { id: "a1" } });
    expect(await run(ROUTES[2], deps, { activityId: undefined })).toEqual({ ok: true, value: { id: "a1" } });
    expect(deps.seen.fetched).toEqual([{ principalId: "principal-1", activityId: "a1" }, { principalId: "principal-1", activityId: undefined }]);
    const missing = makeDeps({ getMailActivity: async () => undefined });
    expect(await refusalOf(() => run(ROUTES[2], missing))).toEqual({ status: 404, body: { error: "no such email send", code: "NOT_FOUND" } });
  });

  it("previews a suppression removal unless confirmed is exactly true, and never removes then", async () => {
    const deps = makeDeps();
    const preview = { ok: true, value: { removed: false, confirmationRequired: true, plan: { revision: "r1", address: "a@b.co" } } };
    expect(await run(ROUTES[4], deps, { body: { address: "a@b.co" } })).toEqual(preview);
    expect(await run(ROUTES[4], deps, { body: { confirmed: "true", revision: "r1" } })).toEqual(preview);
    expect(deps.seen.removed).toEqual([]);
    expect(deps.seen.planned).toEqual([{ principalId: "principal-1", input: { address: "a@b.co" } }, { principalId: "principal-1", input: { confirmed: "true", revision: "r1" } }]);
  });

  it("removes only on confirmed: true with the reviewed revision, else asks the person to review again (400)", async () => {
    const deps = makeDeps();
    expect(await run(ROUTES[4], deps)).toEqual({ ok: true, value: { removed: true } });
    expect(deps.seen.removed).toEqual(["removed"]);
    for (const body of [{ confirmed: true }, { confirmed: true, revision: "old" }]) {
      expect(await refusalOf(() => run(ROUTES[4], deps, { body }))).toEqual({ status: 400, body: {
        error: "Suppression changed or no reviewed revision was supplied. Review and confirm the current suppression.", code: "INVALID_INPUT",
      } });
    }
    expect(deps.seen.removed).toEqual(["removed"]);
  });

  describe.each(ROUTES)("$name error ladder", (entry) => {
    it("answers a caller error (ToolInputError) as a 400 INVALID_INPUT", async () => {
      const boom = async () => { throw new ToolInputError({ message: "bad input" }); };
      const deps = makeDeps({ readMailUseReadiness: boom, listMailActivity: boom, getMailActivity: boom, listMailSuppressions: boom, planSuppressionRemoval: boom, readMailFeedbackSetup: boom });
      expect(await refusalOf(() => run(entry, deps))).toEqual({ status: 400, body: { error: "bad input", code: "INVALID_INPUT" } });
    });

    it.each<[string, MailActivityFailure, { status: number; body: unknown }]>([
      ["forbidden", { kind: "forbidden", permission: "mail.activity.read" }, { status: 403, body: {
        error: "not authorized for 'mail.activity.read' (no_grant)", code: "FORBIDDEN", details: { permission: "mail.activity.read", reason: "no_grant" } } }],
      ["unavailable", { kind: "unavailable", message: "no activity repo" }, { status: 503, body: { error: "no activity repo", code: "MAIL_ACTIVITY_UNAVAILABLE" } }],
    ])("answers the host's %s classification", async (_kind, failure, expected) => {
      const fault = new Error("domain fault");
      const boom = async () => { throw fault; };
      const deps = makeDeps({ classifyMailActivityError: (error) => (error === fault ? failure : undefined), readMailUseReadiness: boom, listMailActivity: boom, getMailActivity: boom, listMailSuppressions: boom, planSuppressionRemoval: boom, readMailFeedbackSetup: boom });
      expect(await refusalOf(() => run(entry, deps))).toEqual(expected);
    });

    it("rethrows an unclassified fault unchanged for the host's 500", async () => {
      const boom = async () => { throw new Error("unexpected"); };
      const deps = makeDeps({ readMailUseReadiness: boom, listMailActivity: boom, getMailActivity: boom, listMailSuppressions: boom, planSuppressionRemoval: boom, readMailFeedbackSetup: boom });
      await expect(run(entry, deps)).rejects.toThrow("unexpected");
    });

    it("fails closed without an authenticated principal", async () => {
      await expect(run(entry, makeDeps(), entry.input, null)).rejects.toThrow(/no authenticated principal/);
    });
  });
});
