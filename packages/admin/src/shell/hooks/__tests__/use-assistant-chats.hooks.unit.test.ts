import { describe, expect, it } from "vitest";

import type { AssistantChatsPort, AssistantConversation } from "../assistant-chats-port.hooks";
import { sharedPort } from "../use-assistant-chats.hooks";

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
