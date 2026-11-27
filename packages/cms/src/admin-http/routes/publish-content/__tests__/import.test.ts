import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import {
  importConfirmRoute,
  importExecuteRoute,
  importPlanRoute,
  importRunStatusRoute,
  readOverwriteEntityKeys,
  type ImportExecuteRouteDeps,
  type ImportPlanRouteDeps,
  type ImportRouteRefusal,
} from "../import.js";
import { WORKSPACE_ID, refusalOf } from "./transport-helpers.js";

/** @file The gated import ceremony specs: body refusals, the overwrite rule, the raw-values gate, the execute pre-check and the injected error mapping. */

const PRINCIPAL = { id: "u1" };
const raw = (body: unknown, params: Record<string, string> = { workspaceId: WORKSPACE_ID }) => ({ body, query: {}, params });
const REPORT = { refused: false, refusalReason: null, applyOrder: [], rows: [{ entityType: "post" }], holders: [] };
const RAW_REPORT = { ...REPORT, rows: [{ entityType: "raw-row" }] };
const noRefusal = (): ImportRouteRefusal | undefined => undefined;

function planDeps(overrides: Partial<ImportPlanRouteDeps> = {}) {
  const calls: string[] = [];
  const deps: ImportPlanRouteDeps = {
    workspaceId: WORKSPACE_ID,
    importRefusal: noRefusal,
    credentialKind: () => { calls.push("kind"); return "session"; },
    planImport: async ({ bundleId, overwriteEntityKeys }) => { calls.push(`plan:${bundleId}:${JSON.stringify(overwriteEntityKeys)}`); return { result: { planId: "p1", planHash: "h1", details: "raw" }, report: REPORT as never }; },
    mayReadRawValues: async () => { calls.push("may-read"); return true; },
    backstopPreview: async () => { calls.push("preview"); return { rows: 1 }; },
    ...overrides,
  };
  return { deps, calls };
}

function executeDeps(overrides: Partial<ImportExecuteRouteDeps> = {}) {
  const calls: string[] = [];
  const deps: ImportExecuteRouteDeps = {
    workspaceId: WORKSPACE_ID,
    importRefusal: noRefusal,
    credentialKind: () => "api_key",
    authorizeExecute: async () => { calls.push("pre-check"); return { allowed: true, reason: "matched" }; },
    executeImport: async ({ bundleId }) => { calls.push(`execute:${bundleId}`); return { runId: "r1", restorePointId: "rp" }; },
    backstopAudit: () => undefined,
    ...overrides,
  };
  return { deps, calls };
}

async function plan(body: unknown, deps: ImportPlanRouteDeps) {
  const parsed = importPlanRoute.parse(raw(body));
  if (!parsed.ok) throw new Error("parse refused");
  return importPlanRoute.handle({ input: parsed.value, deps, context: PRINCIPAL });
}

async function executeImport(body: unknown, deps: ImportExecuteRouteDeps) {
  const parsed = importExecuteRoute.parse(raw(body));
  if (!parsed.ok) throw new Error("parse refused");
  return importExecuteRoute.handle({ input: parsed.value, deps, context: PRINCIPAL });
}

describe("import route specs", () => {
  it("pins methods, paths, default status and no body cap", () => {
    const base = "/api/admin/v1/workspaces/:workspaceId/publish-content";
    expect([importPlanRoute, importConfirmRoute, importExecuteRoute, importRunStatusRoute].map((r) => [r.method, r.path, r.successStatus, r.maxBodyBytes])).toEqual([
      ["post", `${base}/import/plan`, undefined, undefined],
      ["post", `${base}/import/confirm`, undefined, undefined],
      ["post", `${base}/import/execute`, undefined, undefined],
      ["get", `${base}/runs/:runId`, undefined, undefined],
    ]);
  });

  it("reads overwrite ticks: absent/null force nothing; a non-array, >1000 entries or a non-string is invalid", () => {
    expect(readOverwriteEntityKeys({ overwriteEntityKeys: undefined })).toBeNull();
    expect(readOverwriteEntityKeys({ overwriteEntityKeys: null })).toBeNull();
    expect(readOverwriteEntityKeys({ overwriteEntityKeys: ["a"] })).toEqual(["a"]);
    expect(readOverwriteEntityKeys({ overwriteEntityKeys: Array(1000).fill("k") })).toHaveLength(1000);
    for (const bad of ["a", Array(1001).fill("k"), [1]]) expect(readOverwriteEntityKeys({ overwriteEntityKeys: bad })).toBe("invalid");
  });

  it.each([
    [importPlanRoute, undefined, "'bundleId' (string) is required"],
    [importPlanRoute, { bundleId: 1 }, "'bundleId' (string) is required"],
    [importPlanRoute, { bundleId: "b", overwriteEntityKeys: "x" }, "'overwriteEntityKeys' must be an array of strings"],
    [importConfirmRoute, { planId: "p" }, "'planId' and 'planHash' (strings) are required"],
    [importConfirmRoute, undefined, "'planId' and 'planHash' (strings) are required"],
    [importExecuteRoute, { bundleId: "b" }, "'bundleId' and 'confirmationToken' (strings) are required"],
    [importExecuteRoute, undefined, "'bundleId' and 'confirmationToken' (strings) are required"],
    [importExecuteRoute, { bundleId: "b", confirmationToken: "t", overwriteEntityKeys: [1] }, "'overwriteEntityKeys' must be an array of strings"],
  ] as const)("refuses a malformed body with the exact 400 (%#)", async (route, body, error) => {
    expect(await refusalOf(() => route.parse(raw(body)))).toEqual({ status: 400, body: { error, code: "VALIDATION_ERROR" } });
  });

  it("plan answers the gateway result with the report DTO; the credential kind is not read without ticks", async () => {
    const { deps, calls } = planDeps();
    const result = await plan({ bundleId: "b1" }, deps);
    expect(result).toMatchObject({ ok: true, value: { planId: "p1", planHash: "h1", details: { refused: false, rows: [{ entityType: "post" }] } } });
    expect(result.ok && "backstopPreview" in result.value).toBe(false);
    expect(calls).toEqual(["plan:b1:null"]);
  });

  it("an API key may not tick overwrite (403 before any plan); a session and empty ticks may", async () => {
    const apiKey = planDeps({ credentialKind: () => "api_key" });
    expect(await refusalOf(() => plan({ bundleId: "b1", overwriteEntityKeys: ["post:a"] }, apiKey.deps))).toEqual({ status: 403, body: {
      error: "'overwriteEntityKeys' can only be sent from a signed-in admin session or a publishing instance",
      code: "FORBIDDEN", details: { permission: "publish_content.apply", reason: "credential_kind_not_permitted" } } });
    expect(apiKey.calls).toEqual([]);
    await plan({ bundleId: "b1", overwriteEntityKeys: [] }, apiKey.deps);
    const session = planDeps();
    await plan({ bundleId: "b1", overwriteEntityKeys: ["post:a"] }, session.deps);
    expect(session.calls).toEqual(["kind", 'plan:b1:["post:a"]']);
  });

  it("a raw plan needs the raw-values check: denied is the 403, allowed attaches the preview", async () => {
    const denied = planDeps({ planImport: async () => ({ result: {}, report: RAW_REPORT as never }), mayReadRawValues: async () => false });
    expect(await refusalOf(() => plan({ bundleId: "b1" }, denied.deps))).toEqual({ status: 403, body: { error: "Manual publishing values are not available to this account.", code: "FORBIDDEN" } });
    expect(denied.calls).toEqual([]);
    const allowed = planDeps({ planImport: async () => ({ result: {}, report: RAW_REPORT as never }) });
    expect(await plan({ bundleId: "b1" }, allowed.deps)).toMatchObject({ ok: true, value: { backstopPreview: { rows: 1 } } });
    const refused = planDeps({ planImport: async () => ({ result: {}, report: { ...RAW_REPORT, refused: true } as never }) });
    await plan({ bundleId: "b1" }, refused.deps);
    expect(refused.calls).toEqual([]);
  });

  it("confirm answers only the confirmation token", async () => {
    const parsed = importConfirmRoute.parse(raw({ planId: "p", planHash: "h" }));
    if (!parsed.ok) throw new Error("parse refused");
    const seen: unknown[] = [];
    const result = await importConfirmRoute.handle({ input: parsed.value, context: PRINCIPAL, deps: { workspaceId: WORKSPACE_ID, importRefusal: noRefusal,
      confirmImport: async (args) => { seen.push(args); return { confirmationToken: "tok", extra: 1 } as never; } } });
    expect(result).toEqual({ ok: true, value: { confirmationToken: "tok" } });
    expect(seen).toEqual([{ context: PRINCIPAL, planId: "p", planHash: "h" }]);
  });

  it("execute: the pre-check denial is NOT_AUTHORIZED and runs nothing; allowed merges the apply report", async () => {
    const denied = executeDeps({ authorizeExecute: async () => ({ allowed: false, reason: "no_grant" }) });
    expect(await refusalOf(() => executeImport({ bundleId: "b", confirmationToken: "t" }, denied.deps))).toEqual({ status: 403, body: {
      error: "principal 'u1' is not authorized for 'publish_content.apply' (no_grant)", code: "NOT_AUTHORIZED" } });
    expect(denied.calls).toEqual([]);
    const ok = executeDeps();
    expect(await executeImport({ bundleId: "b", confirmationToken: "t" }, ok.deps)).toEqual({ ok: true, value: { runId: "r1", restorePointId: "rp" } });
    expect(ok.calls).toEqual(["pre-check", "execute:b"]);
    const apiKey = executeDeps();
    await expect(refusalOf(() => executeImport({ bundleId: "b", confirmationToken: "t", overwriteEntityKeys: ["k"] }, apiKey.deps))).resolves.toMatchObject({ status: 403 });
    expect(apiKey.calls).toEqual([]);
  });

  it("run status: publish_content.read with no entity type, then the status or the exact 404", async () => {
    const calls: unknown[] = [];
    const authorize = async (args: { permission: string; entityType?: string }, ...scope: unknown[]) => { calls.push([args, ...scope]); };
    const deps = { workspaceId: WORKSPACE_ID, importRefusal: noRefusal, runStatus: async ({ runId }: { runId: string }) => (runId === "r1" ? { state: "done" } : null) };
    expect(await importRunStatusRoute.handle({ input: { runId: "r1" }, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { state: "done" } });
    expect(calls).toEqual([[{ permission: "publish_content.read" }]]);
    expect(await refusalOf(() => importRunStatusRoute.handle({ input: { runId: "nope" }, deps, context: PRINCIPAL, authorize }))).toEqual({ status: 404, body: { error: "publish-content run was not found", code: "RUN_NOT_FOUND" } });
    await expect(importRunStatusRoute.handle({ input: { runId: "r1" }, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(importRunStatusRoute.parse(raw(undefined, { workspaceId: WORKSPACE_ID, runId: "r9" }))).toEqual({ ok: true, value: { runId: "r9" } });
  });

  it("a thrown error the host maps becomes its refusal; anything else is rethrown unchanged (the host 500)", async () => {
    const stale = new Error("stale");
    const mapped = planDeps({ planImport: async () => { throw stale; }, importRefusal: ({ error }) => (error === stale ? { status: 409, body: { error: "stale", code: "PLAN_STALE" } } : undefined) });
    expect(await refusalOf(() => plan({ bundleId: "b1" }, mapped.deps))).toEqual({ status: 409, body: { error: "stale", code: "PLAN_STALE" } });
    const unmapped = planDeps({ planImport: async () => { throw new Error("disk on fire"); } });
    await expect(plan({ bundleId: "b1" }, unmapped.deps)).rejects.toThrow("disk on fire");
  });
});

it("passes an already-worded route refusal through import without reclassifying it", async () => {
  const failure = new RouteRefusalError({ status: 409, body: { error: "Already processing", code: "IN_PROGRESS" } });
  const { deps } = planDeps({
    planImport: async () => { throw failure; },
    importRefusal: () => { throw new Error("must not invoke the host classifier for a route refusal"); },
  });
  await expect(plan({ bundleId: "b1" }, deps)).rejects.toBe(failure);
});
