import { describe, expect, it } from "vitest";
import { memberActorId, memberIdParam, rejectMemberError } from "../shared.js";
import { classifyMemberError, FakeMemberConflictError, refusalOf } from "./helpers.js";

describe("members route shared guards", () => {
  it("reads :memberId, falling back to an empty id when the host adapter filled none", () => {
    expect(memberIdParam({ memberId: "m1" })).toBe("m1");
    expect(memberIdParam({})).toBe("");
  });

  it("reads the actor id off the principal and fails closed without one", () => {
    expect(memberActorId({ context: { id: "p1" } })).toBe("p1");
    expect(() => memberActorId({ context: undefined })).toThrow(/no authenticated principal/);
  });

  it("refuses with the table's status for the classified kind and the error's own message", async () => {
    const err = new FakeMemberConflictError("clash");
    expect(await refusalOf(() => rejectMemberError({ err, classify: classifyMemberError, statuses: { conflict: 409 } }))).toEqual({ status: 409, body: { error: "clash" } });
  });

  it("rethrows an unclassified error, and a classified kind the route's table does not list, unchanged", () => {
    const plain = new Error("plain");
    expect(() => rejectMemberError({ err: plain, classify: classifyMemberError, statuses: { conflict: 409 } })).toThrow(plain);
    const conflict = new FakeMemberConflictError("clash");
    expect(() => rejectMemberError({ err: conflict, classify: classifyMemberError, statuses: { "not-found": 404 } })).toThrow(conflict);
  });

  it("uses String() for a classified non-Error throw", async () => {
    expect(await refusalOf(() => rejectMemberError({ err: "boom", classify: () => "validation", statuses: { validation: 400 } }))).toEqual({ status: 400, body: { error: "boom" } });
  });
});
