import { describe, expect, it } from "vitest";
import type { ToolExecutionContext, ToolRegistration } from "@jini-ai/core";
import { buildIdentityRegistrations, type IdentityToolDeps } from "../agent-tool-registrations.js";
import { renameHarness } from "./username-change.fixture.js";

// The handlers re-read principal/user rows after the domain write. These tests drive the
// read-back paths that only a concurrent change (or an orphaned principal) can reach, using
// delegating fakes over the real in-memory repositories.

function tool(deps: IdentityToolDeps, id: string): ToolRegistration {
  const found = buildIdentityRegistrations(deps).find((item) => item.descriptor.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}
function as(callerId: string, input: Record<string, unknown>): ToolExecutionContext {
  return { executionId: "e", run: { id: "r" }, principal: { id: callerId }, input, signal: new AbortController().signal };
}
/** A repository that delegates to `real`, except for the listed overrides. */
function delegating<T extends object>(real: T, overrides: Partial<T>): T {
  return new Proxy(real, {
    get(target, property) {
      if (property in overrides) return overrides[property as keyof T];
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}
async function orphanPrincipal(h: Awaited<ReturnType<typeof renameHarness>>, id: string) {
  await h.repos.principals.save({ id, workspaceId: "w", kind: "user", displayName: id, status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
}

describe("identity tool read-back consistency", () => {
  it("lists only principals that still have a user record", async () => {
    const h = await renameHarness();
    const alice = await h.user("alice");
    await orphanPrincipal(h, "orphan");
    const result = await tool(h.tools, "identity_user_list").handler(as(h.ownerPrincipalId, {})) as { users: { principalId: string }[] };
    const ids = result.users.map((u) => u.principalId);
    expect(ids).toContain(alice.principalId);
    expect(ids).not.toContain("orphan");
  });

  it("fails disable and enable loudly when the principal has no user record to project", async () => {
    const h = await renameHarness();
    await orphanPrincipal(h, "orphan");
    await expect(tool(h.tools, "identity_user_disable").handler(as(h.ownerPrincipalId, { principalId: "orphan" })))
      .rejects.toThrow("user 'orphan' was not found");
    await expect(tool(h.tools, "identity_user_enable").handler(as(h.ownerPrincipalId, { principalId: "orphan" })))
      .rejects.toThrow("user 'orphan' was not found");
  });

  it("fails the email and username updates when the principal vanishes after the write", async () => {
    const h = await renameHarness();
    const target = await h.user("target");
    let vanished = false;
    const users = delegating(h.repos.users, { save: async (record) => { await h.repos.users.save(record); vanished = true; } });
    const principals = delegating(h.repos.principals, {
      findById: async (required) => (vanished ? null : h.repos.principals.findById(required)),
    });
    const deps: IdentityToolDeps = { ...h.tools, userRepo: users, principalRepo: principals };
    await expect(tool(deps, "identity_user_update_email").handler(as(h.ownerPrincipalId, { principalId: target.principalId, email: "new@example.test" })))
      .rejects.toThrow(`principal '${target.principalId}' was not found`);
    vanished = false;
    await expect(tool(deps, "identity_user_change_username").handler(as(h.ownerPrincipalId, { principalId: target.principalId, username: "renamed" })))
      .rejects.toThrow(`principal '${target.principalId}' was not found`);
  });

  it("acknowledges a policy deletion with the deleted id", async () => {
    const h = await renameHarness();
    const created = await tool(h.tools, "identity_policy_create").handler(as(h.ownerPrincipalId, { name: "Temp" })) as { policy: { id: string } };
    const result = await tool(h.tools, "identity_policy_delete").handler(as(h.ownerPrincipalId, { policyId: created.policy.id }));
    expect(result).toEqual({ deleted: { policyId: created.policy.id } });
    expect(await h.repos.policies.findById({ workspaceId: "w", id: created.policy.id })).toBeNull();
  });
});
