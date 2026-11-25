import { expect, it, vi } from "vitest";
import { buildRegistrations } from "../permission-list-tool.js";

it("denial occurs before any lookup", async () => {
  const findById = vi.fn(async () => null);
  const listByPolicyId = vi.fn(async () => []);
  const [registration] = buildRegistrations({ deps: { workspaceId: "ws", authorize: async () => false,
    policyRepo: { findById }, policyPermissionRepo: { listByPolicyId } }, policy: { permission: "host.manage", policyReadToolId: "host.read" } });
  expect(registration).toBeDefined();
  await expect(registration!.handler({ executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: { policyId: "policy" }, signal: new AbortController().signal })).rejects.toThrow();
  expect(findById).not.toHaveBeenCalled();
  expect(listByPolicyId).not.toHaveBeenCalled();
});
