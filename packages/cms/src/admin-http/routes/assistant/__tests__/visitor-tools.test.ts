import { describe, expect, it } from "vitest";
import { ForbiddenError, ValueValidationFailedError } from "@jini-ai/core/settings";
import type { VisitorToolsView } from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";

import {
  ADMIN_VISITOR_TOOLS_PATH, configureVisitorToolsRoute, listVisitorToolsRoute,
  type VisitorToolsErrorKind, type VisitorToolsRouteDepsBase,
} from "../visitor-tools.js";
import { PREFIX, PRINCIPAL, raw, refusal, signal } from "./helpers.js";

const VIEW: VisitorToolsView = { revisionSeq: 3, defaults: { perIpPerHour: 5, perSitePerDay: 50 }, callsPerTurn: 2, tools: [] };
class HostConflict extends Error {}
class HostPolicyError extends Error {}
const kindOf = (error: unknown): VisitorToolsErrorKind | undefined =>
  error instanceof HostConflict ? "revision-conflict" : error instanceof HostPolicyError ? "policy-validation" : undefined;

/** A recording visitor-tools service whose operations can be made to throw. */
function serviceDeps({ fail }: { fail?: unknown } = {}): { deps: VisitorToolsRouteDepsBase; calls: unknown[] } {
  const calls: unknown[] = [];
  const act = async <T>(entry: unknown, value: T) => { calls.push(entry); if (fail !== undefined) throw fail; return value; };
  return { calls, deps: { visitorToolsErrorKind: kindOf, visitorToolsManagement: {
    list: (required) => act(["list", required], VIEW),
    prepare: (required) => act(["prepare", required], "prepared-token"),
    apply: (required) => act(["apply", required], { ...VIEW, revisionSeq: 4 }),
  } } };
}

const handleList = (deps: VisitorToolsRouteDepsBase, { context }: { context: typeof PRINCIPAL | undefined } = { context: PRINCIPAL }) =>
  listVisitorToolsRoute.handle({ input: undefined, deps, context }, { signal });
const handleConfigure = (input: unknown, deps: VisitorToolsRouteDepsBase) =>
  configureVisitorToolsRoute.handle({ input, deps, context: PRINCIPAL }, { signal });

describe("visitor-tools routes", () => {
  it("pin GET and PUT on the one path; PUT parse hands the raw body to the service", () => {
    expect(ADMIN_VISITOR_TOOLS_PATH).toBe(`${PREFIX}/visitor-tools`);
    expect([listVisitorToolsRoute.method, listVisitorToolsRoute.path, configureVisitorToolsRoute.method, configureVisitorToolsRoute.path, configureVisitorToolsRoute.maxBodyBytes])
      .toEqual(["get", ADMIN_VISITOR_TOOLS_PATH, "put", ADMIN_VISITOR_TOOLS_PATH, undefined]);
    expect(configureVisitorToolsRoute.parse(raw({ toolId: "t" }))).toEqual({ ok: true, value: { toolId: "t" } });
  });

  it("GET lists as the session principal; PUT prepares the raw body then applies the prepared value", async () => {
    const { deps, calls } = serviceDeps();
    expect(await handleList(deps)).toEqual({ ok: true, value: { data: VIEW } });
    const body = { toolId: "t", expectedRevisionSeq: 3, principalId: "forged" };
    expect(await handleConfigure(body, deps)).toEqual({ ok: true, value: { data: { ...VIEW, revisionSeq: 4 } } });
    expect(calls).toEqual([
      ["list", { callerPrincipalId: PRINCIPAL.id }],
      ["prepare", { callerPrincipalId: PRINCIPAL.id, input: body }],
      ["apply", { callerPrincipalId: PRINCIPAL.id, prepared: "prepared-token" }],
    ]);
  });

  it("an absent service or principal is an unexpected failure (the host's redacted 500)", async () => {
    const { deps } = serviceDeps();
    await expect(handleList({ ...deps, visitorToolsManagement: undefined })).rejects.toThrow("Visitor tools service unavailable.");
    await expect(handleConfigure({}, { ...deps, visitorToolsManagement: undefined })).rejects.toThrow("Visitor tools service unavailable.");
    await expect(handleList(deps, { context: undefined })).rejects.toThrow(/no authenticated principal/);
  });

  it.each([
    ["revision conflict", new HostConflict("stale revision"), { status: 409, body: { error: "stale revision", code: "VISITOR_TOOLS_REVISION_CONFLICT", reload: true } }],
    ["forbidden", new ForbiddenError("nope"), { status: 403, body: { error: "visitor-tools.manage is required", code: "FORBIDDEN" } }],
    ["host policy validation", new HostPolicyError("bad mode"), { status: 400, body: { error: "bad mode", code: "VISITOR_TOOLS_VALIDATION_ERROR" } }],
    ["settings value validation", new ValueValidationFailedError("bad limit"), { status: 400, body: { error: "bad limit", code: "VISITOR_TOOLS_VALIDATION_ERROR" } }],
  ])("maps a %s from list, prepare or apply to its exact refusal", async (_label, error, expected) => {
    const { deps } = serviceDeps({ fail: error });
    expect(await refusal(handleList(deps))).toEqual(expected);
    expect(await refusal(handleConfigure({}, deps))).toEqual(expected);
  });

  it("checks the ladder in order (a conflict that is also forbidden is the 409) and rethrows anything unmapped", async () => {
    class ForbiddenConflict extends ForbiddenError {}
    const conflictFirst = serviceDeps({ fail: new ForbiddenConflict("both") }).deps;
    expect((await refusal(handleList({ ...conflictFirst, visitorToolsErrorKind: () => "revision-conflict" }))).status).toBe(409);
    const { deps } = serviceDeps({ fail: new Error("db down") });
    await expect(handleConfigure({}, deps)).rejects.toThrow("db down");
  });
});
