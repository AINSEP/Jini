// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ChatMessage } from "../../../../../react/kit.js";
import { useAssistantEmptyState } from "../use-assistant-empty-state.hooks.js";

const message: ChatMessage = { id: "user-1", role: "user", content: "Help me edit my site" };

test("D-34: greet an empty chat, hide on send, and greet a new empty chat", () => {
  const forwarded: ChatMessage[][] = [];
  const onMessagesChange = (messages: ChatMessage[]) => { forwarded.push(messages); };
  const { result, rerender } = renderHook(({ paneKey, initialMessages }) => useAssistantEmptyState({ paneKey, initialMessages, onMessagesChange }), { initialProps: { paneKey: "new", initialMessages: [] as ChatMessage[] } });
  expect(result.current.empty).toBe(true);
  act(() => result.current.handleMessagesChange([message]));
  expect(result.current.empty).toBe(false);
  expect(forwarded[0]?.[0]?.content).toBe("Help me edit my site");
  const callbackBeforeRender = result.current.handleMessagesChange;
  rerender({ paneKey: "new", initialMessages: [] });
  expect(result.current.handleMessagesChange).toBe(callbackBeforeRender);
  rerender({ paneKey: "new-2", initialMessages: [] });
  expect(result.current.empty).toBe(true);
  rerender({ paneKey: "history", initialMessages: [message] });
  expect(result.current.empty).toBe(false);
  act(() => result.current.handleMessagesChange([]));
  expect(result.current.empty).toBe(true);
});

test("D-34: no saved history yet (undefined initialMessages) greets like an empty chat", () => {
  const { result } = renderHook(() => useAssistantEmptyState({ paneKey: "fresh", initialMessages: undefined, onMessagesChange: () => {} }));
  expect(result.current.empty).toBe(true);
});
