import { describe, expect, it } from "vitest";
import { skillFilesRoute, type SkillFilesRouteDeps } from "../files.js";
import { fakeSources, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, SKILLS_AUTH, WORKSPACE_ID } from "./helpers.js";

const LIMITS = { maxFiles: 3, maxEntries: 4, maxFileBytes: 5, maxTotalBytes: 6 };
const file = (relativePath: string) => ({ relativePath, sizeBytes: 1, content: "x", omitted: null });

function deps(overrides: Partial<SkillFilesRouteDeps> = {}) {
  const reads: unknown[] = [];
  const base: SkillFilesRouteDeps = {
    workspaceId: WORKSPACE_ID,
    ...fakeSources([{ id: "skill_a", directory: "a" }, { id: "skill_b" }]),
    readSkillFiles: async (input) => {
      reads.push(input);
      return { files: [file("SKILL.md"), file(".state.json"), file("refs/.state.json"), file(".other.json")], truncated: true };
    },
    fileLimits: LIMITS,
    installRecordFileName: ".state.json",
    ...overrides,
  };
  return { deps: base, reads };
}
const run = (d: SkillFilesRouteDeps, toolId = "skill_a", authorize = recordingAuthorize().authorize) =>
  skillFilesRoute.handle({ input: { toolId }, deps: d, context: PRINCIPAL, authorize }, { signal });

describe("skillFilesRoute", () => {
  it("keeps the method, path, status and no body cap; reads :toolId as a string", () => {
    expect(skillFilesRoute.method).toBe("get");
    expect(skillFilesRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/skills/:toolId/files");
    expect(skillFilesRoute.successStatus).toBeUndefined();
    expect(skillFilesRoute.maxBodyBytes).toBeUndefined();
    expect(skillFilesRoute.parse(raw({ toolId: "skill_a" }))).toEqual({ ok: true, value: { toolId: "skill_a" } });
    expect(skillFilesRoute.parse(raw({}))).toEqual({ ok: true, value: { toolId: "undefined" } });
  });

  it("authorizes id-free, includes disabled skills, reads the discovered directory and hides only the install record", async () => {
    const { deps: d, reads } = deps();
    const sources = fakeSources([{ id: "skill_a", directory: "a" }]);
    const { authorize, calls } = recordingAuthorize();
    const result = await run({ ...d, loadSkillSources: sources.loadSkillSources }, "skill_a", authorize);
    expect(calls).toEqual(SKILLS_AUTH);
    expect(sources.calls).toEqual([{ includeDisabled: true }]);
    expect(reads).toEqual([{ directory: "a" }]);
    expect(result).toEqual({ ok: true, value: { toolId: "skill_a", files: [file("SKILL.md"), file(".other.json")], truncated: true, limits: LIMITS } });
  });

  it("answers the skills 404 for an unknown id and for a source without a directory, without reading files", async () => {
    for (const toolId of ["skill_unknown", "skill_b", "../a"]) {
      const { deps: d, reads } = deps();
      expect(await refusalOf(() => run(d, toolId))).toEqual({ status: 404, body: { error: "Skill was not found or is disabled.", code: "NOT_FOUND" } });
      expect(reads).toEqual([]);
    }
  });

  it("does not load or read when authorization refuses, and fails closed without an authorizer", async () => {
    const sources = fakeSources([{ id: "skill_a", directory: "a" }]);
    const { deps: d, reads } = deps({ loadSkillSources: sources.loadSkillSources });
    await expect(run(d, "skill_a", recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(skillFilesRoute.handle({ input: { toolId: "skill_a" }, deps: d, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    expect(sources.calls).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("rethrows a reader failure unchanged (the host's redacted 500), even an input-shaped one", async () => {
    const { deps: d } = deps({ readSkillFiles: async () => { throw new Error("EACCES /private/server/path"); } });
    await expect(run(d)).rejects.toThrow("EACCES /private/server/path");
  });
});
