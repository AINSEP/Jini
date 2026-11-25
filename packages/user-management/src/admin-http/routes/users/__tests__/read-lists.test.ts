import { describe, expect, it } from "vitest";
import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { policyListRoute } from "../list-policies.js";
import { policyPermissionListRoute } from "../list-policy-permissions.js";
import { roleListRoute } from "../list-roles.js";
import { raw, refusalOf, WORKSPACE_ID } from "./access-helpers.js";

/** A recording `authorize` that keeps every argument exactly as the spec passed it (key presence included). */
function recording(allowed = true) {
  const calls: unknown[][] = [];
  const authorize: JsonRouteAuthorize = async (...args: unknown[]) => {
    calls.push(args);
    if (!allowed) throw new RouteRefusalError({ status: 403, body: { error: "denied" } });
  };
  return { calls, authorize };
}

const POLICY = { id: "policy-7", workspaceId: WORKSPACE_ID, name: "Review", description: "Review content", isBuiltin: false, isFrozen: true, version: 4, internal: "hidden" };
const ROLE = { id: "role-7", workspaceId: WORKSPACE_ID, name: "Reviewer", isBuiltin: true, version: 2, internal: "hidden" };
const ROW = { id: "pp-9", workspaceId: WORKSPACE_ID, policyId: "policy-7", permission: "content.read", resourceType: "post", constraintJson: '{"status":"published"}' };

function counting() {
  let reads = 0;
  const count = async (..._args: unknown[]) => { reads++; return [] as never; };
  return {
    reads: () => reads,
    deps: { workspaceId: WORKSPACE_ID, roleRepo: { list: count }, policyRepo: { list: count, findById: count }, policyPermissionRepo: { listByPolicyId: count } },
  };
}

describe("role/policy list specs", () => {
  it("keep their methods, paths, 200 success and no body cap", () => {
    expect([roleListRoute.method, roleListRoute.path, roleListRoute.successStatus, roleListRoute.maxBodyBytes])
      .toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/roles", undefined, undefined]);
    expect([policyListRoute.method, policyListRoute.path, policyListRoute.successStatus, policyListRoute.maxBodyBytes])
      .toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/policies", undefined, undefined]);
    expect([policyPermissionListRoute.method, policyPermissionListRoute.path, policyPermissionListRoute.successStatus, policyPermissionListRoute.maxBodyBytes])
      .toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/policies/:policyId/permissions", undefined, undefined]);
  });

  it("reads policyId with the `?? \"\"` fallback; the id-free lists parse to an empty input", () => {
    expect(policyPermissionListRoute.parse(raw({ policyId: "p1" }))).toEqual({ ok: true, value: { policyId: "p1" } });
    expect(policyPermissionListRoute.parse(raw({}))).toEqual({ ok: true, value: { policyId: "" } });
    expect(roleListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
    expect(policyListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("ask role.manage with NO entityType key and no entity scope", async () => {
    for (const [route, input] of [[roleListRoute, {}], [policyListRoute, {}], [policyPermissionListRoute, { policyId: "policy-7" }]] as const) {
      const { calls, authorize } = recording();
      const deps = { workspaceId: WORKSPACE_ID, roleRepo: { list: async () => [] }, policyRepo: { list: async () => [], findById: async () => POLICY }, policyPermissionRepo: { listByPolicyId: async () => [] } };
      await (route.handle as (a: unknown) => Promise<unknown>)({ input, deps, context: { id: "principal-7" }, authorize });
      expect(calls).toEqual([[{ permission: "role.manage" }]]);
      expect(Object.keys(calls[0]![0] as object)).toEqual(["permission"]);
    }
  });

  it("project the role and policy fields from workspace-scoped reads", async () => {
    const seen: unknown[] = [];
    const deps = {
      workspaceId: WORKSPACE_ID,
      roleRepo: { list: async (input: unknown) => { seen.push(input); return [ROLE]; } },
      policyRepo: { list: async (input: unknown) => { seen.push(input); return [POLICY]; } },
    };
    const { authorize } = recording();
    expect(await roleListRoute.handle({ input: {}, deps, context: { id: "p" }, authorize }))
      .toEqual({ ok: true, value: { roles: [{ id: "role-7", workspaceId: WORKSPACE_ID, name: "Reviewer", isBuiltin: true, version: 2 }] } });
    expect(await policyListRoute.handle({ input: {}, deps, context: { id: "p" }, authorize })).toEqual({ ok: true, value: { policies: [
      { id: "policy-7", workspaceId: WORKSPACE_ID, name: "Review", description: "Review content", isBuiltin: false, isFrozen: true, version: 4 },
    ] } });
    expect(seen).toEqual([{ workspaceId: WORKSPACE_ID }, { workspaceId: WORKSPACE_ID }]);
  });

  it("lists a found policy's permission rows verbatim, read by policy id", async () => {
    const seen: unknown[] = [];
    const deps = {
      workspaceId: WORKSPACE_ID,
      policyRepo: { findById: async (input: unknown) => { seen.push(input); return POLICY; } },
      policyPermissionRepo: { listByPolicyId: async (input: unknown) => { seen.push(input); return [ROW]; } },
    };
    expect(await policyPermissionListRoute.handle({ input: { policyId: "policy-7" }, deps, context: { id: "p" }, authorize: recording().authorize }))
      .toEqual({ ok: true, value: { policyPermissions: [ROW] } });
    expect(seen).toEqual([{ workspaceId: WORKSPACE_ID, id: "policy-7" }, { workspaceId: WORKSPACE_ID, policyId: "policy-7" }]);
  });

  it("answers a missing policy 404 RESOURCE_NOT_FOUND without listing orphan rows", async () => {
    const { reads, deps } = counting();
    const body = await refusalOf(() => policyPermissionListRoute.handle({
      input: { policyId: "" }, deps: { ...deps, policyRepo: { findById: async () => null } }, context: { id: "p" }, authorize: recording().authorize,
    }));
    expect(body).toEqual({ status: 404, body: { error: "policy '' was not found", code: "RESOURCE_NOT_FOUND" } });
    expect(reads()).toBe(0);
  });

  it("a denied authorization stops every repository read", async () => {
    const { reads, deps } = counting();
    const { authorize } = recording(false);
    for (const [route, input] of [[roleListRoute, {}], [policyListRoute, {}], [policyPermissionListRoute, { policyId: "policy-7" }]] as const) {
      await expect((route.handle as (a: unknown) => Promise<unknown>)({ input, deps, context: { id: "p" }, authorize })).rejects.toBeInstanceOf(RouteRefusalError);
    }
    expect(reads()).toBe(0);
  });

  it("rethrows a repository failure unchanged and fails closed without an authorizer", async () => {
    const failure = new Error("private storage detail");
    const fail = async () => { throw failure; };
    const deps = { workspaceId: WORKSPACE_ID, roleRepo: { list: fail }, policyRepo: { list: fail, findById: fail }, policyPermissionRepo: { listByPolicyId: fail } };
    for (const [route, input] of [[roleListRoute, {}], [policyListRoute, {}], [policyPermissionListRoute, { policyId: "policy-7" }]] as const) {
      const handle = route.handle as (a: unknown) => Promise<unknown>;
      await expect(handle({ input, deps, context: { id: "p" }, authorize: recording().authorize })).rejects.toBe(failure);
      await expect(handle({ input, deps, context: { id: "p" } })).rejects.toThrow(/no authorizer/);
    }
  });
});
