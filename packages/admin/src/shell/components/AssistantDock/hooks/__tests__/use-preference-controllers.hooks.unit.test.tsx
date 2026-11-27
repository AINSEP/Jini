// @vitest-environment jsdom
import { act, renderHook, testAdminKit, waitFor } from "../../../../../__tests__/fetch-query-support.js";
import { useCallback } from "react";
import type { QueryKey } from "@jini-ai/core/fetch";
import { expect, it, vi } from "vitest";
import { useAssistantRuntimePreferences } from "../use-assistant-runtime-preferences.hooks.js";
import { useChatAgentPlugins } from "../use-chat-agent-plugins.hooks.js";
import { useChatDisplayPreferences } from "../use-chat-display-preferences.hooks.js";

const namespace = "operator.choices";

function memoryPreferences<T>(initial: T) {
  let stored = initial;
  let failure: Error | undefined;
  const listeners = new Set<() => void>();
  const load = vi.fn(async () => stored);
  const save = vi.fn(async ({ next }: { next: T; previous: T }) => {
    if (failure) throw failure;
    stored = next;
  });
  const subscribe = ({ listener }: { listener: () => void }) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const invalidations = vi.fn<({ key }: { key: QueryKey }) => void>();
  function useTrackedInvalidate() {
    const invalidate = testAdminKit.query.useInvalidate();
    return useCallback((input: { key: QueryKey }) => {
      invalidations(input);
      invalidate(input);
    }, [invalidate]);
  }
  const query = { useFetchQuery: testAdminKit.query.useFetchQuery, useInvalidate: useTrackedInvalidate };
  return { load, save, subscribe, query, invalidate: invalidations, read: () => stored,
    refuse: (next: Error | undefined) => { failure = next; },
    changeElsewhere: (next: T) => { stored = next; for (const listener of listeners) listener(); },
  };
}

it("chains runtime edits against the latest request and adopts external changes after the save echo", async () => {
  const defaults = { preferSubagents: false, useClaudeInChrome: false, replyLength: "normal" } as const;
  const stored = { ...defaults, replyLength: "detailed" } as const;
  const memory = memoryPreferences<Parameters<typeof useAssistantRuntimePreferences>[0]["defaults"]>(stored);
  const { result, unmount } = renderHook(() => useAssistantRuntimePreferences({ ...memory.query, namespace, defaults, port: memory }));
  expect(result.current.preferences).toEqual(defaults);
  await waitFor(() => expect(result.current.preferences).toEqual(stored));
  const first = { ...stored, preferSubagents: true };
  const second = { ...first, useClaudeInChrome: true };
  await act(async () => {
    result.current.update({ preferSubagents: true });
    result.current.update({ useClaudeInChrome: true });
  });
  expect(memory.save.mock.calls).toEqual([[{ previous: stored, next: first }, {}], [{ previous: first, next: second }, {}]]);
  expect(memory.read()).toEqual(second);
  expect(result.current.preferences).toEqual(second);
  const external = { ...defaults, replyLength: "short" } as const;
  await waitFor(() => expect(memory.load.mock.calls.length).toBeGreaterThan(1));
  await act(async () => { memory.changeElsewhere(external); });
  expect(memory.invalidate).toHaveBeenLastCalledWith({ key: ["settings", namespace, "assistant-runtime"] });
  await waitFor(() => expect(result.current.preferences).toEqual(external));
  unmount();
  memory.invalidate.mockClear();
  memory.changeElsewhere(stored);
  expect(memory.invalidate).not.toHaveBeenCalled();
});

it("keeps an unsaved runtime choice visible and clears the error after a successful retry", async () => {
  const defaults = { preferSubagents: false, useClaudeInChrome: false, replyLength: "normal" } as const;
  const memory = memoryPreferences<Parameters<typeof useAssistantRuntimePreferences>[0]["defaults"]>(defaults);
  const { result } = renderHook(() => useAssistantRuntimePreferences({ ...memory.query, namespace, defaults, port: memory }));
  await act(async () => {});
  memory.refuse(new Error("Ledger unavailable"));
  await act(async () => { result.current.update({ replyLength: "short" }); });
  expect(result.current.saveFailed).toBe(true);
  expect(result.current.preferences).toEqual({ ...defaults, replyLength: "short" });
  expect(memory.read()).toEqual(defaults);
  memory.refuse(undefined);
  await act(async () => { result.current.update({ replyLength: "detailed" }); });
  expect(result.current.saveFailed).toBe(false);
  expect(memory.read()).toEqual({ ...defaults, replyLength: "detailed" });
});

it("reflects a failed plugin choice locally, then persists the retry and follows the latest server choice", async () => {
  const memory = memoryPreferences<"auto" | "ask" | "off">("ask");
  const { result, unmount } = renderHook(() => useChatAgentPlugins({ ...memory.query, namespace, port: memory }));
  expect(result.current.mode).toBe("auto");
  await waitFor(() => expect(result.current.mode).toBe("ask"));
  memory.refuse(new Error("Cannot store preference"));
  await act(async () => { result.current.update("off"); });
  expect(result.current).toMatchObject({ mode: "off", saveFailed: true });
  expect(memory.read()).toBe("ask");
  expect(memory.invalidate).not.toHaveBeenCalled();
  memory.refuse(undefined);
  await act(async () => { result.current.update("auto"); });
  expect(result.current).toMatchObject({ mode: "auto", saveFailed: false });
  expect(memory.read()).toBe("auto");
  expect(memory.save.mock.calls).toEqual([[{ previous: "ask", next: "off" }, {}], [{ previous: "off", next: "auto" }, {}]]);
  await waitFor(() => expect(memory.load.mock.calls.length).toBeGreaterThan(1));
  await act(async () => { memory.changeElsewhere("ask"); });
  expect(memory.invalidate).toHaveBeenLastCalledWith({ key: ["settings", namespace, "agent-plugins"] });
  await waitFor(() => expect(result.current.mode).toBe("ask"));
  unmount();
  memory.invalidate.mockClear();
  memory.changeElsewhere("off");
  expect(memory.invalidate).not.toHaveBeenCalled();
});

it("uses the prior optimistic display state for a second write and releases it when confirmed", async () => {
  const defaults = { toolCalls: "collapsed", showUsageLine: true, showThinking: false } as const;
  const stored = { ...defaults, toolCalls: "show" } as const;
  const memory = memoryPreferences<Parameters<typeof useChatDisplayPreferences>[0]["defaults"]>(stored);
  const port = { ...memory, subscribeToSettingsRefresh: memory.subscribe };
  const { result, unmount } = renderHook(() => useChatDisplayPreferences({ ...memory.query, namespace, defaults, port }));
  expect(result.current.preferences).toEqual(defaults);
  await waitFor(() => expect(result.current.preferences).toEqual(stored));
  memory.refuse(new Error("Ledger unavailable"));
  const first = { ...stored, showUsageLine: false };
  await act(async () => { result.current.update({ showUsageLine: false }); });
  expect(result.current.saveFailed).toBe(true);
  expect(result.current.preferences).toEqual(first);
  expect(memory.read()).toEqual(stored);
  memory.refuse(undefined);
  const second = { ...first, showThinking: true };
  await act(async () => { result.current.update({ showThinking: true }); });
  expect(result.current.saveFailed).toBe(false);
  expect(memory.save.mock.calls).toEqual([[{ next: first, previous: stored }], [{ next: second, previous: first }]]);
  expect(memory.read()).toEqual(second);
  await waitFor(() => expect(memory.load.mock.calls.length).toBeGreaterThan(1));
  await act(async () => { memory.changeElsewhere(defaults); });
  expect(memory.invalidate).toHaveBeenLastCalledWith({ key: ["settings", namespace, "chat-display"] });
  await waitFor(() => expect(result.current.preferences).toEqual(defaults));
  unmount();
  memory.invalidate.mockClear();
  memory.changeElsewhere(stored);
  expect(memory.invalidate).not.toHaveBeenCalled();
});
