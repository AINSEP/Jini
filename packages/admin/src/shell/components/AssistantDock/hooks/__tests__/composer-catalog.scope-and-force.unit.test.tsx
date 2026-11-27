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

it("refreshes on open, focus, visibility and visible polling, and removes all triggers on unmount", async () => {
  vi.useFakeTimers();
  const host = new EventTarget();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  let open = false;
  const dock = new EventTarget();
  const listener = (tick: () => void) => { dock.addEventListener("change", tick); return () => dock.removeEventListener("change", tick); };
  const useBootScopeHook = () => ({ queryScope: "scope", checking: false, principalId: "operator" });
  const entry = (id: string) => ({ groupId: "test", groupLabel: "Test", item: { id, label: id } });
  let item = entry("first");
  const reload = vi.fn(async () => [item]);
  const startVisibleInterval = vi.fn(({ tick, periodMs }: { tick: () => void; periodMs: number }) => {
    const id = setInterval(tick, periodMs);
    return () => clearInterval(id);
  });
  const input: Parameters<typeof useComposerCapabilities>[0] = {
    useBootScopeHook, createInstalledSource: () => ({ id: "installed", list: reload, reload }),
    createBundledSource: () => ({ id: "bundled", list: async () => [] }),
    deps: { startVisibleInterval }, window: host, document: page, skillsChangedEvent: "skills-changed",
    getAssistantDockOpen: () => open, subscribeToAssistantDock: listener, reportFailure: vi.fn(),
  };
  try {
    const { result, unmount } = renderHook(() => useComposerCapabilities(input));
    await act(async () => {});
    const initial = result.current.composerCapabilities;
    expect([...initial.byItemId.keys()]).toEqual(["first"]);
    expect(startVisibleInterval).not.toHaveBeenCalled();
    open = true;
    await act(async () => { dock.dispatchEvent(new Event("change")); });
    expect(result.current.composerCapabilities).toBe(initial);
    expect(startVisibleInterval).toHaveBeenCalledExactlyOnceWith({ tick: expect.any(Function), periodMs: 60_000 });
    item = entry("focused");
    await act(async () => { host.dispatchEvent(new Event("focus")); });
    expect([...result.current.composerCapabilities.byItemId.keys()]).toEqual(["focused"]);
    item = entry("polled");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect([...result.current.composerCapabilities.byItemId.keys()]).toEqual(["polled"]);
    page.visibilityState = "hidden";
    act(() => { page.dispatchEvent(new Event("visibilitychange")); });
    reload.mockClear();
    await act(async () => { host.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(60_000); });
    expect(reload).not.toHaveBeenCalled();
    item = entry("visible");
    page.visibilityState = "visible";
    await act(async () => { page.dispatchEvent(new Event("visibilitychange")); });
    expect([...result.current.composerCapabilities.byItemId.keys()]).toEqual(["visible"]);
    unmount();
    reload.mockClear();
    host.dispatchEvent(new Event("focus"));
    host.dispatchEvent(new Event("skills-changed"));
    page.dispatchEvent(new Event("visibilitychange"));
    dock.dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it("reports a failed catalog reload and retains the last rendered discovery choices", async () => {
  const host = new EventTarget();
  const failure = new Error("Installed catalog unavailable");
  const reload = vi.fn().mockResolvedValueOnce([{ groupId: "skills", groupLabel: "Skills", item: { id: "initial", label: "Initial" } }]).mockRejectedValueOnce(failure);
  const reportFailure = vi.fn();
  const input: Parameters<typeof useComposerCapabilities>[0] = {
    useBootScopeHook: () => ({ queryScope: "scope", checking: false, principalId: "operator" }),
    createInstalledSource: () => ({ id: "installed", list: reload, reload }),
    createBundledSource: () => ({ id: "bundled", list: async () => [] }),
    deps: { startVisibleInterval: () => () => {} }, window: host, document, skillsChangedEvent: "skills-changed",
    getAssistantDockOpen: () => false, subscribeToAssistantDock: () => () => {}, reportFailure,
  };
  const { result } = renderHook(() => useComposerCapabilities(input));
  await waitFor(() => expect(result.current.composerCapabilities.byItemId.get("initial")?.item.label).toBe("Initial"));
  await act(async () => { host.dispatchEvent(new Event("skills-changed")); });
  expect(reportFailure).toHaveBeenCalledExactlyOnceWith(failure);
  expect([...result.current.composerCapabilities.byItemId.keys()]).toEqual(["initial"]);
});
