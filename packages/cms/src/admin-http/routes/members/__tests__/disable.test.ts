import { describe, expect, it } from "vitest";
import { memberDisableRoute, type MemberDisableFn } from "../disable.js";
import { classifyMemberError, FakeMemberConflictError, FakeMemberNotFoundError, FakeMemberValidationError, fakeMember, fakeMemberDto, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const deps = (disableMember: MemberDisableFn, classify = classifyMemberError) => ({ workspaceId: WORKSPACE_ID, disableMember, classifyMemberError: classify });
const input = { memberId: "member-1" };

describe("memberDisableRoute", () => {
  it("keeps the method and path and reads :memberId, falling back to an empty id", () => {
    expect(memberDisableRoute.method).toBe("post");
    expect(memberDisableRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/members/:memberId/disable");
    expect(memberDisableRoute.successStatus).toBeUndefined();
    expect(memberDisableRoute.maxBodyBytes).toBeUndefined();
    expect(memberDisableRoute.parse(raw({ memberId: "member-1" }))).toEqual({ ok: true, value: input });
    expect(memberDisableRoute.parse(raw({}))).toEqual({ ok: true, value: { memberId: "" } });
  });

  it("authorizes member.manage for the member, disables it in this workspace and answers it in the `member` envelope", async () => {
    const asked: unknown[] = [];
    const disableMember: MemberDisableFn = async (required) => { asked.push(required); return { member: fakeMember({ status: "disabled" }) }; };
    const { authorize, calls } = recordingAuthorize();
    const result = await memberDisableRoute.handle({ input, deps: deps(disableMember), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "member.manage", entityType: "member", entityId: "member-1" }]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, memberId: "member-1" }]);
    // Only the nine admin fields: note, fields and credentialsRevokedAt stay on the server.
    expect(result).toEqual({ ok: true, value: { member: fakeMemberDto({ status: "disabled" }) } });
  });

  for (const [error, status] of [
    [new FakeMemberNotFoundError("member 'member-1' was not found"), 404],
    [new FakeMemberValidationError("member cannot be disabled"), 400],
  ] as const) {
    it(`maps ${error.constructor.name} to a code-less ${status}`, async () => {
      const { authorize } = recordingAuthorize();
      const disableMember: MemberDisableFn = async () => { throw error; };
      expect(await refusalOf(() => memberDisableRoute.handle({ input, deps: deps(disableMember), context: PRINCIPAL, authorize }))).toEqual({ status, body: { error: error.message } });
    });
  }

  it("never mapped a conflict: it is rethrown with every other unmapped failure for the host's 500", async () => {
    const { authorize } = recordingAuthorize();
    for (const error of [new FakeMemberConflictError("clash"), new Error("private storage details")]) {
      const disableMember: MemberDisableFn = async () => { throw error; };
      await expect(memberDisableRoute.handle({ input, deps: deps(disableMember), context: PRINCIPAL, authorize })).rejects.toThrow(error.message);
    }
  });

  it("uses the injected classifier, not a built-in one", async () => {
    const { authorize } = recordingAuthorize();
    const disableMember: MemberDisableFn = async () => { throw new Error("odd"); };
    expect(await refusalOf(() => memberDisableRoute.handle({ input, deps: deps(disableMember, () => "validation"), context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "odd" },
    });
  });

  it("does not disable when authorization refuses, and fails closed without an authorizer", async () => {
    let disabled = 0;
    const disableMember: MemberDisableFn = async () => { disabled += 1; return { member: fakeMember() }; };
    const { authorize } = recordingAuthorize(["member.manage"]);
    await expect(memberDisableRoute.handle({ input, deps: deps(disableMember), context: PRINCIPAL, authorize })).rejects.toThrow("denied member.manage");
    await expect(memberDisableRoute.handle({ input, deps: deps(disableMember), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    expect(disabled).toBe(0);
  });
});
