import { expect, test, vi } from "vitest";
import { createMembersApi } from "../api/members-api.js";

function api() {
  const request = vi.fn(async (_required: { path: string }, _optional?: { init?: RequestInit }) => ({ ok: true }));
  return { request, members: createMembersApi({ request: request as <T>(r: { path: string }, o?: { init?: RequestInit }) => Promise<T>, workspaceId: "ws1" }) };
}

test("member reads are GETs scoped to the workspace with the id path-encoded", async () => {
  const { request, members } = api();
  expect(await members.listMembers()).toEqual({ ok: true });
  await members.getMember({ id: "a/b c" });
  expect(request.mock.calls).toEqual([[{ path: "/workspaces/ws1/members" }], [{ path: "/workspaces/ws1/members/a%2Fb%20c" }]]);
});

test("disable and magic-link requests are POSTs with the exact body", async () => {
  const { request, members } = api();
  await members.disableMember({ id: "m/1" });
  await members.requestMemberMagicLink({ email: "a@example.test" }, { redirectPath: "/account" });
  await members.requestMemberMagicLink({ email: "b@example.test" });
  expect(request.mock.calls).toEqual([
    [{ path: "/workspaces/ws1/members/m%2F1/disable" }, { init: { method: "POST" } }],
    [{ path: "/workspaces/ws1/members/request-magic-link" }, { init: { method: "POST", body: JSON.stringify({ email: "a@example.test", redirectPath: "/account" }) } }],
    [{ path: "/workspaces/ws1/members/request-magic-link" }, { init: { method: "POST", body: JSON.stringify({ email: "b@example.test" }) } }],
  ]);
});
