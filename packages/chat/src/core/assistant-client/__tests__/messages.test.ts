import { describe, expect, it } from "vitest";
import { activeRunStub, messageWriteKey, persistableMessages } from "../entry.js";
import type { ChatMessage } from "../../messages.js";

const user = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "user", content: id, ...extra });
const assistant = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", content: id, ...extra });

describe("persistableMessages", () => {
  it("keeps accepted user turns and settled assistant turns, dropping pending input and live runs", () => {
    const messages = [
      user("u1"),
      user("u2", { inputPending: true }),
      assistant("a1", { runId: "r1", runStatus: "succeeded" }),
      assistant("a2", { runId: "r2", runStatus: "running" }),
      assistant("a3"),
      assistant("a4", { runId: "r4", runStatus: "failed" }),
    ];
    expect(persistableMessages({ messages }).map(message => message.id)).toEqual(["u1", "a1", "a4"]);
  });
});

describe("messageWriteKey", () => {
  it("keys a run-less message by id and a run's message by id and run, so a retry is saved again", () => {
    expect(messageWriteKey({ message: { id: "u1" } })).toBe("u1");
    expect(messageWriteKey({ message: { id: "a1", runId: "r1" } })).toBe("a1:r1");
    expect(messageWriteKey({ message: { id: "a1", runId: "r2" } })).not.toBe(messageWriteKey({ message: { id: "a1", runId: "r1" } }));
  });
});

describe("activeRunStub", () => {
  it("returns the newest assistant turn only while its run is in flight", () => {
    const live = assistant("a2", { runId: "r2", runStatus: "running" });
    expect(activeRunStub({ messages: [user("u1"), live] })).toBe(live);
    expect(activeRunStub({ messages: [user("u1"), assistant("a2", { runId: "r2", runStatus: "succeeded" })] })).toBeNull();
  });

  it("records nothing for an empty transcript, a trailing user turn, or an assistant turn without a run", () => {
    expect(activeRunStub({ messages: [] })).toBeNull();
    expect(activeRunStub({ messages: [assistant("a1", { runId: "r1", runStatus: "running" }), user("u2")] })).toBeNull();
    expect(activeRunStub({ messages: [assistant("a1", { runStatus: "running" })] })).toBeNull();
  });
});
