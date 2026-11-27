import { expect, it, vi } from "vitest";
import { requestSignInLink } from "@jini-ai/user-management/members/member-challenge-request";
import type { ToolExecutionContext } from "@jini-ai/core";
import { membersAgentToolCatalog } from "../agent-tools.js";
import { buildMembersRegistrations, type MembersToolDeps } from "../tool-registrations.js";

// The unit imports the challenge module through its package specifier, so the mock must name that specifier.
vi.mock("@jini-ai/user-management/members/member-challenge-request", () => ({ requestSignInLink: vi.fn(async () => ({ delivered: true, token: "private-challenge-token" })) }));
const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input: { memberId: "member" }, signal: new AbortController().signal };

it("read projection withholds credentials and private profile fields", async () => {
  const member = { id: "member", email: "person@example.test", status: "active", name: "Person", emailVerifiedAt: "verified", createdAt: "created", updatedAt: "updated", version: 1,
    passwordHash: "secret", note: "private", fields: { secret: true } };
  const deps = { catalog: membersAgentToolCatalog, hostReads: { readRef: () => "read member" }, memberRepo: { findById: async () => member },
    workspaceId: "w", authorize: async () => ({ allowed: true, reason: "grant" }) } as unknown as MembersToolDeps;
  const tool = buildMembersRegistrations(deps).find(item => item.descriptor.id === "members_get_by_id")!;
  expect(await tool.handler(ctx)).toEqual({ member: { id: "member", email: "person@example.test", status: "active", name: "Person", emailVerifiedAt: "verified", createdAt: "created", updatedAt: "updated", version: 1 } });
});

it("denied authorization performs no member write", async () => {
  const removeMember = vi.fn();
  const findById = vi.fn();
  const deps = { catalog: membersAgentToolCatalog, hostReads: { readRef: () => "read member" }, memberRepo: { findById }, removeMember,
    workspaceId: "w", authorize: async () => ({ allowed: false, reason: "denied" }) } as unknown as MembersToolDeps;
  const tool = buildMembersRegistrations(deps).find(item => item.descriptor.id === "members_delete")!;
  await expect(tool.handler(ctx)).rejects.toThrow(/not authorized/);
  expect(findById).not.toHaveBeenCalled();
  expect(removeMember).not.toHaveBeenCalled();
});

it("magic-link result exposes delivery only", async () => {
  const deps = { catalog: membersAgentToolCatalog, hostReads: { readRef: () => "read member" }, workspaceId: "w", authorize: async () => ({ allowed: true, reason: "grant" }),
    magicLinkPerEmailLimiter: { check: async () => ({ allowed: true }) }, mailTransport: {} } as unknown as MembersToolDeps;
  const tool = buildMembersRegistrations(deps).find(item => item.descriptor.id === "members_request_magic_link")!;
  expect(await tool.handler({ ...ctx, input: { email: "person@example.test" } })).toEqual({ delivered: true, mailDeliveryAvailable: true });
});

it("magic-link settles the mailer first and forwards the email and a string redirectPath to the challenge request", async () => {
  const order: string[] = [];
  vi.mocked(requestSignInLink).mockClear();
  vi.mocked(requestSignInLink).mockImplementationOnce(async () => { order.push("request"); return { delivered: false, challengeId: "ch-1" }; });
  const deps = { catalog: membersAgentToolCatalog, hostReads: { readRef: () => "read member" }, workspaceId: "w", authorize: async () => ({ allowed: true, reason: "grant" }),
    magicLinkPerEmailLimiter: { check: async () => ({ allowed: true }) }, mailTransport: {}, settleMailer: async () => { order.push("settle"); } } as unknown as MembersToolDeps;
  const tool = buildMembersRegistrations(deps).find(item => item.descriptor.id === "members_request_magic_link")!;
  expect(await tool.handler({ ...ctx, input: { email: "person@example.test", redirectPath: "/account" } })).toEqual({ delivered: false, mailDeliveryAvailable: true });
  expect(order).toEqual(["settle", "request"]);
  expect(vi.mocked(requestSignInLink).mock.calls[0]?.[0].input).toEqual({ workspaceId: "w", email: "person@example.test", redirectPath: "/account" });
  await tool.handler({ ...ctx, input: { email: "person@example.test", redirectPath: 7 } });
  expect(vi.mocked(requestSignInLink).mock.calls[1]?.[0].input).toEqual({ workspaceId: "w", email: "person@example.test" });
});
