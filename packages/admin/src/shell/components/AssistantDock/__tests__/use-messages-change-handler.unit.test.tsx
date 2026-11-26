// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ChatMessage } from "@jini-ai/chat/core";
import { useMessagesChangeHandler } from "../hooks/messages-change.hooks.js";

it("refreshes content once for a new tool result and never republishes its replay", () => {
  const publishContentRefresh = vi.fn();
  const publishSettingsRefresh = vi.fn();
  const publishMessages = vi.fn();
  const onMessagesChange = vi.fn();
  const { result } = renderHook(() => useMessagesChangeHandler({
    chats: { onMessagesChange }, publishContentRefresh, publishSettingsRefresh, publishMessages,
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
