import { expect, test, vi } from "vitest";
import { createRolesApi } from "../api/roles-api.js";

function api() {
  const send = vi.fn(async (_required: { path: string; method: string; body?: unknown }) => ({ ok: true }));
  return { send, roles: createRolesApi({ authenticatedAdminRequest: send as <T>(r: { path: string; method: string; body?: unknown }) => Promise<T>, workspaceId: "ws1" }) };
}

test("role calls use the exact method, encoded path and body", async () => {
  const { send, roles } = api();
  expect(await roles.listRoles()).toEqual({ ok: true });
  await roles.createRole({ name: "Editors" });
  await roles.updateRole({ roleId: "r/1", name: "Writers", expectedVersion: 3 });
  await roles.deleteRole({ roleId: "r/1" });
  expect(send.mock.calls.map(([input]) => input)).toEqual([
    { method: "GET", path: "/workspaces/ws1/roles" },
    { method: "POST", path: "/workspaces/ws1/roles", body: { name: "Editors" } },
    { method: "PATCH", path: "/workspaces/ws1/roles/r%2F1", body: { name: "Writers", expectedVersion: 3 } },
    { method: "DELETE", path: "/workspaces/ws1/roles/r%2F1" },
  ]);
});

test("policy calls carry optional description and partial updates verbatim", async () => {
  const { send, roles } = api();
  await roles.listPolicies();
  await roles.createPolicy({ name: "Read" }, { description: "read only" });
  await roles.createPolicy({ name: "Bare" });
  await roles.updatePolicy({ policyId: "p 1" }, { name: "N", expectedVersion: 2 });
  await roles.updatePolicy({ policyId: "p 1" });
  await roles.deletePolicy({ policyId: "p 1" });
  expect(send.mock.calls.map(([input]) => input)).toEqual([
    { method: "GET", path: "/workspaces/ws1/policies" },
    { method: "POST", path: "/workspaces/ws1/policies", body: { name: "Read", description: "read only" } },
    { method: "POST", path: "/workspaces/ws1/policies", body: { name: "Bare", description: undefined } },
    { method: "PATCH", path: "/workspaces/ws1/policies/p%201", body: { name: "N", expectedVersion: 2 } },
    { method: "PATCH", path: "/workspaces/ws1/policies/p%201", body: {} },
    { method: "DELETE", path: "/workspaces/ws1/policies/p%201" },
  ]);
});

test("policy permission calls drop an empty resource type and encode both ids", async () => {
  const { send, roles } = api();
  await roles.writePolicyPermission({ policyId: "p/1", permission: "content.read" }, { resourceType: "page" });
  await roles.writePolicyPermission({ policyId: "p/1", permission: "content.read" }, { resourceType: "" });
  await roles.writePolicyPermission({ policyId: "p/1", permission: "content.read" });
  await roles.listPolicyPermissions({ policyId: "p/1" });
  await roles.removePolicyPermission({ policyId: "p/1", policyPermissionId: "pp/2" });
  expect(send.mock.calls.map(([input]) => input)).toEqual([
    { method: "POST", path: "/workspaces/ws1/policies/p%2F1/permissions", body: { permission: "content.read", resourceType: "page" } },
    { method: "POST", path: "/workspaces/ws1/policies/p%2F1/permissions", body: { permission: "content.read", resourceType: undefined } },
    { method: "POST", path: "/workspaces/ws1/policies/p%2F1/permissions", body: { permission: "content.read", resourceType: undefined } },
    { method: "GET", path: "/workspaces/ws1/policies/p%2F1/permissions" },
    { method: "DELETE", path: "/workspaces/ws1/policies/p%2F1/permissions/pp%2F2" },
  ]);
});
