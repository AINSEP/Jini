// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AssistantChatsPort, AssistantConversation } from "../assistant-chats-port.hooks";
import { sharedPort, useAssistantChats } from "../use-assistant-chats.hooks";

describe("sharedPort — adapts Jini's port to the chat library's argument objects", () => {
  it("forwards every call, seeding the title only when a first message is given", async () => {
    const calls: unknown[][] = [];
    const conversation = { id: "c1", title: "t" } as unknown as AssistantConversation;
    const host: AssistantChatsPort = {
      listConversations: async () => { calls.push(["list"]); return [conversation]; },
      createConversation: async (_required, { firstMessage } = {}) => { calls.push(firstMessage === undefined ? ["create"] : ["create", firstMessage]); return conversation; },
      renameConversation: async ({ id, title }) => { calls.push(["rename", id, title]); },
      deleteConversation: async ({ id }) => { calls.push(["delete", id]); },
      loadMessages: async ({ conversationId }) => { calls.push(["load", conversationId]); return []; },
      saveMessage: async ({ conversationId, message }) => { calls.push(["save", conversationId, message.id]); },
    };
    const port = sharedPort(host);
    expect(await port.listConversations({}, {})).toEqual([conversation]);
    await port.createConversation({}, {});
    await port.createConversation({ firstMessage: "Plan the launch" }, {});
    await port.renameConversation({ id: "c1", title: "Launch" }, {});
    await port.deleteConversation({ id: "c1" }, {});
    await port.loadMessages({ conversationId: "c1" }, {});
    await port.saveMessage({ conversationId: "c1", message: { id: "m1", role: "user", content: "hi" } }, {});
    expect(calls).toEqual([
      ["list"], ["create"], ["create", "Plan the launch"], ["rename", "c1", "Launch"], ["delete", "c1"], ["load", "c1"], ["save", "c1", "m1"],
    ]);
  });
});

it("keeps the pane state and action identities while forwarding action arguments to the chat client", async () => {
  const message = { id: "m7", role: "user", content: "Publish the report" } as const;
  const state = {
    conversations: [], activeId: "c7", paneKey: "pane-3", initialMessages: [message],
    select: vi.fn(), create: vi.fn(async () => {}), remove: vi.fn(async () => {}),
    rename: vi.fn(async () => {}), onMessagesChange: vi.fn(),
    ensureConversationId: vi.fn(async () => "c7"), persistUserTurn: vi.fn(async () => {}),
  };
  const useAssistantChatsClient = vi.fn(() => state);
  const lastConversation = { read: () => "c7", write: vi.fn(), clear: vi.fn() };
  const port: AssistantChatsPort = {
    listConversations: async () => [], createConversation: async () => { throw new Error("The pane did not request a create through the port"); },
    renameConversation: async () => {}, deleteConversation: async () => {}, loadMessages: async () => [], saveMessage: async () => {},
  };
  const { result, rerender } = renderHook(() => useAssistantChats({ port, client: { useAssistantChats: useAssistantChatsClient }, lastConversation }));
  expect(result.current).toMatchObject({ activeId: "c7", paneKey: "pane-3", initialMessages: [message] });
  expect(useAssistantChatsClient).toHaveBeenLastCalledWith({ port: expect.objectContaining({ listConversations: expect.any(Function) }) }, { lastConversation });
  const first = result.current;
  rerender();
  expect(result.current.select).toBe(first.select);
  expect(result.current.persistUserTurn).toBe(first.persistUserTurn);
  result.current.select({ id: "c8" });
  await result.current.create();
  await result.current.remove({ id: "c6" });
  await result.current.rename({ id: "c8", title: "Report" });
  result.current.onMessagesChange({ messages: [message] });
  await expect(result.current.ensureConversationId()).resolves.toBe("c7");
  await result.current.persistUserTurn({ conversationId: "c7", message });
  expect(state.select.mock.calls).toEqual([[{ id: "c8" }, {}]]);
  expect(state.create.mock.calls).toEqual([[{}, {}]]);
  expect(state.remove.mock.calls).toEqual([[{ id: "c6" }, {}]]);
  expect(state.rename.mock.calls).toEqual([[{ id: "c8", title: "Report" }, {}]]);
  expect(state.onMessagesChange.mock.calls).toEqual([[{ messages: [message] }, {}]]);
  expect(state.ensureConversationId.mock.calls).toEqual([[{}, {}]]);
  expect(state.persistUserTurn.mock.calls).toEqual([[{ conversationId: "c7", message }, {}]]);
});
