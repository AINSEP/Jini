import { expect, it, vi } from "vitest";
import { buildRegistrations, contributeIdentityPolicyListPermissionsTools } from "../permission-list-tool.js";

it("denial occurs before any lookup", async () => {
  const findById = vi.fn(async () => null);
  const listByPolicyId = vi.fn(async () => []);
  const [registration] = buildRegistrations({ deps: { workspaceId: "ws", authorize: async () => ({ allowed: false, reason: "denied" }),
    policyRepo: { findById }, policyPermissionRepo: { listByPolicyId } }, policy: { permission: "host.manage", policyReadToolId: "host.read" } });
  expect(registration).toBeDefined();
  await expect(registration!.handler({ executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: { policyId: "policy" }, signal: new AbortController().signal })).rejects.toThrow();
  expect(findById).not.toHaveBeenCalled();
  expect(listByPolicyId).not.toHaveBeenCalled();
});

function allowedTool(policies: Record<string, { id: string; name: string }>, grants: Record<string, { id: string; permission: string }[]>) {
  const lookups: string[] = [];
  const [registration] = buildRegistrations({ deps: { workspaceId: "ws", authorize: async () => ({ allowed: true }),
    policyRepo: { findById: async ({ workspaceId, id }) => { lookups.push(`policy:${workspaceId}:${id}`); const p = policies[id]; return p ? { ...p, workspaceId, isBuiltin: false, isFrozen: false, version: 1 } : null; } },
    policyPermissionRepo: { listByPolicyId: async ({ workspaceId, policyId }) => { lookups.push(`grants:${workspaceId}:${policyId}`);
      return (grants[policyId] ?? []).map((g) => ({ ...g, workspaceId, policyId, resourceType: null, constraintJson: null })); } } },
  policy: { permission: "host.manage", policyReadToolId: "host_policy_read" } });
  const call = (input: unknown) => registration!.handler({ executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input, signal: new AbortController().signal });
  return { call, lookups };
}

it("returns the policy's grants, and an empty list when it grants nothing", async () => {
  const { call, lookups } = allowedTool({ p1: { id: "p1", name: "Content" }, p2: { id: "p2", name: "Empty" } }, { p1: [{ id: "g1", permission: "page.edit" }] });
  expect(await call({ policyId: "p1" })).toEqual({ policyPermissions: [{ id: "g1", workspaceId: "ws", policyId: "p1", permission: "page.edit", resourceType: null, constraintJson: null }] });
  expect(await call({ policyId: "p2" })).toEqual({ policyPermissions: [] });
  expect(lookups).toEqual(["policy:ws:p1", "grants:ws:p1", "policy:ws:p2", "grants:ws:p2"]);
});

it("refuses a blank or non-string policy id before any lookup", async () => {
  const { call, lookups } = allowedTool({}, {});
  await expect(call({ policyId: "  " })).rejects.toThrow("policyId must be a non-empty string.");
  await expect(call({ policyId: 7 })).rejects.toThrow("policyId must be a non-empty string.");
  expect(lookups).toEqual([]);
});

it("refuses an unknown policy with the read tool to use, without listing grants", async () => {
  const { call, lookups } = allowedTool({}, {});
  await expect(call({ policyId: "ghost" })).rejects.toThrow("policy 'ghost' was not found. Use host_policy_read to find a policy id.");
  expect(lookups).toEqual(["policy:ws:ghost"]);
});

it("the contributor builds the same single read-only tool under its own domain, gated by the host permission", async () => {
  const contributor = contributeIdentityPolicyListPermissionsTools({ policy: { permission: "host.manage", policyReadToolId: "host_policy_read" } });
  expect(contributor.domain).toBe("identity-policy-list-permissions");
  expect(contributor.risk.get("identity_policy_list_permissions")).toBe("none");
  const asked: unknown[] = [];
  const built = contributor.build({ workspaceId: "ws", authorize: async (...args: unknown[]) => { asked.push(...args); return { allowed: true }; },
    policyRepo: { findById: async () => null }, policyPermissionRepo: { listByPolicyId: async () => [] } }, undefined);
  expect(built.map((r) => r.descriptor.id)).toEqual(["identity_policy_list_permissions"]);
  expect(built[0]?.descriptor.description).toContain("host_policy_read");
  await expect(built[0]!.handler({ executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: { policyId: "ghost" }, signal: new AbortController().signal }))
    .rejects.toThrow("policy 'ghost' was not found");
  expect(JSON.stringify(asked)).toContain("host.manage");
});
