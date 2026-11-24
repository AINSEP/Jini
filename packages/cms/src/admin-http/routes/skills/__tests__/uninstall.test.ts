import { describe, expect, it } from "vitest";
import { skillUninstallRoute, type SkillUninstallRouteDeps } from "../uninstall.js";
import { FakeSkillInputError, isSkillInputError, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, SKILLS_AUTH, WORKSPACE_ID } from "./helpers.js";

function deps(overrides: Partial<SkillUninstallRouteDeps> = {}) {
  const removals: unknown[] = [];
  const d: SkillUninstallRouteDeps = { workspaceId: WORKSPACE_ID, uninstallSkill: async (input) => { removals.push(input); }, isSkillInputError, ...overrides };
  return { deps: d, removals };
}
const run = (d: SkillUninstallRouteDeps, authorize = recordingAuthorize().authorize) =>
  skillUninstallRoute.handle({ input: { toolId: "skill_a" }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("skillUninstallRoute", () => {
  it("keeps the method, path, status and no body cap; reads :toolId as a string", () => {
    expect(skillUninstallRoute.method).toBe("delete");
    expect(skillUninstallRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/skills/:toolId");
    expect(skillUninstallRoute.successStatus).toBeUndefined();
    expect(skillUninstallRoute.maxBodyBytes).toBeUndefined();
    expect(skillUninstallRoute.parse(raw({ toolId: "skill_a" }))).toEqual({ ok: true, value: { toolId: "skill_a" } });
    expect(skillUninstallRoute.parse(raw({}))).toEqual({ ok: true, value: { toolId: "undefined" } });
  });

  it("authorizes id-free, removes the skill from the served workspace and answers { removed: true }", async () => {
    const { deps: d, removals } = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await run(d, authorize)).toEqual({ ok: true, value: { removed: true } });
    expect(calls).toEqual(SKILLS_AUTH);
    expect(removals).toEqual([{ workspaceId: WORKSPACE_ID, toolId: "skill_a" }]);
  });

  it("removes nothing when authorization refuses, and fails closed without an authorizer", async () => {
    const { deps: d, removals } = deps();
    await expect(run(d, recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(skillUninstallRoute.handle({ input: { toolId: "skill_a" }, deps: d, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    expect(removals).toEqual([]);
  });

  it("maps the service's input error to the validation 400 and rethrows anything else", async () => {
    expect(await refusalOf(() => run(deps({ uninstallSkill: async () => { throw new FakeSkillInputError("Unknown skill."); } }).deps)))
      .toEqual({ status: 400, body: { error: "Unknown skill.", code: "VALIDATION_ERROR" } });
    await expect(run(deps({ uninstallSkill: async () => { throw new Error("io"); } }).deps)).rejects.toThrow("io");
  });
});
