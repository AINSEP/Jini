/** C1 parity: all 13 existing host dialect cases; extra host tables remain fixture-owned. */
import assert from 'node:assert/strict';
import { beforeEach, afterEach, describe, test } from 'vitest';
import type { ChatMessage } from '../../core/messages.js';
import type { ChatOwnerScope } from '../../core/persistence/ports.js';
import type { Fixture } from './fixtures.js';
const T0 = 1_790_000_000_000;
const ALICE = { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' } as const;
const BOB = { scopeId: 'ws', ownerKind: 'user', ownerId: 'bob' } as const;
function clock(start = T0): () => number { let t = start; return () => t++; }
const user = (id: string, content = id): ChatMessage => ({ id, role: 'user', content });
export function chatParityContract({ name, makeFixture }: { name: string; makeFixture: () => Promise<Fixture> }) {
 describe(`${name} parity`, () => {
 let f: Fixture;
 beforeEach(async () => { f = await makeFixture(); });
 afterEach(async () => { await f?.close(); });
 function stores() { const now = clock(); return { kernel: f.kernel, alice: f.make(ALICE, { nowMs: now }), bob: f.make(BOB, { nowMs: now }), of: (scope: ChatOwnerScope) => f.make(scope, { nowMs: now }) }; }
  test("create then get and list round-trip every conversation field", async () => {
    const { alice } = stores();
    const created = await alice.create({ id: "c1", title: "Hello", titleSource: "manual", expiresAt: T0 + 1000 });
    assert.deepEqual(created, {
      id: "c1",
      title: "Hello",
      titleSource: "manual",
      messageCount: 0,
      createdAt: T0,
      updatedAt: T0,
      expiresAt: T0 + 1000,
    });
    assert.deepEqual(await alice.get({ id: "c1" }), created);
    const plain = await alice.create({ id: "c2" });
    assert.equal(plain.title, null);
    assert.equal(plain.titleSource, "fallback");
    assert.equal("expiresAt" in plain, false);
  });

  test("list is most-recently-updated first and counts messages", async () => {
    const { alice } = stores();
    await alice.create({ id: "old" });
    await alice.create({ id: "new" });
    await alice.appendMessage({ conversationId: "old", message: user("m1") });
    await alice.appendMessage({ conversationId: "old", message: user("m2") });
    const listed = await alice.list();
    assert.deepEqual(
      listed.map((c) => [c.id, c.messageCount]),
      [
        ["old", 2],
        ["new", 0],
      ]
    );
  });

  test("messages round-trip every stored field, in position order", async () => {
    const { alice } = stores();
    await alice.create({ id: "c1" });
    const full: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "answer",
      agentId: "claude",
      agentName: "Claude",
      events: [{ kind: "text", text: "hi" }],
      attachments: [{ path: "f.txt", name: "f.txt", kind: "file" }],
      runId: "run-1",
      runStatus: "succeeded",
      createdAt: T0 + 5,
      startedAt: T0 + 6,
      endedAt: T0 + 7,
    };
    await alice.appendMessage({ conversationId: "c1", message: user("u1", "question") });
    const saved = await alice.appendMessage({ conversationId: "c1", message: full });
    assert.deepEqual(saved, full);
    const all = await alice.messages({ conversationId: "c1" });
    assert.deepEqual(
      all.map((m) => m.id),
      ["u1", "a1"]
    );
    assert.equal(all[0]!.content, "question");
    assert.equal(typeof all[0]!.createdAt, "number");
  });

  test("a malformed events column reads as no events, not an error", async () => {
    const { kernel, alice } = stores();
    await alice.create({ id: "c1" });
    await alice.appendMessage({ conversationId: "c1", message: user("u1") });
    await kernel.run((db) => db.updateTable("ai_chat_messages").set({ events_json: "{not json" }).where("id", "=", "u1").execute());
    const [message] = await alice.messages({ conversationId: "c1" });
    assert.equal(message!.events, undefined);
    assert.equal(message!.content, "u1");
  });

  test("appending an existing id updates it in place at the same position", async () => {
    const { alice } = stores();
    await alice.create({ id: "c1" });
    await alice.appendMessage({ conversationId: "c1", message: user("u1") });
    await alice.appendMessage({ conversationId: "c1", message: { id: "a1", role: "assistant", content: "draft", runStatus: "running" } });
    await alice.appendMessage({ conversationId: "c1", message: user("u2") });
    await alice.appendMessage({ conversationId: "c1", message: { id: "a1", role: "assistant", content: "final", runStatus: "succeeded" } });
    const all = await alice.messages({ conversationId: "c1" });
    assert.deepEqual(
      all.map((m) => [m.id, m.content]),
      [
        ["u1", "u1"],
        ["a1", "final"],
        ["u2", "u2"],
      ]
    );
    assert.equal(all[1]!.runStatus, "succeeded");
  });

  test("appending bumps the conversation's updatedAt", async () => {
    const { alice } = stores();
    const created = await alice.create({ id: "c1" });
    await alice.appendMessage({ conversationId: "c1", message: user("u1") });
    assert.ok((await alice.get({ id: "c1" }))!.updatedAt > created.updatedAt);
  });

  test("rename: a generated title replaces a fallback one but never a manual one", async () => {
    const { alice } = stores();
    await alice.create({ id: "c1" });
    assert.equal((await alice.rename({ id: "c1", title: "Auto" }, { source: "generated" }))!.title, "Auto");
    assert.equal((await alice.rename({ id: "c1", title: "Mine" }))!.titleSource, "manual");
    const after = await alice.rename({ id: "c1", title: "Auto again" }, { source: "generated" });
    assert.equal(after!.title, "Mine");
    assert.equal(after!.titleSource, "manual");
  });

  test("touch bumps updatedAt and, when asked, the expiry", async () => {
    const { alice } = stores();
    const created = await alice.create({ id: "c1", expiresAt: T0 + 10 });
    await alice.touch({ id: "c1" });
    const touched = await alice.get({ id: "c1" });
    assert.ok(touched!.updatedAt > created.updatedAt);
    assert.equal(touched!.expiresAt, T0 + 10);
    await alice.touch({ id: "c1" }, { expiresAt: T0 + 99 });
    assert.equal((await alice.get({ id: "c1" }))!.expiresAt, T0 + 99);
  });

  test("delete cascades to messages, agent sessions and tool approvals", async () => {
    const { kernel, alice } = stores();
    await alice.create({ id: "c1" });
    await alice.appendMessage({ conversationId: "c1", message: user("u1") });
    await kernel.run((db) =>
      db.insertInto("assistant_agent_sessions").values({ conversation_id: "c1", agent_id: "a", session_id: "s", updated_at: T0 }).execute()
    );
    await kernel.run(db => db.insertInto("assistant_conversation_tool_approvals").values({ conversation_id: "c1", principal_id: "alice", connection_id: "mcp", tool_name: "read", fingerprint: "fp", granted_at: "2026-09-01T00:00:00.000Z" }).execute());
    await alice.delete({ id: "c1" });
    assert.equal(await alice.get({ id: "c1" }), null);
    const left = await kernel.run(async (db) => [
      ...(await db.selectFrom("ai_chat_messages").select("id").execute()),
      ...(await db.selectFrom("assistant_agent_sessions").select("conversation_id as id").execute()),
      ...(await db.selectFrom("assistant_conversation_tool_approvals").select("conversation_id as id").execute()),
    ]);
    assert.deepEqual(left, []);
  });

  test("another owner, workspace or owner kind sees nothing and changes nothing", async () => {
    const { alice, bob, of } = stores();
    await alice.create({ id: "c1", title: "Alice's" });
    await alice.appendMessage({ conversationId: "c1", message: user("u1") });
    for (const other of [bob, of({ ...ALICE, scopeId: "ws2" }), of({ ...ALICE, ownerKind: "guest" })]) {
      assert.equal(await other.get({ id: "c1" }), null);
      assert.deepEqual(await other.list(), []);
      assert.deepEqual(await other.messages({ conversationId: "c1" }), []);
      assert.equal(await other.rename({ id: "c1", title: "hijack" }), null);
      await other.touch({ id: "c1" }, { expiresAt: 1 });
      await other.delete({ id: "c1" });
      assert.equal(await other.appendMessage({ conversationId: "c1", message: user("x1") }), null);
    }
    const still = await alice.get({ id: "c1" });
    assert.equal(still!.title, "Alice's");
    assert.equal(still!.messageCount, 1);
    assert.equal("expiresAt" in still!, false);
  });

  test("appending an id that lives in another owner's chat never overwrites that row", async () => {
    const { alice, bob } = stores();
    await alice.create({ id: "ca" });
    await bob.create({ id: "cb" });
    await alice.appendMessage({ conversationId: "ca", message: user("shared-id", "alice's text") });
    assert.equal(await bob.appendMessage({ conversationId: "cb", message: user("shared-id", "bob's text") }), null);
    assert.equal((await alice.messages({ conversationId: "ca" }))[0]!.content, "alice's text");
    assert.deepEqual(await bob.messages({ conversationId: "cb" }), []);
  });

  test("an append inside a rolled-back transaction leaves nothing", async () => {
    const { kernel, alice } = stores();
    await alice.create({ id: "c1" });
    await assert.rejects(
      kernel.transaction(async () => {
        await alice.appendMessage({ conversationId: "c1", message: user("u1") });
        throw new Error("boom");
      }),
      /boom/
    );
    assert.deepEqual(await alice.messages({ conversationId: "c1" }), []);
  });

  test("concurrent appends to one chat get distinct, gap-free positions", async () => {
    const { kernel, alice } = stores();
    await alice.create({ id: "c1" });
    const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    const saved = await Promise.all(ids.map((id) => alice.appendMessage({ conversationId: "c1", message: user(id) })));
    assert.ok(saved.every((m) => m !== null));
    const positions = await kernel.run((db) => db.selectFrom("ai_chat_messages").select("position").orderBy("position").execute());
    assert.deepEqual(
      positions.map((p) => Number(p.position)),
      ids.map((_, i) => i)
    );
  });
 });
}
