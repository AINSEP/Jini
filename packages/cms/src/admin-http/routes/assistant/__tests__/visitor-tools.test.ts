import { describe, expect, it } from "vitest";

import {
  ADMIN_VISITOR_TOOLS_PATH, assistantVisitorToolsConfigureRoute, assistantVisitorToolsListRoute, type VisitorToolsManagementRoutePort,
} from "../visitor-tools.js";
import type { AssistantErrorMapping } from "../shared.js";
import { PRINCIPAL, raw, refusalOf, WORKSPACE_ID } from "./settings-helpers.js";

/** @file The visitor-tools admin pair: list and configure over the injected management service. */

class Conflict extends Error {}
class Denied extends Error {}
class Invalid extends Error {}

/** The host's ladder, in its order: 409 with `reload`, 403 with fixed copy, 400 validation. */
const LADDER: readonly AssistantErrorMapping[] = [
  { matches: ({ err }) => err instanceof Conflict, status: 409, code: "VISITOR_TOOLS_REVISION_CONFLICT", extra: { reload: true } },
  { matches: ({ err }) => err instanceof Denied, status: 403, code: "FORBIDDEN", error: "visitor-tools.manage is required" },
  { matches: ({ err }) => err instanceof Invalid, status: 400, code: "VISITOR_TOOLS_VALIDATION_ERROR" },
];
const VIEW = { revisionSeq: 3, tools: [] };

function recordingService(fail: Partial<Record<"list" | "prepare" | "apply", Error>> = {}): { service: VisitorToolsManagementRoutePort; calls: unknown[] } {
  const calls: unknown[] = [];
  const step = (name: "list" | "prepare" | "apply", value: unknown) => async (input: unknown) => {
    calls.push({ [name]: input });
    if (fail[name]) throw fail[name];
    return value;
  };
  return { calls, service: { list: step("list", VIEW), prepare: step("prepare", { prepared: true }), apply: step("apply", VIEW) } };
}

const deps = (service: VisitorToolsManagementRoutePort | undefined) => ({ workspaceId: WORKSPACE_ID, visitorToolsManagement: () => service, errorMappings: LADDER });

describe("visitor-tools routes", () => {
  it("keep the shared path, the two methods, success status and no body cap", () => {
    expect(ADMIN_VISITOR_TOOLS_PATH).toBe("/api/admin/v1/workspaces/:workspaceId/assistant/visitor-tools");
    expect([assistantVisitorToolsListRoute.method, assistantVisitorToolsConfigureRoute.method]).toEqual(["get", "put"]);
    for (const route of [assistantVisitorToolsListRoute, assistantVisitorToolsConfigureRoute]) {
      expect(route.path).toBe(ADMIN_VISITOR_TOOLS_PATH);
      expect(route.successStatus).toBeUndefined();
      expect(route.maxBodyBytes).toBeUndefined();
    }
    expect(assistantVisitorToolsListRoute.parse(raw())).toEqual({ ok: true, value: {} });
  });

  it("hands the service the raw body unchanged, including an absent one (the service validates it)", () => {
    expect(assistantVisitorToolsConfigureRoute.parse(raw({ toolId: "site" }))).toEqual({ ok: true, value: { body: { toolId: "site" } } });
    expect(assistantVisitorToolsConfigureRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { body: undefined } });
  });

  it("list answers the service view for the authenticated caller; configure prepares then applies", async () => {
    const { service, calls } = recordingService();
    expect(await assistantVisitorToolsListRoute.handle({ input: {}, deps: deps(service), context: PRINCIPAL })).toEqual({ ok: true, value: { data: VIEW } });
    expect(await assistantVisitorToolsConfigureRoute.handle({ input: { body: { toolId: "site" } }, deps: deps(service), context: PRINCIPAL })).toEqual({ ok: true, value: { data: VIEW } });
    expect(calls).toEqual([
      { list: { callerPrincipalId: PRINCIPAL.id } },
      { prepare: { callerPrincipalId: PRINCIPAL.id, input: { toolId: "site" } } },
      { apply: { callerPrincipalId: PRINCIPAL.id, prepared: { prepared: true } } },
    ]);
  });

  it("maps every rung of the host ladder from each step to its exact body", async () => {
    const cases = [
      [new Conflict("reload"), { status: 409, body: { error: "reload", code: "VISITOR_TOOLS_REVISION_CONFLICT", reload: true } }],
      [new Denied("denied"), { status: 403, body: { error: "visitor-tools.manage is required", code: "FORBIDDEN" } }],
      [new Invalid("bad patch"), { status: 400, body: { error: "bad patch", code: "VISITOR_TOOLS_VALIDATION_ERROR" } }],
    ] as const;
    for (const [error, expected] of cases) {
      expect(await refusalOf(() => assistantVisitorToolsListRoute.handle({ input: {}, deps: deps(recordingService({ list: error }).service), context: PRINCIPAL }))).toEqual(expected);
      for (const step of ["prepare", "apply"] as const) {
        const { service } = recordingService({ [step]: error });
        expect(await refusalOf(() => assistantVisitorToolsConfigureRoute.handle({ input: { body: {} }, deps: deps(service), context: PRINCIPAL }))).toEqual(expected);
      }
    }
  });

  it("rethrows unmapped failures, an absent service and a missing principal for the host's redacted 500", async () => {
    const { service, calls } = recordingService({ list: new Error("/secret/storage/file") });
    await expect(assistantVisitorToolsListRoute.handle({ input: {}, deps: deps(service), context: PRINCIPAL })).rejects.toThrow("/secret/storage/file");
    await expect(assistantVisitorToolsListRoute.handle({ input: {}, deps: deps(undefined), context: PRINCIPAL })).rejects.toThrow("Visitor tools service unavailable.");
    await expect(assistantVisitorToolsConfigureRoute.handle({ input: { body: {} }, deps: deps(undefined), context: PRINCIPAL })).rejects.toThrow("Visitor tools service unavailable.");
    const idle = recordingService();
    await expect(assistantVisitorToolsConfigureRoute.handle({ input: { body: {} }, deps: deps(idle.service), context: undefined })).rejects.toThrow(/no authenticated principal/);
    expect(idle.calls).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
