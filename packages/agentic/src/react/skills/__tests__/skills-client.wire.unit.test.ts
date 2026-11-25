import { expect, test, vi } from "vitest";
import { createSkillsApi } from "../api.js";

test("skill requests preserve confirmed install and notify only after acceptance", async () => {
  let accept: (value: unknown) => void = () => {};
  const accepted = new Promise<unknown>(resolve => { accept = resolve; });
  const request = vi.fn(<T,>(input: { path: string; method: string; body?: unknown }): Promise<T> => accepted as Promise<T>);
  const notifyChanged = vi.fn();
  const api = createSkillsApi({ request, workspaceId: "ws", notifyChanged, formatDraft: () => "draft", invalidGuidanceError: () => new Error("invalid") });
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
