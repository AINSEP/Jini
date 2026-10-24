import assert from "node:assert/strict";
import { test } from "vitest";
import { createMailPolicyWrapper, type MailPolicyWrapperDeps, type MailPolicyWrapperOptions } from "../delivery-wrapper.js";
import type { MailerPort, MailSendLedgerPort, MailSuppressionRepoPort } from "../ports.js";
import type { MailProviderModule } from "../provider.js";
import type { MailerSendOptions, MailerSendResult, MailTestApproval, MailTestModeSetting, OutboundEmail } from "../types.js";

const MESSAGE: OutboundEmail = { workspaceId: "ws-1", to: { email: "Reader@Example.com" }, from: { email: "news@example.com" }, subject: "hi", text: "hi" };
const DELIVERY = { idempotencyKey: "k1", workspaceId: "ws-1", sourceContext: { module: "fixture" } };
const OK: MailerSendResult = { ok: true, providerMessageId: "pm-1", acceptedAt: "2026-10-21T00:00:00.000Z" };

function provider(rateLimit?: { perSecond: number; burst: number }): MailProviderModule {
  return { id: "fixture", label: "Fixture", credentialKeys: [], capabilities: { hosted: true, feedback: false, domainVerification: false, ...(rateLimit ? { rateLimit } : {}) }, create: () => { throw new Error("unused"); } };
}

function fixture(deps: Partial<MailPolicyWrapperDeps> = {}, optional: MailPolicyWrapperOptions = {}) {
  const events: string[] = [];
  const calls: { message: OutboundEmail; options: MailerSendOptions }[] = [];
  const ledger: MailSendLedgerPort = {
    async reserve(input) {
      events.push(`reserve:${input.idempotencyKey}`);
      return { status: "reserved" };
    },
    async mark(input) {
      events.push(`mark:${input.idempotencyKey}`);
    },
  };
  const suppression: MailSuppressionRepoPort = {
    isSuppressed: async () => { events.push("suppression"); return false; },
    suppress: async () => {},
  };
  const inner: MailerPort = {
    capabilities: () => ({ driver: "fixture", supportsIdempotencyKey: false, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
    async send({ message, ...delivery }, options = {}) {
      calls.push({ message, options: { ...delivery, ...options } });
      events.push(`send:${delivery.idempotencyKey}`);
      return OK;
    },
    async sendBatch() { throw new Error("policy must never forward batches"); },
  };
  const wrap = createMailPolicyWrapper({
    ledger, suppression,
    readTestMode: async () => { events.push("read"); return { mode: "off" }; },
    resendPolicy: () => "on_unknown",
    observe: async () => { events.push("observe"); },
    ...deps,
  }, optional);
  return { events, calls, inner, wrap, mailer: wrap({ providerId: "fixture", provider: provider(), mailer: inner }) };
}

test("fresh settings, suppression, reservation, provider, mark and observation retain await order", async () => {
  const f = fixture();
  assert.strictEqual(await f.mailer.send({ message: MESSAGE, ...DELIVERY }), OK);
  assert.deepEqual(f.calls, [{ message: MESSAGE, options: DELIVERY }]);
  assert.deepEqual(f.events, ["read", "suppression", "reserve:k1", "send:k1", "mark:k1", "observe"]);
  assert.deepEqual(f.mailer.capabilities({}), f.inner.capabilities({}));
});

test("test mode is read again for each recipient and redirect preserves original headers", async () => {
  let mode: MailTestModeSetting = { mode: "off" };
  const f = fixture({ readTestMode: async () => mode });
  await f.mailer.send({ message: MESSAGE, ...DELIVERY });
  mode = { mode: "redirect", to: "owner@example.com" };
  await f.mailer.send({ message: MESSAGE, ...DELIVERY, idempotencyKey: "next" }, { timeoutMs: 1234 });
  assert.equal(f.calls[0]!.message.to.email, "Reader@Example.com");
  assert.equal(f.calls[1]!.message.to.email, "owner@example.com");
  assert.equal(f.calls[1]!.message.headers?.["X-Original-To"], "Reader@Example.com");
  assert.equal(f.calls[1]!.options.timeoutMs, 1234);
});

test("capture without a sink returns exact refusal before policy or observation", async () => {
  const f = fixture({ readTestMode: async () => ({ mode: "capture" }) });
  assert.deepEqual(await f.mailer.send({ message: MESSAGE, ...DELIVERY }), {
    ok: false, retryable: false, errorCode: "MAIL_TEST_CAPTURE_UNAVAILABLE",
    message: "mail test mode is set to capture, but no capture store is available; nothing was sent",
  });
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.calls, []);
});

test("capture with a sink stores without dispatch and observes the captured outcome", async () => {
  const captured: OutboundEmail[] = [];
  const observed: MailerSendResult[] = [];
  const f = fixture({ readTestMode: async () => ({ mode: "capture" }), observe: async ({ result }) => { observed.push(result); } }, {
    capture: { capture: async ({ message }) => { captured.push(message); return { id: "c1" }; } },
  });
  const result = await f.mailer.send({ message: MESSAGE, ...DELIVERY });
  assert.equal(result.ok && result.providerMessageId, "captured:c1");
  assert.deepEqual(captured, [MESSAGE]);
  assert.deepEqual(f.calls, []);
  assert.strictEqual(observed[0], result);
});

const APPROVAL: MailTestApproval = { providerId: "fixture", driver: "fixture", from: MESSAGE.from, mode: "off", effectiveRecipient: MESSAGE.to.email };

test("approval drift returns exact refusal before policy and observation", async () => {
  const variants: MailTestApproval[] = [
    { ...APPROVAL, providerId: "changed" }, { ...APPROVAL, driver: "changed" },
    { ...APPROVAL, from: { email: "changed@example.com" } }, { ...APPROVAL, mode: "capture" },
    { ...APPROVAL, effectiveRecipient: "changed@example.com" },
  ];
  for (const mailTestApproval of variants) {
    const f = fixture();
    assert.deepEqual(await f.mailer.send({ message: MESSAGE, ...DELIVERY }, { mailTestApproval }), {
      ok: false, retryable: false, errorCode: "MAIL_TEST_APPROVAL_CHANGED",
      message: "Mail configuration changed. Prepare a new approval; nothing was sent.",
    });
    assert.deepEqual(f.events, ["read"]);
    assert.deepEqual(f.calls, []);
  }
});

test("matching and null-provider approvals pass; approval property order remains significant", async () => {
  for (const providerId of ["fixture", null]) {
    const f = fixture();
    assert.strictEqual(await f.mailer.send({ message: MESSAGE, ...DELIVERY }, { mailTestApproval: { ...APPROVAL, providerId } }), OK);
  }
  const { providerId, ...rest } = APPROVAL;
  const f = fixture();
  const result = await f.mailer.send({ message: MESSAGE, ...DELIVERY }, { mailTestApproval: { ...rest, providerId } });
  assert.equal(!result.ok && result.errorCode, "MAIL_TEST_APPROVAL_CHANGED");
});

test("a batch preserves mixed results, indexed keys and per-recipient settings/observation order", async () => {
  const f = fixture();
  let sent = 0;
  const failure: MailerSendResult = { ok: false, retryable: false, errorCode: "REFUSED", message: "refused" };
  const inner: MailerPort = { ...f.inner, async send(input, optional) { await f.inner.send(input, optional); return sent++ === 1 ? failure : OK; } };
  const mailer = f.wrap({ providerId: "fixture", provider: provider(), mailer: inner });
  assert.deepEqual(await mailer.sendBatch({ messages: [MESSAGE, MESSAGE, MESSAGE], ...DELIVERY }), [OK, failure, OK]);
  assert.deepEqual(f.calls.map(call => call.options.idempotencyKey), ["k1:0", "k1:1", "k1:2"]);
  assert.deepEqual(f.events, [0, 1, 2].flatMap(index => ["read", "suppression", `reserve:k1:${index}`, `send:k1:${index}`, `mark:k1:${index}`, "observe"]));
});

test("provider limiter lifetime is shared between wrapped instances, but isolated by provider id", async () => {
  const f = fixture({}, { now: () => 0 });
  const limited = provider({ perSecond: 1, burst: 1 });
  const first = f.wrap({ providerId: "fixture", provider: limited, mailer: f.inner });
  const second = f.wrap({ providerId: "fixture", provider: limited, mailer: f.inner });
  assert.strictEqual(await first.send({ message: MESSAGE, ...DELIVERY }), OK);
  const result = await second.send({ message: MESSAGE, ...DELIVERY, idempotencyKey: "next" });
  assert.deepEqual(result, { ok: false, retryable: true, errorCode: "MAIL_RATE_LIMITED", message: "transactional lane is rate limited", retryAfterMs: 1000 });
  const third = f.wrap({ providerId: "other", provider: limited, mailer: f.inner });
  assert.strictEqual(await third.send({ message: MESSAGE, ...DELIVERY, idempotencyKey: "third" }), OK);
});

test("injected resend policy controls reclaimUnknown and sees complete delivery options", async () => {
  for (const resendPolicy of ["never", "on_unknown"] as const) {
    const received: MailerSendOptions[] = [];
    const reclaim: boolean[] = [];
    const f = fixture({
      resendPolicy: ({ options }) => { received.push(options); return resendPolicy; },
      ledger: { reserve: async (_required, optional) => { reclaim.push(optional!.reclaimUnknown!); return { status: "reserved" }; }, mark: async () => {} },
    });
    await f.mailer.send({ message: MESSAGE, ...DELIVERY }, { purpose: "transactional", lane: "interactive" });
    assert.deepEqual(received, [{ ...DELIVERY, purpose: "transactional", lane: "interactive" }]);
    assert.deepEqual(reclaim, [resendPolicy === "on_unknown"]);
  }
});

test("observer and logger faults preserve result identity and never abort a batch; warn once per factory", async () => {
  const lines: string[] = [];
  const observed: MailerSendResult[] = [];
  const f = fixture({ observe: async ({ result }) => { observed.push(result); throw new Error("token=secret"); } }, {
    warn: line => { lines.push(line); throw new Error("logger fault"); },
  });
  assert.strictEqual(await f.mailer.send({ message: MESSAGE, ...DELIVERY }), OK);
  const second = f.wrap({ providerId: "other", provider: provider(), mailer: f.inner });
  const results = await second.sendBatch({ messages: [MESSAGE, MESSAGE], ...DELIVERY });
  assert.deepEqual(results, [OK, OK]);
  assert.equal(observed.length, 3);
  assert.ok(observed.every(result => result === OK));
  assert.deepEqual(lines, ["[mail] activity observation failed"]);
});

test("settings and ledger faults propagate without observation or subsequent batch delivery", async () => {
  const error = new Error("storage unavailable");
  const readFailure = fixture({ readTestMode: async () => { throw error; } });
  await assert.rejects(readFailure.mailer.send({ message: MESSAGE, ...DELIVERY }), err => err === error);
  assert.deepEqual(readFailure.events, []);
  const f = fixture({ ledger: { reserve: async () => { throw error; }, mark: async () => {} } });
  await assert.rejects(f.mailer.sendBatch({ messages: [MESSAGE, MESSAGE], ...DELIVERY }), err => err === error);
  assert.deepEqual(f.events, ["read", "suppression"]);
  assert.deepEqual(f.calls, []);
});
