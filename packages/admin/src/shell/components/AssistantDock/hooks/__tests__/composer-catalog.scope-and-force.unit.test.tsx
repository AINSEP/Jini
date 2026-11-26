// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useComposerCapabilities, useComposerDiscoverySelect } from "../composer-discovery.hooks.js";
import { projectComposerCapabilities } from "../../../../../screens/plugins/composer-capabilities.js";

it("hides the prior scope catalog immediately and forwards forced reloads", async () => {
  let scope = "a";
  // A forced reload is what the host's skills-changed event asks for.
  const host = new EventTarget();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const forceReload = () => { host.dispatchEvent(new Event("skills-changed")); };
  const reload = vi.fn(async () => [{ groupId: "skills", groupLabel: "Skills", item: { id: "skill", label: "Skill" } }]);
  const input = { useBootScopeHook: () => ({ queryScope: scope, checking: false, principalId: scope }), createInstalledSource: vi.fn(() => ({ id: "installed", list: reload, reload })), createBundledSource: () => ({ id: "bundled", list: async () => [] }), deps: { startVisibleInterval: () => () => {} }, window: host, document: page, skillsChangedEvent: "skills-changed",
    getAssistantDockOpen: () => false, subscribeToAssistantDock: () => () => {}, reportFailure: vi.fn() };
  const { result, rerender } = renderHook(() => useComposerCapabilities(input));
  await waitFor(() => expect(result.current.composerCapabilities.byItemId.has("skill")).toBe(true));
  act(() => forceReload());
  expect(reload).toHaveBeenLastCalledWith({}, { force: true });
  scope = "b";
  rerender();
  expect(result.current.composerCapabilities.byItemId.size).toBe(0);
  expect(input.createInstalledSource).toHaveBeenCalledTimes(2);
});

it("passes the allowlisted caller unchanged through the discovery outcome", async () => {
  const capability = { groupId: "tools", groupLabel: "Tools", item: { id: "tool", label: "Tool" }, resolve: () => ({ kind: "allowlisted-tool-call" as const, toolName: "allowed", params: { value: 1 } }) };
  const composerCapabilities = await projectComposerCapabilities({ sources: [{ id: "tools", list: async () => [capability] }] });
  const callAllowlistedTool = vi.fn(async () => ({}));
  const { result } = renderHook(() => useComposerDiscoverySelect({ composerCapabilities, callAllowlistedTool, navigate: vi.fn(), resolveRoute: () => null, loadSkillDraft: async () => "" }));
  await expect(result.current({ item: capability.item, source: "plus" })).resolves.toEqual({ draft: "" });
  expect(callAllowlistedTool).toHaveBeenCalledExactlyOnceWith({ name: "allowed", arguments: { value: 1 } });
});
