import { ToolInputError } from "@jini-ai/core";
import { encodeListCursor } from "@jini-ai/core/list-page";
import { describe, expect, it } from "vitest";
import { memberListRoute } from "../list.js";
import { fakeMember, fakeMemberDto, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

type ListCall = [{ workspaceId: string }, { limit?: number; cursor?: string | null }?];

function repo(page: { items?: ReturnType<typeof fakeMember>[]; nextCursor?: string | null }, calls: ListCall[] = []) {
  return { list: async (...args: ListCall) => { calls.push(args); return { items: page.items ?? [], nextCursor: page.nextCursor ?? null }; } };
}

describe("memberListRoute", () => {
  it("keeps the method and path, answers 200 and declares no body cap", () => {
    expect(memberListRoute.method).toBe("get");
    expect(memberListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/members");
    expect(memberListRoute.successStatus).toBeUndefined();
    expect(memberListRoute.maxBodyBytes).toBeUndefined();
  });

  // The same eight query shapes the host's wire test drives through Express.
  const cases: [string, Record<string, unknown>, unknown][] = [
    ["absent", {}, { cursor: null }],
    ["a non-numeric limit is the repo's own page size", { limit: "no" }, { cursor: null }],
    ["an infinite limit", { limit: "Infinity" }, { cursor: null }],
    ["a zero limit", { limit: "0" }, { cursor: null }],
    ["a negative limit", { limit: "-1" }, { cursor: null }],
    ["a limit with the older afterId cursor", { limit: "2", afterId: "previous" }, { limit: 2, cursor: encodeListCursor({ position: ["previous"] }) }],
    ["object-valued (qs bracket) limit and afterId", { limit: { x: "2" }, afterId: { x: "bad" } }, { cursor: null }],
    ["a limit with an opaque cursor", { limit: "2", cursor: "opaque" }, { limit: 2, cursor: "opaque" }],
    ["a cursor wins over afterId", { cursor: "opaque", afterId: "previous" }, { cursor: "opaque" }],
    ["an empty cursor falls back to afterId", { cursor: "", afterId: "previous" }, { cursor: encodeListCursor({ position: ["previous"] }) }],
    ["an empty afterId is no cursor", { afterId: "" }, { cursor: null }],
    ["a repeated (array) limit is ignored", { limit: ["2", "3"] }, { cursor: null }],
  ];
  for (const [name, query, value] of cases) {
    it(`parses the query: ${name}`, () => {
      expect(memberListRoute.parse(raw({}, query))).toEqual({ ok: true, value });
    });
  }

  it("authorizes member.manage with no entity id, passes the parsed page request through and answers members + nextCursor", async () => {
    const calls: ListCall[] = [];
    const { authorize, calls: asked } = recordingAuthorize();
    const input = { limit: 2, cursor: "opaque" };
    const result = await memberListRoute.handle({ input, deps: { workspaceId: WORKSPACE_ID, memberRepo: repo({ items: [fakeMember()], nextCursor: "next-page" }, calls) }, context: PRINCIPAL, authorize }, { signal });
    expect(asked).toEqual([{ permission: "member.manage", entityType: "member" }]);
    expect(Object.keys(asked[0] ?? {})).not.toContain("entityId");
    expect(calls).toEqual([[{ workspaceId: WORKSPACE_ID }, { limit: 2, cursor: "opaque" }]]);
    // The serializer is the chokepoint: note, fields and credentialsRevokedAt never reach the admin list.
    expect(result).toEqual({ ok: true, value: { members: [fakeMemberDto()], nextCursor: "next-page" } });
  });

  it("answers an empty last page with nextCursor null", async () => {
    const { authorize } = recordingAuthorize();
    const result = await memberListRoute.handle({ input: { cursor: null }, deps: { workspaceId: WORKSPACE_ID, memberRepo: repo({}) }, context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { members: [], nextCursor: null } });
  });

  it("answers a cursor the list did not issue (the repo's ToolInputError) as the host's 400 with VALIDATION_ERROR", async () => {
    const { authorize } = recordingAuthorize();
    const memberRepo = { list: async () => { throw new ToolInputError({ message: "invalid cursor" }); } };
    expect(await refusalOf(() => memberListRoute.handle({ input: { cursor: "forged" }, deps: { workspaceId: WORKSPACE_ID, memberRepo }, context: PRINCIPAL, authorize }))).toEqual({
      status: 400, body: { error: "invalid cursor", code: "VALIDATION_ERROR" },
    });
  });

  it("rethrows any other repository failure unchanged, so the host's error port answers the 500", async () => {
    const { authorize } = recordingAuthorize();
    const memberRepo = { list: async () => { throw new Error("private storage details"); } };
    await expect(memberListRoute.handle({ input: { cursor: null }, deps: { workspaceId: WORKSPACE_ID, memberRepo }, context: PRINCIPAL, authorize })).rejects.toThrow("private storage details");
  });

  it("does not read the list when authorization refuses", async () => {
    const calls: ListCall[] = [];
    const { authorize } = recordingAuthorize(["member.manage"]);
    await expect(memberListRoute.handle({ input: { cursor: null }, deps: { workspaceId: WORKSPACE_ID, memberRepo: repo({}, calls) }, context: PRINCIPAL, authorize })).rejects.toThrow("denied member.manage");
    expect(calls).toEqual([]);
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    await expect(memberListRoute.handle({ input: { cursor: null }, deps: { workspaceId: WORKSPACE_ID, memberRepo: repo({}) }, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
