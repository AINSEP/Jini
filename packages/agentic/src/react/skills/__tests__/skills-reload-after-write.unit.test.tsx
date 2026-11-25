import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { CachedLoader, FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { InstalledSkill } from "@jini-ai/core/contracts/site/installed-skill";
import { useSkills } from "../use-skills.hooks.js";

test("accepted writes refresh once through the event without mutation invalidation and unsubscribe on unmount", async () => {
  const node = document.createElement("div");
  const root = createRoot(node);
  const skill: InstalledSkill = { toolId: "skill", name: "Skill", description: "", enabled: true, source: "uploaded" };
  let listener: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribeChanged = vi.fn((next: () => void) => { listener = next; return unsubscribe; });
  const invalidate = vi.fn();
  const load = vi.fn(async () => [skill]);
  const loader = { load, peek: () => undefined, replace: () => {} };
  const queryHooks: FetchQueryAdapter = {
    useFetchQuery: <T,>() => ({ data: [skill] as T, error: null, status: "success", isFetching: false, refetch: () => {} }),
    useInvalidate: () => invalidate,
    useCachedLoader: <T,>() => loader as unknown as CachedLoader<T>,
    useFetchMutation: ({ run }, options) => { expect(options?.invalidates).toBeUndefined(); return { mutate: run, status: "idle", error: null, reset: () => {} }; },
  };
  const enableSkill = vi.fn(async () => { listener?.(); });
  let current: ReturnType<typeof useSkills> | undefined;
  function Probe() {
    current = useSkills({
      port: { listSkills: async () => [skill], enableSkill, removeSkill: async () => {} }, t: key => key, queryHooks, subscribeChanged,
      useSkillInstallHook: () => ({ pending: null, busy: false, error: null, cause: null, propose: () => {}, proposeFiles: async () => {}, cancel: () => {}, confirm: async () => {}, fail: () => {} }),
      useSkillConfirmationHook: () => ({ dialogRef: { current: null }, onDialogClick: () => {} }),
      useSkillsTabsHook: () => ({ activeTabId: "skills", onTabChange: () => {}, onShowSkills: () => {}, onShowAdd: () => {} }),
      describeFailure: () => { throw new Error("unexpected failure"); },
    });
    return null;
  }
  await act(async () => { root.render(<Probe />); });
  const controller = () => { if (!current) throw new Error("not mounted"); return current; };
  const row = controller().rows[0];
  if (!row) throw new Error("row missing");
  expect(load).not.toHaveBeenCalled();
  await act(async () => { row.onToggleEnabled(); });
  expect(enableSkill).toHaveBeenCalledExactlyOnceWith({ toolId: "skill", enabled: false });
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ key: ["skills"] });
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => { root.unmount(); });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
