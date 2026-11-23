import { describe, expect, it } from "vitest";
import { skillInstallRoute, type SkillInstallRouteDeps } from "../install.js";
import { FakeSkillInputError, isSkillInputError, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, SKILLS_AUTH, WORKSPACE_ID } from "./helpers.js";

const SKILL = { toolId: "skill_x", name: "x", description: "X.", enabled: true, source: "uploaded" };
const files = [{ path: "SKILL.md", contentBase64: "eA==" }];
const payload = { confirmed: true, files };
const sourceError = "Choose exactly one source: GitHub URL, files, or ZIP.";
const confirmationError = "Confirm the skill installation first.";
const fieldsError = "Skill source has invalid fields.";

function deps(overrides: Partial<SkillInstallRouteDeps> = {}) {
  const installs: unknown[] = [];
  const d: SkillInstallRouteDeps = { workspaceId: WORKSPACE_ID, installSkill: async (input) => { installs.push(input); return SKILL; }, isSkillInputError, ...overrides };
  return { deps: d, installs };
}
const run = (d: SkillInstallRouteDeps, body: unknown, authorize = recordingAuthorize().authorize) =>
  skillInstallRoute.handle({ input: { body }, deps: d, context: PRINCIPAL, authorize }, { signal });
const validation = (error: string) => ({ status: 400, body: { error, code: "VALIDATION_ERROR" } });

describe("skillInstallRoute", () => {
  it("keeps the method, path, 201 and no body cap; parse passes the body through for validation after authorization", () => {
    expect(skillInstallRoute.method).toBe("post");
    expect(skillInstallRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/skills");
    expect(skillInstallRoute.successStatus).toBe(201);
    expect(skillInstallRoute.maxBodyBytes).toBeUndefined();
    expect(skillInstallRoute.parse(raw({}, "junk"))).toEqual({ ok: true, value: { body: "junk" } });
  });

  it("authorizes id-free, installs each source shape into the served workspace and answers { skill }", async () => {
    for (const [body, input] of [
      [payload, { workspaceId: WORKSPACE_ID, files }],
      [{ confirmed: true, githubUrl: "https://github.com/a/b" }, { workspaceId: WORKSPACE_ID, githubUrl: "https://github.com/a/b" }],
      [{ confirmed: true, archiveBase64: "UEs=" }, { workspaceId: WORKSPACE_ID, archiveBase64: "UEs=" }],
      [{ ...payload, githubUrl: undefined, archiveBase64: undefined }, { workspaceId: WORKSPACE_ID, files }],
    ] as const) {
      const { deps: d, installs } = deps();
      const { authorize, calls } = recordingAuthorize();
      expect(await run(d, body, authorize)).toEqual({ ok: true, value: { skill: SKILL } });
      expect(calls).toEqual(SKILLS_AUTH);
      expect(installs).toEqual([input]);
    }
  });

  const refusals: [string, unknown, string][] = [
    ...[undefined, null, false, 0, "files", []].map((body): [string, unknown, string] => [`non-object ${JSON.stringify(body)}`, body, sourceError]),
    ...[undefined, false, "true", 1].map((confirmed): [string, unknown, string] => [`confirmation ${JSON.stringify(confirmed)}`, { ...payload, confirmed }, confirmationError]),
    ["confirmation precedes source validation", {}, confirmationError],
    ["no source", { confirmed: true }, sourceError],
    ["unknown field", { ...payload, extra: true }, sourceError],
    ["two sources", { ...payload, archiveBase64: "!" }, sourceError],
    ["non-string GitHub", { confirmed: true, githubUrl: null }, fieldsError],
    ["non-string archive", { confirmed: true, archiveBase64: 1 }, fieldsError],
    ["non-array files", { confirmed: true, files: {} }, fieldsError],
    ...[null, 0, {}, { path: 1, contentBase64: "" }, { path: "a", contentBase64: 1 }, { ...files[0], extra: true }].map((f): [string, unknown, string] => [`entry ${JSON.stringify(f)}`, { confirmed: true, files: [f] }, fieldsError]),
  ];
  for (const [name, body, error] of refusals) {
    it(`refuses ${name} with the flat validation 400 and installs nothing`, async () => {
      const { deps: d, installs } = deps();
      expect(await refusalOf(() => run(d, body))).toEqual(validation(error));
      expect(installs).toEqual([]);
    });
  }

  it("authorizes before validating: a denied caller with a bad body is refused by authorization", async () => {
    const { deps: d, installs } = deps();
    await expect(run(d, {}, recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(skillInstallRoute.handle({ input: { body: payload }, deps: d, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    expect(installs).toEqual([]);
  });

  it("maps the installer's own input error to the validation 400 and rethrows anything else", async () => {
    expect(await refusalOf(() => run(deps({ installSkill: async () => { throw new FakeSkillInputError("A skill must contain 1–256 files."); } }).deps, payload)))
      .toEqual(validation("A skill must contain 1–256 files."));
    await expect(run(deps({ installSkill: async () => { throw new Error("disk full"); } }).deps, payload)).rejects.toThrow("disk full");
  });
});
