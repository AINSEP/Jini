import { describe, expect, it } from "vitest";
import { memberGetRoute } from "../get-by-id.js";
import { classifyMemberError, FakeMemberConflictError, FakeMemberNotFoundError, fakeMember, fakeMemberDto, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

type Lookup = { workspaceId: string; id: string };

function deps(findById: (input: Lookup) => Promise<ReturnType<typeof fakeMember> | null>, classify = classifyMemberError) {
  return { workspaceId: WORKSPACE_ID, memberRepo: { findById }, classifyMemberError: classify };
}

describe("memberGetRoute", () => {
  it("keeps the method and path and reads :memberId, falling back to an empty id", () => {
    expect(memberGetRoute.method).toBe("get");
    expect(memberGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/members/:memberId");
    expect(memberGetRoute.successStatus).toBeUndefined();
    expect(memberGetRoute.maxBodyBytes).toBeUndefined();
    expect(memberGetRoute.parse(raw({ memberId: "member-1" }))).toEqual({ ok: true, value: { memberId: "member-1" } });
    expect(memberGetRoute.parse(raw({}))).toEqual({ ok: true, value: { memberId: "" } });
  });

  it("authorizes member.manage for that member, reads it by id in this workspace and answers it in the `member` envelope", async () => {
    const lookups: Lookup[] = [];
    const { authorize, calls } = recordingAuthorize();
    const result = await memberGetRoute.handle({ input: { memberId: "member-1" }, deps: deps(async (input) => { lookups.push(input); return fakeMember(); }), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "member.manage", entityType: "member", entityId: "member-1" }]);
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID, id: "member-1" }]);
    expect(result).toEqual({ ok: true, value: { member: fakeMemberDto() } });
  });

  it("refuses an unknown member with 404 and the host's code-less body", async () => {
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => memberGetRoute.handle({ input: { memberId: "nope" }, deps: deps(async () => null), context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "member 'nope' was not found" },
    });
  });

  it("answers a repository that reports the miss by throwing the library's not-found with that error's own message", async () => {
    const { authorize } = recordingAuthorize();
    const missing = deps(async () => { throw new FakeMemberNotFoundError("member 'm9' was not found in storage"); });
    expect(await refusalOf(() => memberGetRoute.handle({ input: { memberId: "m9" }, deps: missing, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "member 'm9' was not found in storage" },
    });
  });

  it("maps only not-found: another library error, like any other failure, is rethrown for the host's 500", async () => {
    const { authorize } = recordingAuthorize();
    const conflict = deps(async () => { throw new FakeMemberConflictError("clash"); });
    await expect(memberGetRoute.handle({ input: { memberId: "m1" }, deps: conflict, context: PRINCIPAL, authorize })).rejects.toThrow("clash");
    const storage = deps(async () => { throw new Error("private storage details"); });
    await expect(memberGetRoute.handle({ input: { memberId: "m1" }, deps: storage, context: PRINCIPAL, authorize })).rejects.toThrow("private storage details");
  });

  it("uses the injected classifier, not a built-in one", async () => {
    const { authorize } = recordingAuthorize();
    const everythingIsMissing = deps(async () => { throw new Error("gone"); }, () => "not-found");
    expect(await refusalOf(() => memberGetRoute.handle({ input: { memberId: "m1" }, deps: everythingIsMissing, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "gone" },
    });
  });

  it("does not read the member when authorization refuses", async () => {
    const lookups: Lookup[] = [];
    const { authorize } = recordingAuthorize(["member.manage"]);
    await expect(memberGetRoute.handle({ input: { memberId: "m1" }, deps: deps(async (input) => { lookups.push(input); return fakeMember(); }), context: PRINCIPAL, authorize })).rejects.toThrow("denied member.manage");
    expect(lookups).toEqual([]);
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    await expect(memberGetRoute.handle({ input: { memberId: "m1" }, deps: deps(async () => fakeMember()), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
