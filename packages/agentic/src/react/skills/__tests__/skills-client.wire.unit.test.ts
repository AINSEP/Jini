import { expect, test, vi } from "vitest";
import { createSkillsApi } from "../api.js";

test("skill requests preserve confirmed install and notify only after acceptance", async () => {
  let accept: (value: unknown) => void = () => {};
  const accepted = new Promise<unknown>(resolve => { accept = resolve; });
  const request = vi.fn<(input: { path: string; method: string; body?: unknown }) => void>();
  const send = <T,>(input: { path: string; method: string; body?: unknown }): Promise<T> => { request(input); return accepted as Promise<T>; };
  const notifyChanged = vi.fn();
  const api = createSkillsApi({ request: send, workspaceId: "ws", notifyChanged, formatDraft: () => "draft", invalidGuidanceError: () => new Error("invalid") });
  const pending = api.installSkill({ payload: { githubUrl: "https://example/skill" } });
  expect(notifyChanged).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith({ path: "/workspaces/ws/skills", method: "POST", body: { githubUrl: "https://example/skill", confirmed: true } });
  accept({});
  await pending;
  expect(notifyChanged).toHaveBeenCalledTimes(1);
  await api.enableSkill({ toolId: "skill /", enabled: false });
  expect(request).toHaveBeenLastCalledWith({ path: "/workspaces/ws/skills/skill%20%2F", method: "PATCH", body: { enabled: false } });
  await api.removeSkill({ toolId: "skill /" });
  expect(request).toHaveBeenLastCalledWith({ path: "/workspaces/ws/skills/skill%20%2F", method: "DELETE", body: undefined });
});

test("reads list, files and guidance from the workspace skills path, formatting only well-formed guidance", async () => {
  const responses: Record<string, unknown> = {
    "/workspaces/ws/skills": { skills: [{ toolId: "skill_notes" }] },
    "/workspaces/ws/skills/skill%20%2F/files": { toolId: "skill /", files: [], truncated: false },
    "/workspaces/ws/skills/skill%20%2F/guidance": { skillName: "Notes", guidance: "Steps.", bundledFiles: [{ kind: "references", root: "site", path: "a.md" }] },
  };
  const requests: unknown[] = [];
  const send = async <T,>(input: { path: string; method: string; body?: unknown }): Promise<T> => { requests.push(input); return responses[input.path] as T; };
  const formatDraft = vi.fn(({ skillName, guidance }: { skillName: string; guidance: string }) => `${skillName}: ${guidance}`);
  const invalid = new Error("invalid guidance");
  const api = createSkillsApi({ request: send, workspaceId: "ws", notifyChanged: () => {}, formatDraft, invalidGuidanceError: () => invalid });
  expect(await api.listSkills()).toEqual([{ toolId: "skill_notes" }]);
  expect(await api.listSkillFiles({ toolId: "skill /" })).toEqual({ toolId: "skill /", files: [], truncated: false });
  expect(await api.loadSkillDraft({ toolId: "skill /" })).toBe("Notes: Steps.");
  expect(formatDraft).toHaveBeenCalledWith(responses["/workspaces/ws/skills/skill%20%2F/guidance"]);
  expect(requests).toEqual([
    { path: "/workspaces/ws/skills", method: "GET", body: undefined },
    { path: "/workspaces/ws/skills/skill%20%2F/files", method: "GET", body: undefined },
    { path: "/workspaces/ws/skills/skill%20%2F/guidance", method: "GET", body: undefined },
  ]);
  const good = { skillName: "Notes", guidance: "Steps.", bundledFiles: [] };
  for (const malformed of [{ ...good, skillName: 1 }, { ...good, guidance: null }, { ...good, bundledFiles: "a.md" }]) {
    responses["/workspaces/ws/skills/skill%20%2F/guidance"] = malformed;
    await expect(api.loadSkillDraft({ toolId: "skill /" })).rejects.toBe(invalid);
  }
  expect(formatDraft).toHaveBeenCalledTimes(1);
});
