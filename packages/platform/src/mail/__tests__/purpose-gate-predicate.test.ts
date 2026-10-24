import assert from "node:assert/strict";
import { test } from "vitest";
import { isPurposeGateOpen, wrapMailerWithPurposeGate, type PurposeGateRequired } from "../purpose-scoped-mailer.js";
import type { MailerPort } from "../ports.js";

test("predicate and delivery share production readiness for notification, absent and unknown lanes", async () => {
  for (const lane of ["notification", undefined, "future-lane"] as const) {
    for (const ready of [false, true]) {
      const checked: string[] = [];
      let deliveries = 0;
      const inner: MailerPort = {
        capabilities() { throw new Error("predicate must not inspect mailers"); },
        async send() { deliveries++; return { ok: true, providerMessageId: "id", acceptedAt: "2026-10-24T00:00:00Z" }; },
        async sendBatch() { throw new Error("unused"); },
      };
      const options = { sourceContext: { module: "fixture" }, lane } as PurposeGateRequired["options"];
      const readiness = { isReady: ({ capabilityName }: { capabilityName: string }) => { checked.push(capabilityName); return ready; } };
      assert.equal(isPurposeGateOpen({ mode: "production", readiness, options }), ready);
      assert.equal(deliveries, 0, "predicate performs no delivery");
      const gated = wrapMailerWithPurposeGate({ inner, mode: "production", readiness });
      const send = () => gated.send({ message: { workspaceId: "ws", to: { email: "to@example.com" }, from: { email: "from@example.com" }, subject: "hi", text: "hi" }, workspaceId: "ws", idempotencyKey: "key", sourceContext: options.sourceContext }, options.lane === undefined ? {} : { lane: options.lane });
      if (ready) await send();
      else await assert.rejects(send, { message: 'MAILER_SEND_REFUSED_NO_DURABLE_PATH: notification-lane mailer send refused for capability "fixture" — no durable outbox path registered' });
      assert.equal(deliveries, ready ? 1 : 0);
      assert.deepEqual(checked, ["fixture", "fixture"]);
    }
  }
});

test("local and interactive predicates bypass readiness entirely", () => {
  const readiness = { isReady: () => { throw new Error("must bypass readiness"); } };
  assert.equal(isPurposeGateOpen({ mode: "local", readiness, options: { sourceContext: { module: "fixture" } } }), true);
  assert.equal(isPurposeGateOpen({ mode: "production", readiness, options: { sourceContext: { module: "fixture" }, lane: "interactive" } }), true);
});

test("missing source context uses unknown capability; readiness failures propagate unchanged", () => {
  const options = {} as PurposeGateRequired["options"];
  const checked: string[] = [];
  assert.equal(isPurposeGateOpen({ mode: "production", options, readiness: { isReady: ({ capabilityName }) => { checked.push(capabilityName); return false; } } }), false);
  assert.deepEqual(checked, ["unknown"]);
  const error = new Error("readiness unavailable");
  assert.throws(() => isPurposeGateOpen({ mode: "production", options, readiness: { isReady: () => { throw error; } } }), err => err === error);
});

test("invalid predicate modes fail closed before consulting readiness", () => {
  const required = { mode: "typo", options: { lane: "interactive", sourceContext: { module: "fixture" } }, readiness: { isReady: () => { throw new Error("must validate first"); } } } as unknown as PurposeGateRequired;
  assert.throws(() => isPurposeGateOpen(required), { name: "TypeError", message: 'mailer mode must be "production" or "local"' });
});
