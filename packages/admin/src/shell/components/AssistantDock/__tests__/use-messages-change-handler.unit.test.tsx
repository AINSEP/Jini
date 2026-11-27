// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { isTerminalRunStatus, type ChatMessage } from "@jini-ai/chat/core";
import { useMessagesChangeHandler } from "../hooks/messages-change.hooks.js";

it("refreshes content once for a new tool result and never republishes its replay", () => {
  const publishContentRefresh = vi.fn();
  const publishSettingsRefresh = vi.fn();
  const publishMessages = vi.fn();
  const onMessagesChange = vi.fn();
  const { result } = renderHook(() => useMessagesChangeHandler({
    chats: { onMessagesChange }, publishContentRefresh, publishSettingsRefresh, publishMessages, deps: { isTerminalRunStatus },
  }));
  const messages: ChatMessage[] = [{ id: "run", role: "assistant", content: "Working", runStatus: "running",
    events: [{ kind: "tool_result", toolUseId: "tool", content: "ok", isError: false }] }];
  result.current(messages);
  result.current(messages);
  expect(publishContentRefresh).toHaveBeenCalledTimes(1);
  expect(publishSettingsRefresh).not.toHaveBeenCalled();
  expect(onMessagesChange).toHaveBeenCalledTimes(2);
  expect(publishMessages).toHaveBeenCalledWith(messages);
});

it("does not refresh hydrated history, then refreshes content once on a new terminal delta with tool output", () => {
  const publishContentRefresh = vi.fn();
  const publishSettingsRefresh = vi.fn();
  const publishMessages = vi.fn();
  const onMessagesChange = vi.fn();
  const tool = { kind: "tool_result", toolUseId: "write", content: "saved", isError: false } as const;
  const initial: ChatMessage[] = [{ id: "saved", role: "assistant", content: "Saved", runStatus: "succeeded", events: [tool] }];
  const { result, rerender } = renderHook(({ paneKey, initialMessages }: { paneKey: string; initialMessages?: ChatMessage[] }) => useMessagesChangeHandler({
    chats: { onMessagesChange, paneKey, ...(initialMessages === undefined ? {} : { initialMessages }) },
    publishContentRefresh, publishSettingsRefresh, publishMessages, deps: { isTerminalRunStatus },
  }), { initialProps: { paneKey: "saved", initialMessages: initial } });
  result.current(initial);
  expect(publishContentRefresh).not.toHaveBeenCalled();
  expect(publishSettingsRefresh).not.toHaveBeenCalled();
  rerender({ paneKey: "new" });
  result.current([]);
  const user: ChatMessage[] = [{ id: "new-user", role: "user", content: "Update the title" }];
  result.current(user);
  expect(publishContentRefresh).not.toHaveBeenCalled();
  expect(publishSettingsRefresh).not.toHaveBeenCalled();
  const completed: ChatMessage[] = [...user, { id: "new-answer", role: "assistant", content: "Done", runStatus: "succeeded", events: [tool] }];
  result.current(completed);
  result.current(completed);
  expect(publishContentRefresh.mock.calls).toEqual([[]]);
  expect(publishSettingsRefresh.mock.calls).toEqual([[]]);
  expect(onMessagesChange.mock.calls).toEqual([[{ messages: initial }], [{ messages: [] }], [{ messages: user }], [{ messages: completed }], [{ messages: completed }]]);
  expect(publishMessages).toHaveBeenLastCalledWith(completed);
});

it("publishes the first tool result of a retry even when the failed run had exactly one result", () => {
  const publishContentRefresh = vi.fn();
  const publishSettingsRefresh = vi.fn();
  const { result } = renderHook(() => useMessagesChangeHandler({
    chats: { onMessagesChange: vi.fn() }, publishSettingsRefresh, publishContentRefresh, publishMessages: vi.fn(),
    deps: { isTerminalRunStatus },
  }));
  const failed: ChatMessage = { id: "answer", role: "assistant", content: "Retryable failure", runStatus: "failed",
    events: [{ kind: "tool_result", toolUseId: "first-write", content: "failed", isError: true }] };
  result.current([failed]);
  result.current([{ ...failed, runStatus: "running", events: [] }]);
  expect(publishContentRefresh.mock.calls).toEqual([[]]);
  const retry: ChatMessage = { ...failed, runStatus: "running",
    events: [{ kind: "tool_result", toolUseId: "retry-write", content: "saved", isError: false }] };
  result.current([retry]);
  expect(publishContentRefresh.mock.calls).toEqual([[], []]);
  expect(publishSettingsRefresh.mock.calls).toEqual([[]]);
});
