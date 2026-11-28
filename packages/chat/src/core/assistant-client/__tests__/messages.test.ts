import { describe, expect, it } from "vitest";
import { activeRunStub, messageWriteKey, persistableMessages, createConditionalHistoryRead } from "../entry.js";
import type { ChatMessage } from "../../messages.js";
import { persistableMessages as persistableMessagesFromCore } from "../../index.js";

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

describe.each([
  ["transports/http", persistableMessages],
  ["core", persistableMessagesFromCore],
] as const)("persistableMessages through %s", (_entry, filter) => {
  const messages: readonly ChatMessage[] = Object.freeze([
    Object.freeze(user("pending", { inputPending: true })),
    Object.freeze(user("accepted")),
    Object.freeze(assistant("running", { runStatus: "running" })),
    Object.freeze(assistant("queued", { runStatus: "queued" })),
    Object.freeze(assistant("succeeded", { runStatus: "succeeded" })),
    Object.freeze(assistant("failed", { content: "", runStatus: "failed" })),
    Object.freeze(assistant("canceled", { content: "", runStatus: "canceled" })),
  ]);

  it("defaults to accepted users and terminal assistants, including empty failures and cancellations", () => {
    const expected = ["accepted", "succeeded", "failed", "canceled"];
    expect(filter({ messages }).map(message => message.id)).toEqual(expected);
    expect(filter({ messages }, { includePendingUser: false }).map(message => message.id)).toEqual(expected);
  });

  it("opts into pending user turns while still excluding live assistants", () => {
    const saved = filter({ messages }, { includePendingUser: true });
    expect(saved.map(message => message.id)).toEqual(["pending", "accepted", "succeeded", "failed", "canceled"]);
    expect(saved[0]).toBe(messages[0]);
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

it('conditional history keeps one snapshot by reference and checks the server on every refresh', async () => {
  const messages = [{ id: 'u1', role: 'user' as const, content: 'saved' }];
  const versions: (string | undefined)[] = [];
  let calls = 0;
  const load = createConditionalHistoryRead({ read: async (_input, { version }) => {
    versions.push(version);
    return ++calls === 1 ? { messages, version: 'v1' } : { unchanged: true };
  } });
  expect(await load({ conversationId: 'c' })).toBe(messages);
  expect(await load({ conversationId: 'c' })).toBe(messages);
  expect(versions).toEqual([undefined, 'v1']);
});

it('conditional history discards another conversation snapshot and clears failed reads', async () => {
  const versions: (string | undefined)[] = [];
  let fail = false;
  const load = createConditionalHistoryRead({ read: async ({ conversationId }, { version }) => {
    versions.push(version);
    if (fail) throw new Error('history read refused');
    return { messages: [{ id: conversationId, role: 'user', content: 'saved' }], version: 'v1' };
  } });
  await load({ conversationId: 'a' });
  await load({ conversationId: 'b' });
  fail = true;
  await expect(load({ conversationId: 'b' })).rejects.toThrow('history read refused');
  fail = false;
  await load({ conversationId: 'b' });
  expect(versions).toEqual([undefined, undefined, 'v1', undefined]);
});

it('conditional history refuses an unchanged answer with no earlier snapshot and coerces a missing message list', async () => {
  const replies: Array<{ unchanged?: boolean; messages?: unknown; version?: string }> = [{ unchanged: true }, { messages: 'not-a-list', version: 'v2' }, { unchanged: true }];
  const versions: (string | undefined)[] = [];
  const load = createConditionalHistoryRead({ read: async (_input, { version }) => { versions.push(version); return replies.shift() as never; } });
  await expect(load({ conversationId: 'c' })).rejects.toThrow(/^Unchanged history requires an earlier snapshot$/);
  expect(await load({ conversationId: 'c' })).toEqual([]);
  expect(await load({ conversationId: 'c' })).toEqual([]);
  expect(versions).toEqual([undefined, undefined, 'v2']);
});
