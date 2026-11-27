import { expect, test, vi } from "vitest";
import { createUsersApi } from "../api/users-api.js";

function api() {
  const request = vi.fn(async (_required: { path: string }, _optional?: { init?: RequestInit }) => ({ ok: true }));
  return { request, users: createUsersApi({ request: request as <T>(r: { path: string }, o?: { init?: RequestInit }) => Promise<T>, workspaceId: "ws1" }) };
}

test("list and create send the workspace path and the merged create body", async () => {
  const { request, users } = api();
  expect(await users.listUsers()).toEqual({ ok: true });
  await users.createUser({ username: "ana", password: "pw-1" }, { email: "ana@example.test" });
  await users.createUser({ username: "bo", password: "pw-2" });
  expect(request.mock.calls).toEqual([
    [{ path: "/workspaces/ws1/users" }],
    [{ path: "/workspaces/ws1/users" }, { init: { method: "POST", body: JSON.stringify({ username: "ana", password: "pw-1", email: "ana@example.test" }) } }],
    [{ path: "/workspaces/ws1/users" }, { init: { method: "POST", body: JSON.stringify({ username: "bo", password: "pw-2" }) } }],
  ]);
});

test("per-user calls encode the principal id and use the exact method and body", async () => {
  const { request, users } = api();
  const id = "u/1";
  await users.updateUser({ principalId: id }, { email: "x@example.test" });
  await users.updateUser({ principalId: id });
  await users.disableUser({ principalId: id });
  await users.enableUser({ principalId: id });
  await users.deleteUser({ principalId: id });
  await users.resetUserPassword({ principalId: id, password: "pw-3" });
  await users.assignRole({ principalId: id, roleId: "r1" });
  await users.attachPolicy({ principalId: id, policyId: "p1" });
  const base = "/workspaces/ws1/users/u%2F1";
  expect(request.mock.calls).toEqual([
    [{ path: base }, { init: { method: "PATCH", body: JSON.stringify({ email: "x@example.test" }) } }],
    [{ path: base }, { init: { method: "PATCH", body: "{}" } }],
    [{ path: `${base}/disable` }, { init: { method: "POST" } }],
    [{ path: `${base}/enable` }, { init: { method: "POST" } }],
    [{ path: base }, { init: { method: "DELETE" } }],
    [{ path: `${base}/reset-password` }, { init: { method: "POST", body: JSON.stringify({ password: "pw-3" }) } }],
    [{ path: `${base}/roles` }, { init: { method: "POST", body: JSON.stringify({ roleId: "r1" }) } }],
    [{ path: `${base}/policies` }, { init: { method: "POST", body: JSON.stringify({ policyId: "p1" }) } }],
  ]);
});
