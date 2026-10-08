// Characterization assertions copied and generalized from contracts/core/__tests__/tool-surface-exchanges.test.ts
import assert from "node:assert/strict";
import { test, vi, onTestFinished } from "vitest";

import type { SurfaceEmission } from "@jini-ai/core";
import * as exchanges from "../surface-exchanges.js";

import {
  DEFAULT_SURFACE_IDLE_TTL_MS,
  DEFAULT_SURFACE_MAX_LIFETIME_MS,
  askOnce,
  askThenReport,
  SURFACE_TYPED_ANSWER_PARAM,
  classifyConfirmationAnswer,
  createSurfaceExchangeStore,
  resolveConfirmationDecision,
} from "./surface-fixture.js";

function recordingEmitter() {
  const sent: SurfaceEmission[] = [];
  return { sent, emit: async (emission: SurfaceEmission) => void sent.push(emission) };
}

const FORM: SurfaceEmission = { channel: "mcp-ui", payload: { resource: { type: "resource" } } };

test("a message reaches the exchange it names, carrying the human's params to the waiting call", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  const waiting = exchange.receive();
  const delivered = store.deliver({
    exchangeId: exchange.id,
    toolId: "t",
    principalId: "p",
    params: { plan: "pro", extras: ["a"] },
  });

  assert.deepEqual(delivered, { ok: true });
  assert.deepEqual(await waiting, { status: "received", params: { plan: "pro", extras: ["a"] } });
});

test("receive() does not settle before a message arrives", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  const settled = await Promise.race([exchange.receive(), Promise.resolve("still-waiting" as const)]);
  assert.equal(settled, "still-waiting");
});

test("BUFFER: a message delivered before anyone is listening is queued, not dropped", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { plan: "pro" } });

  assert.deepEqual(await exchange.receive(), { status: "received", params: { plan: "pro" } });
});

test("BUFFER: several early messages are replayed in arrival order, one per receive", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { n: 1 } });
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { n: 2 } });

  assert.deepEqual(await exchange.receive(), { status: "received", params: { n: 1 } });
  assert.deepEqual(await exchange.receive(), { status: "received", params: { n: 2 } });
  assert.equal(
    await Promise.race([exchange.receive(), Promise.resolve("drained" as const)]),
    "drained",
    "the queue is drained, not replayed"
  );
});

test("MULTI-TURN: send/receive can alternate any number of times on one call", async () => {
  const store = createSurfaceExchangeStore();
  const { sent, emit } = recordingEmitter();
  const exchange = store.open({ toolId: "t", principalId: "p" }, emit);

  const answers: unknown[] = [];
  const conversation = (async () => {
    for (let turn = 0; turn < 3; turn += 1) {
      await exchange.send({ channel: "a2ui", payload: { message: { updateComponents: { turn } } } });
      const message = await exchange.receive();
      answers.push(message.status === "received" ? message.params : message.status);
    }
    exchange.close();
  })();

  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { turn } });
  }
  await conversation;

  assert.equal(sent.length, 3);
  assert.deepEqual(answers, [{ turn: 0 }, { turn: 1 }, { turn: 2 }]);
});

test("a message for the wrong tool is refused AND leaves the exchange open", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  const wrongTool = store.deliver({ exchangeId: exchange.id, toolId: "other", principalId: "p", params: { plan: "pro" } });
  assert.deepEqual(wrongTool, { ok: false, reason: "binding-mismatch" });

  assert.equal(store.size(), 1);
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { plan: "pro" } });
  assert.deepEqual(await exchange.receive(), { status: "received", params: { plan: "pro" } });
});

test("a message for the wrong principal is refused — one human's answer cannot land in another's call", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "alice" }, recordingEmitter().emit);

  assert.deepEqual(
    store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "mallory", params: { plan: "pro" } }),
    { ok: false, reason: "binding-mismatch" }
  );
  assert.equal(store.size(), 1);

  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "alice", params: { plan: "basic" } });
  assert.deepEqual(await exchange.receive(), { status: "received", params: { plan: "basic" } });
});

test("an unknown or closed exchange id is refused rather than silently accepted", () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);
  exchange.close();

  assert.deepEqual(store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: {} }), {
    ok: false,
    reason: "unknown-or-closed",
  });
  assert.deepEqual(store.deliver({ exchangeId: "never-opened", toolId: "t", principalId: "p", params: {} }), {
    ok: false,
    reason: "unknown-or-closed",
  });
});

test("a channel with no toolId to offer (e.g. A2UI, correlating by its own surfaceId) can still deliver by exchangeId + principalId alone", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "assistant_demo_a2ui", principalId: "p" }, recordingEmitter().emit);

  const delivered = store.deliver({ exchangeId: exchange.id, principalId: "p", params: { message: { action: {} } } });

  assert.deepEqual(delivered, { ok: true });
  assert.deepEqual(await exchange.receive(), { status: "received", params: { message: { action: {} } } });
});

for (const channel of ["a2ui", "mcp-ui"] as const) {
  test(`${channel}: the other answer channel cannot consume its exchange`, async () => {
    const store = createSurfaceExchangeStore();
    const exchange = store.open({ toolId: "t", principalId: "p", channel }, recordingEmitter().emit);
    const pending = exchange.receive();
    const other = channel === "a2ui" ? "mcp-ui" : "a2ui";
    assert.deepEqual(store.deliver({ exchangeId: exchange.id, principalId: "p", channel: other, params: { wrong: true } }), { ok: false, reason: "binding-mismatch" });
    assert.equal(store.size(), 1);
    assert.equal(await Promise.race([pending, Promise.resolve("waiting")]), "waiting");
    assert.deepEqual(store.deliver({ exchangeId: exchange.id, principalId: "p", channel, params: { answer: "right" } }), { ok: true });
    assert.deepEqual(await pending, { status: "received", params: { answer: "right" } });
    exchange.close();
  });
}

test("omitting toolId does not relax the principal check — it is still the wrong human's answer", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "assistant_demo_a2ui", principalId: "alice" }, recordingEmitter().emit);

  const delivered = store.deliver({ exchangeId: exchange.id, principalId: "mallory", params: {} });

  assert.deepEqual(delivered, { ok: false, reason: "binding-mismatch" });
  assert.equal(store.size(), 1, "a mismatched delivery must not consume alice's still-open exchange");
});

test("a supplied toolId is still checked exactly, even though it is now optional to supply at all", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "assistant_demo_a2ui", principalId: "p" }, recordingEmitter().emit);

  const delivered = store.deliver({ exchangeId: exchange.id, toolId: "some_other_tool", principalId: "p", params: {} });

  assert.deepEqual(delivered, { ok: false, reason: "binding-mismatch" });
});

test("two concurrent exchanges settle independently, each with its own messages", async () => {
  const store = createSurfaceExchangeStore();
  const a = store.open({ toolId: "t", principalId: "alice" }, recordingEmitter().emit);
  const b = store.open({ toolId: "t", principalId: "bob" }, recordingEmitter().emit);

  assert.notEqual(a.id, b.id, "ids must not collide or one human answers for both");
  store.deliver({ exchangeId: b.id, toolId: "t", principalId: "bob", params: { plan: "team" } });

  assert.deepEqual(await b.receive(), { status: "received", params: { plan: "team" } });
  assert.equal(await Promise.race([a.receive(), Promise.resolve("still-waiting" as const)]), "still-waiting");
});

test("a waiting receive is released when the exchange expires, rather than hanging", async () => {
  const store = createSurfaceExchangeStore({ idleTtlMs: 1 });
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  assert.deepEqual(await exchange.receive(), { status: "expired" });
  assert.equal(store.size(), 0);
});

test("receive() after the exchange ended reports the terminal status instead of parking", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);
  exchange.close();

  assert.deepEqual(await exchange.receive(), { status: "abandoned" });
});

test("the idle deadline resets on activity, so a slow conversation is not punished for its length", async () => {
  vi.useFakeTimers(); onTestFinished(() => { vi.useRealTimers(); });
  const store = createSurfaceExchangeStore({ idleTtlMs: 300, maxLifetimeMs: 2000 });
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  for (let turn = 0; turn < 3; turn += 1) {
    vi.advanceTimersByTime(200);
    assert.deepEqual(store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { turn } }), { ok: true });
    assert.deepEqual(await exchange.receive(), { status: "received", params: { turn } });
  }
  assert.equal(store.size(), 1);
  const pending = exchange.receive();
  vi.advanceTimersByTime(299);
  assert.equal(await Promise.race([pending, Promise.resolve("waiting")]), "waiting");
  vi.advanceTimersByTime(1);
  assert.deepEqual(await pending, { status: "expired" });
  assert.equal(store.size(), 0);
});

test("the total-lifetime ceiling ends an exchange that stays busy forever", async () => {
  vi.useFakeTimers(); onTestFinished(() => { vi.useRealTimers(); });

  const store = createSurfaceExchangeStore({ idleTtlMs: 1000, maxLifetimeMs: 260 });
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);
  for (let turn = 0; turn < 3; turn += 1) {
    vi.advanceTimersByTime(80);
    assert.deepEqual(store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { turn } }), { ok: true });
    assert.deepEqual(await exchange.receive(), { status: "received", params: { turn } });
  }
  const pending = exchange.receive();
  vi.advanceTimersByTime(19);
  assert.equal(store.size(), 1);
  assert.equal(await Promise.race([pending, Promise.resolve("waiting")]), "waiting");
  vi.advanceTimersByTime(1);
  assert.deepEqual(await pending, { status: "expired" });
  assert.equal(store.size(), 0);
});

test("send() after the exchange ended is refused, matching the daemon emitter's own posture", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);
  exchange.close();

  await assert.rejects(() => exchange.send(FORM), /already ended/);
});

test("close() is idempotent, because a cancelled run races a human who just clicked", () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  exchange.close();
  exchange.close();
  assert.equal(store.size(), 0);
});

test("askOnce sends once, waits once, and closes — the one-shot case as the shortest exchange", async () => {
  const store = createSurfaceExchangeStore();
  const { sent, emit } = recordingEmitter();
  const exchange = store.open({ toolId: "t", principalId: "p" }, emit);

  const asked = askOnce(exchange, FORM);
  await new Promise((resolve) => setImmediate(resolve));
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { plan: "pro" } });

  assert.deepEqual(await asked, { status: "received", params: { plan: "pro" } });
  assert.deepEqual(sent, [FORM]);
  assert.equal(store.size(), 0, "askOnce closes, so a one-shot tool leaks nothing");
});

test("askOnce closes the exchange even when no answer ever comes", async () => {
  const store = createSurfaceExchangeStore({ idleTtlMs: 1 });
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  assert.deepEqual(await askOnce(exchange, FORM), { status: "expired" });
  assert.equal(store.size(), 0);
});

const OUTCOME: SurfaceEmission = { channel: "mcp-ui", payload: { resource: { type: "resource-outcome" } } };

for (const helper of ["askOnce", "askThenReport"] as const) {
  test(`${helper}: expiry before the first send returns expired without emitting or accepting a buffered confirmation`, async () => {
    for (const deadlines of [{ idleTtlMs: 100, maxLifetimeMs: 200 }, { idleTtlMs: 200, maxLifetimeMs: 100 }]) {
      for (const buffered of [false, true]) {
        let nowMs = 0;
        const store = exchanges.createSurfaceExchangeStore({
          clock: { nowMs: () => nowMs },
          // The clock can reach a deadline before the event loop runs its scheduled callbacks.
          scheduler: { schedule: () => () => {} },
          idGenerator: { newId: () => "expired-before-send" },
          defaultChannel: "mcp-ui",
        }, deadlines);
        const { sent, emit } = recordingEmitter();
        const exchange = store.open({ binding: { toolId: "t", principalId: "p" }, emit });
        if (buffered) assert.deepEqual(store.deliver({ exchangeId: exchange.id, principalId: "p", params: { decision: "confirm" } }, { toolId: "t" }), { ok: true });
        nowMs = 100;
        const answer = helper === "askOnce"
          ? await exchanges.askOnce({ exchange, emission: FORM })
          : await exchanges.askThenReport({ exchange, confirmationEmission: FORM, handle: async answer => ({ result: answer }) });
        assert.deepEqual(answer, { status: "expired" });
        assert.deepEqual(exchanges.classifyConfirmationAnswer({ answer }), { confirmed: false, reason: "expired" });
        assert.deepEqual(sent, []);
        assert.equal(store.size(), 0);
        assert.deepEqual(store.deliver({ exchangeId: exchange.id, principalId: "p", params: { decision: "confirm" } }, { toolId: "t" }), { ok: false, reason: "unknown-or-closed" });
        await assert.rejects(exchange.send({ emission: FORM }), { message: "surface exchange expired-before-send has already ended" });
      }
    }
  });

  test(`${helper}: an emitter failure still rejects and closes, even when its text resembles an ended exchange`, async () => {
    const failure = new Error("surface exchange failed-send has already ended");
    const store = exchanges.createSurfaceExchangeStore({
      clock: { nowMs: () => 0 }, scheduler: { schedule: () => () => {} },
      idGenerator: { newId: () => "failed-send" }, defaultChannel: "mcp-ui",
    });
    const exchange = store.open({ binding: { toolId: "t", principalId: "p" }, emit: async () => { throw failure; } });
    const pending = helper === "askOnce"
      ? exchanges.askOnce({ exchange, emission: FORM })
      : exchanges.askThenReport({ exchange, confirmationEmission: FORM, handle: async () => { assert.fail("an emitter failure must not invoke handle"); } });
    await assert.rejects(pending, error => error === failure);
    assert.equal(store.size(), 0);
  });
}

test("askThenReport: sends the confirmation, then sends handle's outcome AFTER the answer — the exact defect askOnce cannot fix, since askOnce closes before a caller could send anything else", async () => {
  const store = createSurfaceExchangeStore();
  const { sent, emit } = recordingEmitter();
  const exchange = store.open({ toolId: "t", principalId: "p" }, emit);

  const asked = askThenReport(exchange, FORM, async (answer) => {
    assert.deepEqual(answer, { status: "received", params: { decision: "confirm" } });
    return { result: { published: true }, outcome: OUTCOME };
  });
  await new Promise((resolve) => setImmediate(resolve));
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { decision: "confirm" } });

  assert.deepEqual(await asked, { published: true });

  assert.deepEqual(sent, [FORM, OUTCOME]);
  assert.equal(store.size(), 0, "askThenReport closes once handle (and the outcome send) finish");
});

test("askThenReport: handle may omit outcome (e.g. a cancel) — no second send, exchange still closes", async () => {
  const store = createSurfaceExchangeStore();
  const { sent, emit } = recordingEmitter();
  const exchange = store.open({ toolId: "t", principalId: "p" }, emit);

  const asked = askThenReport(exchange, FORM, async () => ({ result: { published: false, cancelled: true } }));
  await new Promise((resolve) => setImmediate(resolve));
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { decision: "cancel" } });

  assert.deepEqual(await asked, { published: false, cancelled: true });
  assert.deepEqual(sent, [FORM], "no outcome was supplied, so nothing beyond the confirmation was ever sent");
  assert.equal(store.size(), 0);
});

test("askThenReport: the model's result is unaffected even when the outcome send itself fails — the exchange having already ended is not a tool failure", async () => {
  const store = createSurfaceExchangeStore();
  const { emit } = recordingEmitter();
  const exchange = store.open({ toolId: "t", principalId: "p" }, emit);

  const asked = askThenReport(exchange, FORM, async () => {

    exchange.close();
    return { result: { published: true, reachable: true }, outcome: OUTCOME };
  });
  await new Promise((resolve) => setImmediate(resolve));
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: {} });

  assert.deepEqual(await asked, { published: true, reachable: true });
});

test("askThenReport: closes the exchange even when handle itself throws, matching askOnce's own finally-close discipline", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  const asked = askThenReport(exchange, FORM, async () => {
    throw new Error("real work blew up");
  });
  await new Promise((resolve) => setImmediate(resolve));
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: {} });

  await assert.rejects(asked, /real work blew up/);
  assert.equal(store.size(), 0, "a throwing handle must not leak the exchange");
});

test("askThenReport: an answer that never arrives (expired) still reaches handle, which can report a no-op result with no outcome to send", async () => {
  const store = createSurfaceExchangeStore({ idleTtlMs: 1 });
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  const result = await askThenReport(exchange, FORM, async (answer) => {
    assert.deepEqual(answer, { status: "expired" });
    return { result: { published: false, reason: "expired" } };
  });
  assert.deepEqual(result, { published: false, reason: "expired" });
});

test("newExchangeId can be injected so caller controls generated exchange IDs", () => {
  const store = createSurfaceExchangeStore({ newExchangeId: () => "custom-id-123" });
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);
  assert.equal(exchange.id, "custom-id-123");
  assert.equal(store.size(), 1);
});

test("classifyConfirmationAnswer: an explicit decision:'confirm' is confirmed", () => {
  assert.deepEqual(classifyConfirmationAnswer({ status: "received", params: { decision: "confirm" } }), { confirmed: true });
});

test("classifyConfirmationAnswer: a missing 'decision' field is declined, not confirmed — fail closed", () => {
  assert.deepEqual(classifyConfirmationAnswer({ status: "received", params: {} }), { confirmed: false, reason: "declined" });
});

test("classifyConfirmationAnswer: a non-string 'decision' is declined, not confirmed — fail closed", () => {
  assert.deepEqual(classifyConfirmationAnswer({ status: "received", params: { decision: true } }), {
    confirmed: false,
    reason: "declined",
  });
});

test("classifyConfirmationAnswer: a typed chat answer never confirms — even when the words say yes", () => {
  assert.deepEqual(
    classifyConfirmationAnswer({ status: "received", params: { [SURFACE_TYPED_ANSWER_PARAM]: "yes do it" } }),
    { confirmed: false, reason: "declined" },
  );
});

test("classifyConfirmationAnswer: an unrecognised 'decision' string is declined, not confirmed", () => {
  assert.deepEqual(classifyConfirmationAnswer({ status: "received", params: { decision: "yes" } }), {
    confirmed: false,
    reason: "declined",
  });
});

test("classifyConfirmationAnswer: an explicit cancel is declined", () => {
  assert.deepEqual(classifyConfirmationAnswer({ status: "received", params: { decision: "cancel" } }), {
    confirmed: false,
    reason: "declined",
  });
});

test("classifyConfirmationAnswer: expired/abandoned pass their status through as the reason", () => {
  assert.deepEqual(classifyConfirmationAnswer({ status: "expired" }), { confirmed: false, reason: "expired" });
  assert.deepEqual(classifyConfirmationAnswer({ status: "abandoned" }), { confirmed: false, reason: "abandoned" });
});

test("resolveConfirmationDecision: asks once, then classifies the answer, and closes the exchange either way", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  const asked = resolveConfirmationDecision(exchange, FORM);
  await new Promise((resolve) => setImmediate(resolve));
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: { decision: "confirm" } });

  assert.deepEqual(await asked, { confirmed: true });
  assert.equal(store.size(), 0, "askOnce's own close-on-settle discipline must still apply");
});

test("resolveConfirmationDecision: a declined answer classifies as declined, same as a direct classifyConfirmationAnswer call", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit);

  const asked = resolveConfirmationDecision(exchange, FORM);
  await new Promise((resolve) => setImmediate(resolve));
  store.deliver({ exchangeId: exchange.id, toolId: "t", principalId: "p", params: {} });

  assert.deepEqual(await asked, { confirmed: false, reason: "declined" });
});

test("the deadlines are ordered so the exchange, not the transport, gives up first", () => {

  assert.ok(DEFAULT_SURFACE_IDLE_TTL_MS <= DEFAULT_SURFACE_MAX_LIFETIME_MS);
  assert.ok(DEFAULT_SURFACE_MAX_LIFETIME_MS < 6 * 60 * 1000);
});

test("findTypedAnswerTarget: resolves the one open exchange a typed answer could be meant for", () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "assistant_ask_choice", principalId: "p" }, recordingEmitter().emit);

  assert.equal(store.findTypedAnswerTarget({ principalId: "p", toolId: "assistant_ask_choice" }), exchange.id);
});

test("findTypedAnswerTarget: another principal's open question is never a target", () => {
  const store = createSurfaceExchangeStore();
  store.open({ toolId: "assistant_ask_choice", principalId: "someone-else" }, recordingEmitter().emit);

  assert.equal(store.findTypedAnswerTarget({ principalId: "p", toolId: "assistant_ask_choice" }), undefined);
});

test("findTypedAnswerTarget: an exchange opened by a different tool is never a target", () => {
  const store = createSurfaceExchangeStore();

  store.open({ toolId: "content_post_delete", principalId: "p" }, recordingEmitter().emit);

  assert.equal(store.findTypedAnswerTarget({ principalId: "p", toolId: "assistant_ask_choice" }), undefined);
});

test("findTypedAnswerTarget: refuses to guess when the same human has two questions outstanding", () => {
  const store = createSurfaceExchangeStore();
  store.open({ toolId: "assistant_ask_choice", principalId: "p" }, recordingEmitter().emit);
  store.open({ toolId: "assistant_ask_choice", principalId: "p" }, recordingEmitter().emit);

  assert.equal(store.findTypedAnswerTarget({ principalId: "p", toolId: "assistant_ask_choice" }), undefined);
});

test("findTypedAnswerTarget: a closed exchange stops being a target", async () => {
  const store = createSurfaceExchangeStore();
  const exchange = store.open({ toolId: "assistant_ask_choice", principalId: "p" }, recordingEmitter().emit);
  exchange.close();

  assert.equal(store.findTypedAnswerTarget({ principalId: "p", toolId: "assistant_ask_choice" }), undefined);
});

test("default exchange ids are distinct UUIDv4 values while multiple exchanges remain pending", () => {
  const store = createSurfaceExchangeStore();
  const exchanges = Array.from({ length: 32 }, () => store.open({ toolId: "t", principalId: "p" }, recordingEmitter().emit));
  onTestFinished(() => exchanges.forEach((exchange) => exchange.close()));
  const ids = exchanges.map(({ id }) => id);
  assert.equal(new Set(ids).size, exchanges.length);
  assert.equal(store.size(), exchanges.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (let n = 0; n < 30; n++) {
    const guessed = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    assert.deepEqual(store.deliver({ exchangeId: guessed, principalId: "p", toolId: "t", params: {} }), { ok: false, reason: "unknown-or-closed" });
  }
  assert.equal(store.size(), exchanges.length, "guesses must leave every real pending exchange intact");
});
