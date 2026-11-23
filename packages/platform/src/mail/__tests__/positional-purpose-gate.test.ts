import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { wrapPositionalMailerWithPurposeGate as wrapMailerWithPurposeGate } from "../positional-purpose-gate.js";
import type { PositionalMailer as MailerPort } from "../plugin-abi.js";
import type { OutboundEmail, MailerSendOptions, MailerSendResult } from "../ports.js";

/**
 * @file SPEC-022 C-005 / CIC U-001 — the purpose-scoped mailer seam gate
 * (REQ-09/REQ-10, INV-05, EC-04, AC-16/17/18/19/20).
 *
 * This is the CIC-designated security-critical unit (see critical-internal-constraints.md
 * U-001) — the adversarial "unrecognized lane value" cases below (U-001-B1/EC-04) are the
 * load-bearing tests here, written and prioritized before the happy-path cases, per the
 * Implementation Outline's TDD focus note. This exact class of bug (two call sites silently
 * converging on the same untyped `purpose: "transactional"` value) was independently
 * verified in this codebase before this spec existed — these tests exist because of that
 * finding, not hypothetically.
 */

const FAKE_EMAIL: OutboundEmail = {
  workspaceId: "ws-1",
  to: { email: "someone@example.com" },
  from: { email: "no-reply@example.com" },
  subject: "test",
  text: "test body",
};

const SUCCESS: MailerSendResult = { ok: true, providerMessageId: "msg-1", acceptedAt: "2026-09-30T00:00:00Z" };

function fakeInnerMailer(result: MailerSendResult = SUCCESS) {
  const sends: MailerSendOptions[] = [];
  const messages: OutboundEmail[] = [];
  const batches: { messages: readonly OutboundEmail[]; options: MailerSendOptions }[] = [];
  const capabilities = {
    driver: "memory", supportsIdempotencyKey: true, supportsWebhookFeedback: false,
    maxBatchSize: 10, supportsAttachments: true,
  };
  const mailer: MailerPort = {
    async send(message, options) {
      messages.push(structuredClone(message));
      sends.push(structuredClone(options));
      return result;
    },
    async sendBatch(messages, options) {
      batches.push(structuredClone({ messages, options }));
      return messages.map(() => result);
    },
    capabilities: () => capabilities,
  };
  return { mailer, sends, messages, batches, capabilities };
}

test("U-001-B1/EC-04: an unrecognized lane-discriminator value resolves to notification lane (fail closed), not interactive", async () => {
  const { mailer, sends } = fakeInnerMailer();
  let durableReady = false;
  const gated = wrapMailerWithPurposeGate({
    inner: mailer,
    mode: "production",
    durableOutboxReady: () => durableReady,
  });

  // Simulates a future third call site with a discriminator value nobody anticipated.
  await assert.rejects(
    () =>
      gated.send(FAKE_EMAIL, {
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "future-feature" },
        // @ts-expect-error — deliberately an unrecognized value to prove fail-closed behavior
        lane: "some-brand-new-value-nobody-mapped",
      }),
    /MAILER_SEND_REFUSED_NO_DURABLE_PATH/,
    "an unrecognized lane value must be refused in production, same as an explicit notification-lane send with no durable path"
  );
  assert.equal(sends.length, 0, "the inner mailer must never be called for a refused send");

  durableReady = true;
  await gated.send(FAKE_EMAIL, {
    idempotencyKey: "k2",
    workspaceId: "ws-1",
    sourceContext: { module: "future-feature" },
    // @ts-expect-error — same unrecognized value, now with a durable path registered
    lane: "some-brand-new-value-nobody-mapped",
  });
  assert.equal(sends.length, 1, "once a durable path is ready, the same (still-unrecognized) lane value proceeds — proving the gate discriminates on readiness, not just on recognizing the value");
});

test("AC-16: a legacy transactional send without a lane defaults to notification", async () => {
  const { mailer, sends } = fakeInnerMailer();
  let durableReady = false;
  const gated = wrapMailerWithPurposeGate({
    inner: mailer, mode: "production",
    durableOutboxReady: ({ capabilityName: capability }) => capability === "forms" && durableReady,
  });
  const options: MailerSendOptions = {
    idempotencyKey: "legacy-1", workspaceId: "ws-1",
    sourceContext: { module: "forms" }, purpose: "transactional",
  };
  await assert.rejects(() => gated.send(FAKE_EMAIL, options), /capability "forms"/);
  assert.equal(sends.length, 0);
  durableReady = true;
  await gated.send(FAKE_EMAIL, options);
  assert.deepEqual(sends, [options]);
});

test("AC-17: post-fix vocabulary split resolves members (interactive) and forms (notification) to distinct lanes", async () => {
  const { mailer, sends } = fakeInnerMailer();
  const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "production", durableOutboxReady: () => false });

  // Interactive lane (members' shape, post-fix) — must proceed even with no durable path.
  await gated.send(FAKE_EMAIL, {
    idempotencyKey: "members-1",
    workspaceId: "ws-1",
    sourceContext: { module: "members" },
    lane: "interactive",
  } as MailerSendOptions);
  assert.equal(sends.length, 1);

  // Notification lane (forms' shape, post-fix) — must be refused with no durable path.
  await assert.rejects(() =>
    gated.send(FAKE_EMAIL, {
      idempotencyKey: "forms-1",
      workspaceId: "ws-1",
      sourceContext: { module: "forms" },
      lane: "notification",
    } as MailerSendOptions)
  );
  assert.equal(sends.length, 1, "the notification-lane send must not have reached the inner mailer");
});

test("AC-18: notification-lane send refused in production without a durable path — structured refusal, not silent drop", async () => {
  const { mailer, sends } = fakeInnerMailer();
  const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "production", durableOutboxReady: () => false });

  await assert.rejects(
    () =>
      gated.send(FAKE_EMAIL, {
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "forms" },
        lane: "notification",
      } as MailerSendOptions),
    (err: Error) => err.message.includes("MAILER_SEND_REFUSED_NO_DURABLE_PATH")
  );
  assert.equal(sends.length, 0);
});

test("AC-19: interactive-lane send proceeds under the same conditions (no durable path) that refuse notification-lane", async () => {
  const { mailer, sends } = fakeInnerMailer();
  const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "production", durableOutboxReady: () => false });

  await gated.send(FAKE_EMAIL, {
    idempotencyKey: "k1",
    workspaceId: "ws-1",
    sourceContext: { module: "members" },
    lane: "interactive",
  } as MailerSendOptions);
  assert.equal(sends.length, 1, "interactive lane must never be gated on durable-outbox readiness");
});

test("AC-20: notification-lane readiness is scoped to the sending capability", async () => {
  const { mailer, sends } = fakeInnerMailer();
  const checked: string[] = [];
  const gated = wrapMailerWithPurposeGate({
    inner: mailer, mode: "production",
    durableOutboxReady: ({ capabilityName: capability }) => { checked.push(capability); return capability === "forms"; },
  });
  const options: MailerSendOptions = {
    idempotencyKey: "k1", workspaceId: "ws-1",
    sourceContext: { module: "forms" }, lane: "notification",
  };
  await gated.send(FAKE_EMAIL, options);
  assert.equal(sends.length, 1);
  await assert.rejects(
    () => gated.send(FAKE_EMAIL, { ...options, sourceContext: { module: "members" } }),
    /MAILER_SEND_REFUSED_NO_DURABLE_PATH:.*capability "members"/,
  );
  assert.deepEqual(checked, ["forms", "members"]);
  assert.equal(sends.length, 1, "another capability's durable path cannot permit this send");
});

test("U-001-B3/INV-06: local mode never refuses, regardless of lane or durable-path readiness", async () => {
  const { mailer, sends } = fakeInnerMailer();
  const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "local", durableOutboxReady: () => false });

  await gated.send(FAKE_EMAIL, {
    idempotencyKey: "k1",
    workspaceId: "ws-1",
    sourceContext: { module: "forms" },
    lane: "notification",
  } as MailerSendOptions);
  assert.equal(sends.length, 1, "local mode must behave exactly as it does today — no refusal path");
});

test("U-001-ORD1: mode is resolved once and cached, not re-read from process.env on every send", async () => {
  const { mailer, sends } = fakeInnerMailer();
  const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "local", durableOutboxReady: () => false });

  const originalEnv = process.env.TOVU_RUNTIME_MODE;
  try {
    process.env.TOVU_RUNTIME_MODE = "production";
    // The decorator was constructed with mode "local" already resolved/injected — a later
    // mutation of process.env must not change its behavior mid-process.
    await gated.send(FAKE_EMAIL, {
      idempotencyKey: "k1",
      workspaceId: "ws-1",
      sourceContext: { module: "forms" },
      lane: "notification",
    } as MailerSendOptions);
    assert.equal(sends.length, 1, "decorator must not re-resolve mode from a live env read");
  } finally {
    if (originalEnv === undefined) delete process.env.TOVU_RUNTIME_MODE;
    else process.env.TOVU_RUNTIME_MODE = originalEnv;
  }
});

test("permitted sends forward the complete message, options and successful or failed delivery result", async () => {
  const message: OutboundEmail = {
    ...FAKE_EMAIL, to: { email: "recipient@example.com", name: "Recipient" },
    from: { email: "sender@example.com", name: "Sender" },
    replyTo: { email: "reply@example.com" }, html: "<p>body</p>",
    headers: { "List-Unsubscribe": "<https://example.com/unsubscribe>" },
    attachments: [{ filename: "a.txt", contentType: "text/plain", contentBase64: "YQ==" }],
  };
  const failure: MailerSendResult = { ok: false, retryable: true, errorCode: "UNAVAILABLE", message: "try later" };
  for (const mode of ["production", "local"] as const) {
    const results: MailerSendResult[] = [SUCCESS, failure];
    for (const result of results) {
      const { mailer, sends, messages } = fakeInnerMailer(result);
      const gated = wrapMailerWithPurposeGate({ inner: mailer, mode, durableOutboxReady: () => false });
      const options: MailerSendOptions = {
        idempotencyKey: "forward-1", workspaceId: "ws-1", timeoutMs: 1234,
        sourceContext: { module: "members", ref: "member-1" }, purpose: "transactional",
        lane: mode === "production" ? "interactive" : "notification",
      };
      const expectedMessage = structuredClone(message);
      const expectedOptions = structuredClone(options);
      const expectedResult: MailerSendResult = structuredClone(result);
      assert.deepEqual(await gated.send(message, options), expectedResult);
      assert.deepEqual(messages, [expectedMessage]);
      assert.deepEqual(sends, [expectedOptions]);
    }
  }
});

test("sendBatch gates notification delivery and forwards permitted batches and capabilities", async () => {
  const { mailer, sends, batches, capabilities } = fakeInnerMailer();
  let durableReady = false;
  const gated = wrapMailerWithPurposeGate({
    inner: mailer, mode: "production",
    durableOutboxReady: ({ capabilityName: capability }) => capability === "forms" && durableReady,
  });
  const messages = [FAKE_EMAIL, { ...FAKE_EMAIL, to: { email: "second@example.com" } }];
  const options: MailerSendOptions = {
    idempotencyKey: "batch-1", workspaceId: "ws-1",
    sourceContext: { module: "forms" }, lane: "notification",
  };
  assert.deepEqual(gated.capabilities(), capabilities);
  await assert.rejects(() => gated.sendBatch(messages, options), /capability "forms"/);
  assert.equal(batches.length, 0);
  assert.equal(sends.length, 0, "refused batches must not deliver individually either");

  const interactive = { ...options, lane: "interactive" as const };
  assert.deepEqual(await gated.sendBatch(messages, interactive), [SUCCESS, SUCCESS]);
  durableReady = true;
  assert.deepEqual(await gated.sendBatch(messages, options), [SUCCESS, SUCCESS]);
  assert.deepEqual(batches, [{ messages, options: interactive }, { messages, options }]);
  assert.equal(sends.length, 0, "permitted batches use the inner batch method");
});

// Moved from the host's extract-s3-host-source test (F5): the adapter keeps no unused port alias.
test("the positional gate source names no JiniMailerPort alias", () => {
  assert.doesNotMatch(readFileSync(new URL("../positional-purpose-gate.ts", import.meta.url), "utf8"), /JiniMailerPort/);
});
