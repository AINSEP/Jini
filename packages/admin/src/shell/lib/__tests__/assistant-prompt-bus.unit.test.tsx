// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatPaneComposerHandle } from "../../../react/kit.js";
import { resetAssistantDockBus, subscribeToAssistantDockRequests } from "../assistant-dock-bus.js";
import { requestAssistantPrompt, resetAssistantPromptBus, useAssistantPromptRequests } from "../assistant-prompt-bus.js";

afterEach(() => {
  cleanup();
  resetAssistantPromptBus();
  resetAssistantDockBus();
  vi.useRealTimers();
});

function composer() {
  const drafts: string[] = [];
  const handle: ChatPaneComposerHandle = { insertText: text => { drafts.push(text); }, addFolders: vi.fn() };
  return { drafts, handle };
}

it("opens the dock for each request and delivers only the newest queued draft when the composer attaches", () => {
  vi.useFakeTimers();
  const requestDock = vi.fn();
  subscribeToAssistantDockRequests({ listener: requestDock });
  requestAssistantPrompt({ text: "First draft" });
  const ref: { current: ChatPaneComposerHandle | null } = { current: null };
  renderHook(() => useAssistantPromptRequests(ref));
  act(() => requestAssistantPrompt({ text: "Import the site into a draft" }));
  const { drafts, handle } = composer();
  ref.current = handle;
  act(() => vi.advanceTimersByTime(99));
  expect(drafts).toEqual([]);
  act(() => vi.advanceTimersByTime(1));
  expect(drafts).toEqual(["Import the site into a draft"]);
  expect(requestDock.mock.calls).toEqual([[true], [true]]);
  act(() => requestAssistantPrompt({ text: "Now check the site" }));
  act(() => vi.advanceTimersByTime(250));
  expect(drafts).toEqual(["Import the site into a draft", "Now check the site"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("stops retrying after five seconds and keeps the undelivered draft for a later mount", () => {
  vi.useFakeTimers();
  requestAssistantPrompt({ text: "Review the current entry" });
  const ref: { current: ChatPaneComposerHandle | null } = { current: null };
  const first = renderHook(() => useAssistantPromptRequests(ref));
  act(() => vi.advanceTimersByTime(4_999));
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(1));
  expect(vi.getTimerCount()).toBe(0);
  first.unmount();
  const { drafts, handle } = composer();
  ref.current = handle;
  renderHook(() => useAssistantPromptRequests(ref));
  expect(drafts).toEqual(["Review the current entry"]);
});

it("cancels retries and removes the old composer when unmounted, and reset discards the queued draft", () => {
  vi.useFakeTimers();
  requestAssistantPrompt({ text: "Expired draft" });
  const oldRef: { current: ChatPaneComposerHandle | null } = { current: null };
  const old = renderHook(() => useAssistantPromptRequests(oldRef));
  expect(vi.getTimerCount()).toBe(1);
  old.unmount();
  expect(vi.getTimerCount()).toBe(0);
  const oldComposer = composer();
  oldRef.current = oldComposer.handle;
  requestAssistantPrompt({ text: "Also expired" });
  expect(oldComposer.drafts).toEqual([]);
  resetAssistantPromptBus();
  const next = composer();
  renderHook(() => useAssistantPromptRequests({ current: next.handle }));
  expect(next.drafts).toEqual([]);
  act(() => requestAssistantPrompt({ text: "Current draft" }));
  expect(next.drafts).toEqual(["Current draft"]);
});
