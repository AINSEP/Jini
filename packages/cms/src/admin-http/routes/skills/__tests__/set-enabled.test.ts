import { describe, expect, it } from "vitest";
import { skillSetEnabledRoute, type SkillSetEnabledRouteDeps } from "../set-enabled.js";
import { FakeSkillInputError, isSkillInputError, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, SKILLS_AUTH, WORKSPACE_ID } from "./helpers.js";

function deps(overrides: Partial<SkillSetEnabledRouteDeps> = {}) {
  const writes: unknown[] = [];
  const d: SkillSetEnabledRouteDeps = { workspaceId: WORKSPACE_ID, setSkillEnabled: async (input) => { writes.push(input); }, isSkillInputError, ...overrides };
  return { deps: d, writes };
}
const run = (d: SkillSetEnabledRouteDeps, body: unknown, authorize = recordingAuthorize().authorize) =>
  skillSetEnabledRoute.handle({ input: { toolId: "skill_a", body }, deps: d, context: PRINCIPAL, authorize }, { signal });
const refusal = { status: 400, body: { error: "enabled must be a boolean.", code: "VALIDATION_ERROR" } };

describe("skillSetEnabledRoute", () => {
  it("keeps the method, path, status and no body cap; reads :toolId and the body", () => {
    expect(skillSetEnabledRoute.method).toBe("patch");
    expect(skillSetEnabledRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/skills/:toolId");
    expect(skillSetEnabledRoute.successStatus).toBeUndefined();
    expect(skillSetEnabledRoute.maxBodyBytes).toBeUndefined();
    expect(skillSetEnabledRoute.parse(raw({ toolId: "skill_a" }, { enabled: true }))).toEqual({ ok: true, value: { toolId: "skill_a", body: { enabled: true } } });
    expect(skillSetEnabledRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { toolId: "undefined", body: undefined } });
  });

  it("authorizes id-free, writes the flag for the served workspace and answers { updated: true }", async () => {
    for (const enabled of [true, false]) {
      const { deps: d, writes } = deps();
      const { authorize, calls } = recordingAuthorize();
      expect(await run(d, { enabled }, authorize)).toEqual({ ok: true, value: { updated: true } });
      expect(calls).toEqual(SKILLS_AUTH);
      expect(writes).toEqual([{ workspaceId: WORKSPACE_ID, toolId: "skill_a", enabled }]);
    }
  });

  for (const body of [undefined, null, {}, { enabled: "false" }, { enabled: 1 }, { enabled: true, extra: 1 }]) {
    it(`refuses body ${JSON.stringify(body)} with the flat validation 400 and writes nothing`, async () => {
      const { deps: d, writes } = deps();
      expect(await refusalOf(() => run(d, body))).toEqual(refusal);
      expect(writes).toEqual([]);
    });
  }

  it("authorizes before validating and writes nothing when refused", async () => {
    const { deps: d, writes } = deps();
    await expect(run(d, undefined, recordingAuthorize(true).authorize)).rejects.toThrow("denied");
    await expect(skillSetEnabledRoute.handle({ input: { toolId: "skill_a", body: { enabled: true } }, deps: d, context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    expect(writes).toEqual([]);
  });

  it("maps the service's input error to the validation 400 and rethrows anything else", async () => {
    expect(await refusalOf(() => run(deps({ setSkillEnabled: async () => { throw new FakeSkillInputError("Skill not installed."); } }).deps, { enabled: true })))
      .toEqual({ status: 400, body: { error: "Skill not installed.", code: "VALIDATION_ERROR" } });
    await expect(run(deps({ setSkillEnabled: async () => { throw new Error("io"); } }).deps, { enabled: true })).rejects.toThrow("io");
  });
});

it('keeps the host-classified string refusal as the public validation message', async () => {
  const reason = "This skill is managed by its plugin.";
  const { deps: d } = deps({
    setSkillEnabled: async () => { throw reason; },
    isSkillInputError: ({ err }) => err === reason,
  });
  expect(await refusalOf(() => run(d, { enabled: true })))
    .toEqual({ status: 400, body: { error: reason, code: "VALIDATION_ERROR" } });
});
