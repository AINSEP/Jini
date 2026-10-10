import { expect, it } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import { buildIdentityRegistrations } from "../agent-tool-registrations.js";
import { renameHarness } from "./username-change.fixture.js";

it("uses the shared rename service for normalization, Trash conflicts and owner-only targets", async () => {
  const h = await renameHarness(); const manager = await h.user("manager"); await h.grant(manager.principalId, "user.manage");
  const target = await h.user("target"); const taken = await h.user("reserved"); h.trash.add(taken.principalId);
  const tool = buildIdentityRegistrations(h.tools).find(item => item.descriptor.id === "identity_user_change_username")!;
  const context = (callerId: string, principalId: string, username: string): ToolExecutionContext => ({
    executionId: "e", run: { id: "r" }, principal: { id: callerId }, input: { principalId, username }, signal: new AbortController().signal,
  });
  await expect(tool.handler(context(manager.principalId, h.ownerPrincipalId, "owner-name"))).rejects.toThrow("only an owner can modify an owner principal");
  await expect(tool.handler(context(manager.principalId, target.principalId, " RESERVED "))).rejects.toMatchObject({ code: "USERNAME_IN_TRASH" });
  expect(h.audit).toEqual([]);
  const result = await tool.handler(context(manager.principalId, target.principalId, " RENAMED "));
  expect(result).toEqual({ user: { principalId: target.principalId, username: "renamed", status: "active", roleIds: [], email: "kept@example.test" } });
  expect(h.audit).toHaveLength(1);
  await expect(tool.handler({ ...context(manager.principalId, target.principalId, "again"), input: { principalId: target.principalId, username: "again", password: "forbidden-input" } })).rejects.toThrow();
  expect(h.audit).toHaveLength(1);
});
