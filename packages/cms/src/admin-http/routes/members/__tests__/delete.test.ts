import { describe, expect, it } from "vitest";
import { memberDeleteRoute, type MemberTrashFn } from "../delete.js";
import { classifyMemberError, FakeMemberConflictError, FakeMemberNotFoundError, FakeMemberValidationError, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const deps = (trashMember: MemberTrashFn, classify = classifyMemberError) => ({ workspaceId: WORKSPACE_ID, trashMember, classifyMemberError: classify });
const input = { memberId: "member-1" };

describe("memberDeleteRoute", () => {
  it("keeps the method and path and reads :memberId, falling back to an empty id", () => {
    expect(memberDeleteRoute.method).toBe("delete");
    expect(memberDeleteRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/members/:memberId");
    expect(memberDeleteRoute.successStatus).toBeUndefined();
    expect(memberDeleteRoute.maxBodyBytes).toBeUndefined();
    expect(memberDeleteRoute.parse(raw({ memberId: "member-1" }))).toEqual({ ok: true, value: input });
    expect(memberDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { memberId: "" } });
  });

  it("authorizes member.manage for the member, trashes it as the principal and answers the trash result", async () => {
    const asked: unknown[] = [];
    const trashMember: MemberTrashFn = async (required) => { asked.push(required); return { deleted: true }; };
    const { authorize, calls } = recordingAuthorize();
    const result = await memberDeleteRoute.handle({ input, deps: deps(trashMember), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "member.manage", entityType: "member", entityId: "member-1" }]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, memberId: "member-1", actor: { principalId: PRINCIPAL.id } }]);
    expect(result).toEqual({ ok: true, value: { deleted: true } });
  });

  // The ladder the hand-written route had: each library error keeps its own status and a code-less body.
  for (const [error, status] of [
    [new FakeMemberNotFoundError("member 'member-1' was not found"), 404],
    [new FakeMemberConflictError("Member changed; read it again before deleting"), 409],
    [new FakeMemberValidationError("Member Trash is unavailable in this runtime"), 400],
  ] as const) {
    it(`maps ${error.constructor.name} to a code-less ${status}`, async () => {
      const { authorize } = recordingAuthorize();
      const trashMember: MemberTrashFn = async () => { throw error; };
      expect(await refusalOf(() => memberDeleteRoute.handle({ input, deps: deps(trashMember), context: PRINCIPAL, authorize }))).toEqual({ status, body: { error: error.message } });
    });
  }

  it("rethrows an unmapped failure unchanged, so the host's error port answers the redacted 500", async () => {
    const { authorize } = recordingAuthorize();
    const trashMember: MemberTrashFn = async () => { throw new Error("private storage details"); };
    await expect(memberDeleteRoute.handle({ input, deps: deps(trashMember), context: PRINCIPAL, authorize })).rejects.toThrow("private storage details");
  });

  it("uses the injected classifier, not a built-in one", async () => {
    const { authorize } = recordingAuthorize();
    const trashMember: MemberTrashFn = async () => { throw new Error("stale row"); };
    expect(await refusalOf(() => memberDeleteRoute.handle({ input, deps: deps(trashMember, () => "conflict"), context: PRINCIPAL, authorize }))).toEqual({
      status: 409, body: { error: "stale row" },
    });
  });

  it("does not trash when authorization refuses, and fails closed without a principal or an authorizer", async () => {
    let trashed = 0;
    const trashMember: MemberTrashFn = async () => { trashed += 1; return { deleted: true }; };
    const { authorize } = recordingAuthorize(["member.manage"]);
    await expect(memberDeleteRoute.handle({ input, deps: deps(trashMember), context: PRINCIPAL, authorize })).rejects.toThrow("denied member.manage");
    await expect(memberDeleteRoute.handle({ input, deps: deps(trashMember), authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    await expect(memberDeleteRoute.handle({ input, deps: deps(trashMember), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(trashed).toBe(0);
  });
});
