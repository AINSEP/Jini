import { createHash } from "node:crypto";
import { ToolInputError } from "@jini-ai/core";
import { describe, expect, it } from "vitest";
import { skillListRoute, type SkillListRouteDeps } from "../list.js";
import { PRINCIPAL, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const PATH = "/api/admin/v1/workspaces/:workspaceId/skills";
const SKILLS = [{ toolId: "skill_a", name: "a", enabled: true }, { toolId: "skill_b", name: "é ✓", enabled: false }];

/** The ETag the hand-written Express route sent: Node's sha256 of the exact JSON body, base64url, weak. */
const nodeEtag = (body: string) => `W/"${createHash("sha256").update(body).digest("base64url")}"`;

/** An authorizer that records exactly the keys it received (an absent `entityType` must stay absent). */
function recorder(deny = false) {
  const calls: unknown[] = [];
  const authorize = async (required: { permission: string; entityType?: string }, ...scope: unknown[]) => {
    calls.push(scope.length === 0 ? required : [required, ...scope]);
    if (deny) throw new Error("denied admin.assistant.use");
  };
  return { calls, authorize };
}

function deps(skills: readonly unknown[] = SKILLS) {
  const lists: unknown[] = [];
  const d: SkillListRouteDeps = { workspaceId: WORKSPACE_ID, listManagedSkills: async (input = {}) => { lists.push(input); return skills; } };
  return { deps: d, lists };
}

const run = (d: SkillListRouteDeps, ifNoneMatch?: string, authorize = recorder().authorize) =>
  skillListRoute.handle({ input: { ifNoneMatch }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("skillListRoute", () => {
  it("keeps the method, path, status and no body cap; opts into If-None-Match only", () => {
    expect(skillListRoute.method).toBe("get");
    expect(skillListRoute.path).toBe(PATH);
    expect(skillListRoute.successStatus).toBeUndefined();
    expect(skillListRoute.maxBodyBytes).toBeUndefined();
    expect(skillListRoute.readHeaders).toEqual(["if-none-match"]);
    expect(skillListRoute.parse({ body: {}, query: {}, params: {}, headers: { "if-none-match": "W/\"x\"" } })).toEqual({ ok: true, value: { ifNoneMatch: "W/\"x\"" } });
    expect(skillListRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: { ifNoneMatch: undefined } });
  });

  it("answers 200 with the listing, private no-cache, Vary: Cookie and the byte-identical Node ETag", async () => {
    const { deps: d } = deps();
    const result = await run(d);
    expect(result).toEqual({ ok: true, value: { status: 200, body: { skills: SKILLS }, headers: {
      "Cache-Control": "private, no-cache", ETag: nodeEtag(JSON.stringify({ skills: SKILLS })), Vary: "Cookie",
    } } });
    const empty = await run(deps([]).deps);
    expect(empty.ok && empty.value.headers?.ETag).toBe(nodeEtag(JSON.stringify({ skills: [] })));
  });

  it("answers a bare 304 with the same validators when any listed tag matches, else 200", async () => {
    const { deps: d } = deps();
    const etag = nodeEtag(JSON.stringify({ skills: SKILLS }));
    const headers = { "Cache-Control": "private, no-cache", ETag: etag, Vary: "Cookie" };
    for (const tag of [etag, `W/"other", ${etag}`, `  ${etag}  `]) {
      expect(await run(d, tag)).toEqual({ ok: true, value: { status: 304, headers } });
    }
    for (const tag of ["W/\"other\"", "*", etag.slice(2), ""]) {
      const answer = await run(d, tag);
      expect(answer.ok && answer.value.status).toBe(200);
    }
  });

  it("authorizes admin.assistant.use with no entity type and no scope, before listing", async () => {
    const { deps: d, lists } = deps();
    const { authorize, calls } = recorder();
    await run(d, undefined, authorize);
    expect(calls).toEqual([{ permission: "admin.assistant.use" }]);
    expect(Object.keys(calls[0] as object)).toEqual(["permission"]);
    expect(lists).toEqual([{}]);
  });

  it("never lists when authorization refuses (even with a matching validator), and fails closed without an authorizer", async () => {
    const { deps: d, lists } = deps();
    await expect(run(d, nodeEtag(JSON.stringify({ skills: SKILLS })), recorder(true).authorize)).rejects.toThrow("denied");
    await expect(skillListRoute.handle({ input: { ifNoneMatch: undefined }, deps: d, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    expect(lists).toEqual([]);
  });

  it("answers a discovery input error verbatim as a flat 500 INTERNAL_ERROR; rethrows anything else unchanged", async () => {
    const message = "skills: 'x' is declared by more than one installed skill folder";
    const failing = (error: unknown): SkillListRouteDeps => ({ workspaceId: WORKSPACE_ID, listManagedSkills: async () => { throw error; } });
    expect(await refusalOf(() => run(failing(new ToolInputError({ message }))))).toEqual({ status: 500, body: { error: message, code: "INTERNAL_ERROR" } });
    const secret = new Error("EACCES /private/path");
    await expect(run(failing(secret))).rejects.toBe(secret);
  });
});
