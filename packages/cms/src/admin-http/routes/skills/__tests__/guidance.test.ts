import { describe, expect, it } from "vitest";
import { skillGuidanceRoute, type SkillGuidanceRouteDeps } from "../guidance.js";
import { FakeSkillInputError, fakeSources, isSkillInputError, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, SKILLS_AUTH, WORKSPACE_ID } from "./helpers.js";

const SOURCE = { id: "skill_a", directory: "a" };
function deps(overrides: Partial<SkillGuidanceRouteDeps> = {}) {
  const builds: unknown[] = [];
  const contexts: unknown[] = [];
  const sources = fakeSources([SOURCE]);
  const d: SkillGuidanceRouteDeps = {
    workspaceId: WORKSPACE_ID,
    loadSkillSources: sources.loadSkillSources,
    skillRegistrations: { build: ({ source }) => { builds.push(source); return { handler: async (ctx) => { contexts.push(ctx); return { skillName: "a", guidance: "# A" }; } }; } },
    isSkillInputError,
    ...overrides,
  };
  return { deps: d, builds, contexts, loads: sources.calls };
}
const run = (d: SkillGuidanceRouteDeps, toolId = "skill_a", authorize = recordingAuthorize().authorize) =>
  skillGuidanceRoute.handle({ input: { toolId }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("skillGuidanceRoute", () => {
  it("keeps the method, path, status and no body cap; reads :toolId as a string", () => {
    expect(skillGuidanceRoute.method).toBe("get");
    expect(skillGuidanceRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/skills/:toolId/guidance");
    expect(skillGuidanceRoute.successStatus).toBeUndefined();
    expect(skillGuidanceRoute.maxBodyBytes).toBeUndefined();
    expect(skillGuidanceRoute.parse(raw({ toolId: "skill_a" }))).toEqual({ ok: true, value: { toolId: "skill_a" } });
  });

  it("authorizes id-free, loads enabled skills only, and answers the selected skill's own read-only handler payload", async () => {
    const { deps: d, builds, contexts, loads } = deps();
    const { authorize, calls } = recordingAuthorize();
    expect(await run(d, "skill_a", authorize)).toEqual({ ok: true, value: { skillName: "a", guidance: "# A" } });
    expect(calls).toEqual(SKILLS_AUTH);
    expect(loads).toEqual([{}]);
    expect(builds).toEqual([SOURCE]);
    expect(contexts).toEqual([{ executionId: "skill-preview", principal: { id: PRINCIPAL.id }, run: { id: "skill-preview" }, input: {}, signal: expect.any(AbortSignal) }]);
  });

  it("answers the skills 404 for an unknown or disabled id without building a registration", async () => {
    const { deps: d, builds } = deps();
    expect(await refusalOf(() => run(d, "skill_unknown"))).toEqual({ status: 404, body: { error: "Skill was not found or is disabled.", code: "NOT_FOUND" } });
    expect(builds).toEqual([]);
  });

  it("fails (host 500) when the selected skill yields no registration", async () => {
    const { deps: d } = deps({ skillRegistrations: { build: () => undefined } });
    await expect(run(d)).rejects.toThrow("selected skill has no tool registration for preview");
  });

  it("loads nothing when refused, and fails closed without an authorizer or a principal", async () => {
    const { deps: d, loads, builds } = deps();
    await expect(run(d, "skill_a", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(skillGuidanceRoute.handle({ input: { toolId: "skill_a" }, deps: d, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    await expect(skillGuidanceRoute.handle({ input: { toolId: "skill_a" }, deps: d, authorize: recordingAuthorize().authorize }, { signal })).rejects.toThrow(/no authenticated principal/);
    expect(loads).toEqual([]);
    expect(builds).toEqual([]);
  });

  it("maps the loader's input error to the validation 400 and rethrows anything else", async () => {
    expect(await refusalOf(() => run(deps({ loadSkillSources: async () => { throw new FakeSkillInputError("Bad skill folder."); } }).deps)))
      .toEqual({ status: 400, body: { error: "Bad skill folder.", code: "VALIDATION_ERROR" } });
    await expect(run(deps({ loadSkillSources: async () => { throw new Error("io"); } }).deps)).rejects.toThrow("io");
  });
});
