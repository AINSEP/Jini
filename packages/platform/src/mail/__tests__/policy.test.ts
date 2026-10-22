import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { createMailDeliveryPolicy, createPolicyMailer, hasOneClickUnsubscribe, isMailRateLimited, laneForPurpose, MAIL_RATE_LIMITED, mailPayloadHash } from "../policy.js";
import type { MailCapturePort, MailDeliveryLane, MailerPort, MailSendLedgerPort, MailSuppressionRepoPort } from "../ports.js";
import type { MailerSendOptions, MailerSendResult, OutboundEmail } from "../types.js";

const MESSAGE: OutboundEmail = { workspaceId: "ws-1", to: { email: " Reader@Example.com " }, from: { email: "news@example.com" }, subject: "Hi", text: "body" };
const OPTIONS: MailerSendOptions = { idempotencyKey: "k1", workspaceId: "ws-1", sourceContext: { module: "test" } };
const BULK_HEADERS = { "List-Unsubscribe": "<https://x/u>", "list-unsubscribe-post": "List-Unsubscribe=One-Click" };
const OK: MailerSendResult = { ok: true, providerMessageId: "m-1", acceptedAt: "2026-10-21T00:00:00Z" };
const NOW = () => "2026-10-21T12:00:00Z";

type Row = { outcome: "reserved" | "sent" | "failed" | "unknown"; payloadHash: string; providerMessageId?: string };

function fakeLedger(seed: Record<string, Row> = {}) {
  const rows = new Map<string, Row>(Object.entries(seed));
  const marks: unknown[] = [];
  const ledger: MailSendLedgerPort = {
    async reserve({ idempotencyKey, recipient, payloadHash }, optional = {}) {
      const id = `${idempotencyKey}|${recipient}`;
      const row = rows.get(id);
      // Same statement as the real port: the read and the flip cannot interleave with another reserve.
      const reclaim = optional.reclaimUnknown === true && row?.outcome === "unknown" && row.payloadHash === payloadHash;
      if (row === undefined || row.outcome === "failed" || reclaim) { rows.set(id, { outcome: "reserved", payloadHash }); return { status: "reserved" }; }
      return { status: "existing", outcome: row.outcome, payloadHash: row.payloadHash, ...(row.providerMessageId ? { providerMessageId: row.providerMessageId } : {}) };
    },
    async mark(input) {
      marks.push(input);
      const id = `${input.idempotencyKey}|${input.recipient}`;
      rows.set(id, { ...rows.get(id)!, outcome: input.outcome, ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}) });
    },
  };
  return { ledger, rows, marks };
}

function fakeSuppression(blocked: { address: string; lanes: MailDeliveryLane[] }[] = []): MailSuppressionRepoPort {
  return {
    async isSuppressed({ normalizedAddress, lane }) { return blocked.some((b) => b.address === normalizedAddress && b.lanes.includes(lane)); },
    async suppress() { /* unused here */ },
  };
}

function build(optional: Parameters<typeof createMailDeliveryPolicy>[1] = {}, deps: Partial<Parameters<typeof createMailDeliveryPolicy>[0]> = {}) {
  const { ledger, rows, marks } = fakeLedger();
  const policy = createMailDeliveryPolicy({ providerId: "smtp", ledger, suppression: fakeSuppression(), supportsAttachments: true, ...deps }, { nowIso: NOW, ...optional });
  const sent: OutboundEmail[] = [];
  const send = async ({ message }: { message: OutboundEmail }) => { sent.push(message); return OK; };
  return { policy, rows, marks, sent, send };
}

describe("helpers", () => {
  test("lane: only purpose bulk is bulk", () => {
    assert.equal(laneForPurpose({ purpose: "bulk" }), "bulk");
    assert.equal(laneForPurpose({ purpose: "feature:forms" }), "transactional");
    assert.equal(laneForPurpose({ purpose: undefined }), "transactional");
  });
  test("one-click needs both headers, any case", () => {
    assert.equal(hasOneClickUnsubscribe({ headers: BULK_HEADERS }), true);
    assert.equal(hasOneClickUnsubscribe({ headers: { "List-Unsubscribe": "<x>" } }), false);
    assert.equal(hasOneClickUnsubscribe({ headers: undefined }), false);
  });
  test("rate limited: the shared code from the local bucket or a provider adapter, nothing else", () => {
    assert.equal(isMailRateLimited({ result: { ok: false, retryable: true, errorCode: MAIL_RATE_LIMITED, message: "429", retryAfterMs: 1000 } }), true);
    assert.equal(isMailRateLimited({ result: { ok: false, retryable: true, errorCode: "rate_limit_exceeded", message: "429" } }), false);
    assert.equal(isMailRateLimited({ result: OK }), false);
  });
  test("payload hash is stable and content-sensitive", () => {
    const withAll = { ...MESSAGE, html: "<p>x</p>", headers: { b: "2", a: "1" }, attachments: [{ filename: "a.txt", contentType: "text/plain", contentBase64: "" }] };
    assert.equal(mailPayloadHash({ message: withAll }), mailPayloadHash({ message: { ...withAll, headers: { a: "1", b: "2" } } }));
    assert.notEqual(mailPayloadHash({ message: MESSAGE }), mailPayloadHash({ message: { ...MESSAGE, subject: "Other" } }));
    const htmlOnly: OutboundEmail = { workspaceId: "ws-1", to: MESSAGE.to, from: MESSAGE.from, subject: "Hi", html: "<p>x</p>" };
    assert.notEqual(mailPayloadHash({ message: htmlOnly }), mailPayloadHash({ message: { ...htmlOnly, text: "x" } }));
  });
  test("payload hash covers the whole delivery: attachment bytes and types, reply-to, display names", () => {
    const attachment = { filename: "invoice.pdf", contentType: "application/pdf", contentBase64: "AAAA" };
    const base: OutboundEmail = { ...MESSAGE, from: { email: "news@example.com", name: "News" }, replyTo: { email: "help@example.com", name: "Help" }, attachments: [attachment] };
    const hash = mailPayloadHash({ message: base });
    const variants: OutboundEmail[] = [
      { ...base, attachments: [{ ...attachment, contentBase64: "BBBB" }] },
      { ...base, attachments: [{ ...attachment, contentType: "text/plain" }] },
      { ...base, replyTo: { email: "other@example.com", name: "Help" } },
      { ...base, replyTo: { email: "help@example.com", name: "Support" } },
      (({ replyTo: _replyTo, ...rest }) => rest)(base),
      { ...base, from: { email: "news@example.com", name: "Newsroom" } },
      { ...base, to: { email: MESSAGE.to.email, name: "Reader" } },
    ];
    for (const variant of variants) assert.notEqual(mailPayloadHash({ message: variant }), hash);
  });
  test("a reused key whose attachment contents changed is a conflict, not the earlier message's success", async () => {
    const { policy, sent, send } = build();
    const attachment = { filename: "a.txt", contentType: "text/plain", contentBase64: "b25l" };
    await policy.deliver({ message: { ...MESSAGE, attachments: [attachment] }, options: OPTIONS, send });
    const changed = await policy.deliver({ message: { ...MESSAGE, attachments: [{ ...attachment, contentBase64: "dHdv" }] }, options: OPTIONS, send });
    assert.equal(!changed.ok && changed.errorCode, "MAIL_IDEMPOTENCY_CONFLICT");
    assert.equal(sent.length, 1, "the changed message is never sent under the old key");
  });
});

describe("createMailDeliveryPolicy refusals (no ledger row)", () => {
  test("attachments refused when the provider cannot send them", async () => {
    const { policy, rows, send } = build({}, { supportsAttachments: false });
    const result = await policy.deliver({ message: { ...MESSAGE, attachments: [{ filename: "a", contentType: "x", contentBase64: "" }] }, options: OPTIONS, send });
    assert.deepEqual(result, { ok: false, retryable: false, errorCode: "MAIL_ATTACHMENTS_UNSUPPORTED", message: "provider smtp cannot send attachments" });
    assert.equal(rows.size, 0);
  });
  test("bulk without List-Unsubscribe-Post is refused", async () => {
    const { policy, sent, send } = build();
    const result = await policy.deliver({ message: MESSAGE, options: { ...OPTIONS, purpose: "bulk" }, send });
    assert.equal(!result.ok && result.errorCode, "MAIL_BULK_UNSUBSCRIBE_REQUIRED");
    assert.equal(sent.length, 0);
  });
  test("complaint suppression blocks bulk but not a transactional sign-in link", async () => {
    const suppression = fakeSuppression([{ address: "reader@example.com", lanes: ["bulk"] }]);
    const { policy, send, sent } = build({}, { suppression });
    const bulk = await policy.deliver({ message: { ...MESSAGE, headers: BULK_HEADERS }, options: { ...OPTIONS, purpose: "bulk" }, send });
    assert.equal(!bulk.ok && bulk.errorCode, "MAIL_RECIPIENT_SUPPRESSED");
    const login = await policy.deliver({ message: MESSAGE, options: { ...OPTIONS, purpose: "transactional" }, send });
    assert.equal(login.ok, true);
    assert.equal(sent.length, 1);
  });
  test("rate limited is retryable with a hint and leaves no row", async () => {
    const { policy, rows, send } = build({ limiter: { tryTake: () => ({ ok: false, retryAfterMs: 500 }) } });
    const result = await policy.deliver({ message: MESSAGE, options: OPTIONS, send });
    assert.deepEqual(result, { ok: false, retryable: true, errorCode: "MAIL_RATE_LIMITED", message: "transactional lane is rate limited", retryAfterMs: 500 });
    assert.equal(rows.size, 0);
  });
});

describe("reserve → send → mark", () => {
  test("first send reserves, sends with the lowered recipient key, marks sent", async () => {
    const { policy, marks, send, sent } = build({ limiter: { tryTake: () => ({ ok: true }) } });
    assert.deepEqual(await policy.deliver({ message: MESSAGE, options: OPTIONS, send }), OK);
    assert.equal(sent.length, 1);
    assert.deepEqual(marks, [{ workspaceId: "ws-1", idempotencyKey: "k1", recipient: "reader@example.com", outcome: "sent", providerMessageId: "m-1" }]);
  });
  test("a replay of a sent key returns ok without sending", async () => {
    const { policy, send, sent } = build();
    await policy.deliver({ message: MESSAGE, options: OPTIONS, send });
    const again = await policy.deliver({ message: MESSAGE, options: OPTIONS, send });
    assert.deepEqual(again, { ok: true, providerMessageId: "m-1", acceptedAt: NOW() });
    assert.equal(sent.length, 1);
  });
  test("a sent row without a message id replays with an empty id", async () => {
    const { ledger } = fakeLedger({ "k1|reader@example.com": { outcome: "sent", payloadHash: mailPayloadHash({ message: MESSAGE }) } });
    const policy = createMailDeliveryPolicy({ providerId: "smtp", ledger, suppression: fakeSuppression(), supportsAttachments: true });
    const result = await policy.deliver({ message: MESSAGE, options: OPTIONS, send: async () => OK });
    assert.equal(result.ok && result.providerMessageId, "");
  });
  test("same key, different content → idempotency conflict", async () => {
    const { policy, send } = build();
    await policy.deliver({ message: MESSAGE, options: OPTIONS, send });
    const result = await policy.deliver({ message: { ...MESSAGE, subject: "changed" }, options: OPTIONS, send });
    assert.equal(!result.ok && result.errorCode, "MAIL_IDEMPOTENCY_CONFLICT");
  });
  test("a thrown provider call is recorded unknown and reported unknown", async () => {
    const { policy, marks } = build();
    const result = await policy.deliver({ message: MESSAGE, options: OPTIONS, send: async () => { throw new Error("socket closed"); } });
    assert.deepEqual(result, { ok: false, retryable: false, errorCode: "MAIL_OUTCOME_UNKNOWN", message: "socket closed", unknown: true });
    assert.equal((marks[0] as { outcome: string }).outcome, "unknown");
    const nonError = await createMailDeliveryPolicy({ providerId: "p", ledger: fakeLedger().ledger, suppression: fakeSuppression(), supportsAttachments: true })
      .deliver({ message: MESSAGE, options: OPTIONS, send: async () => { throw "boom"; } });
    assert.equal(!nonError.ok && nonError.message, "boom");
  });
  test("unknown outcome: login links are never resent, confirmations are", async () => {
    const sendUnknown = async () => ({ ok: false as const, retryable: false, errorCode: "TIMEOUT", message: "t", unknown: true });
    const never = build({ resendPolicy: ({ purpose }) => (purpose === "feature:login" ? "never" : "on_unknown") });
    await never.policy.deliver({ message: MESSAGE, options: { ...OPTIONS, purpose: "feature:login" }, send: sendUnknown });
    const retry = await never.policy.deliver({ message: MESSAGE, options: { ...OPTIONS, purpose: "feature:login" }, send: never.send });
    assert.equal(!retry.ok && retry.errorCode, "MAIL_OUTCOME_UNKNOWN");
    assert.equal(never.sent.length, 0);
    const confirm = build();
    await confirm.policy.deliver({ message: MESSAGE, options: OPTIONS, send: sendUnknown });
    assert.deepEqual(await confirm.policy.deliver({ message: MESSAGE, options: OPTIONS, send: confirm.send }), OK);
    assert.equal(confirm.sent.length, 1);
  });
  test("two concurrent retries of an unknown outcome dispatch once: the first claims the row", async () => {
    const hash = mailPayloadHash({ message: MESSAGE });
    const { ledger, rows } = fakeLedger({ "k1|reader@example.com": { outcome: "unknown", payloadHash: hash } });
    const policy = createMailDeliveryPolicy({ providerId: "smtp", ledger, suppression: fakeSuppression(), supportsAttachments: true }, { nowIso: NOW });
    let calls = 0;
    let release: (result: MailerSendResult) => void = () => undefined;
    const blocked = () => { calls += 1; return new Promise<MailerSendResult>((resolve) => { release = resolve; }); };
    const first = policy.deliver({ message: MESSAGE, options: OPTIONS, send: blocked });
    const second = policy.deliver({ message: MESSAGE, options: OPTIONS, send: blocked });
    const secondResult = await second;
    assert.equal(!secondResult.ok && secondResult.errorCode, "MAIL_OUTCOME_UNKNOWN");
    release(OK);
    assert.deepEqual(await first, OK);
    assert.equal(calls, 1);
    assert.equal(rows.get("k1|reader@example.com")?.outcome, "sent");
  });
  test("an unknown row under a different payload is a conflict, never reclaimed", async () => {
    const { ledger } = fakeLedger({ "k1|reader@example.com": { outcome: "unknown", payloadHash: "other" } });
    const policy = createMailDeliveryPolicy({ providerId: "smtp", ledger, suppression: fakeSuppression(), supportsAttachments: true });
    const result = await policy.deliver({ message: MESSAGE, options: OPTIONS, send: async () => OK });
    assert.equal(!result.ok && result.errorCode, "MAIL_IDEMPOTENCY_CONFLICT");
  });
  test("a still-reserved row (crash or concurrent send) is unknown, not resent", async () => {
    const { ledger } = fakeLedger({ "k1|reader@example.com": { outcome: "reserved", payloadHash: mailPayloadHash({ message: MESSAGE }) } });
    const policy = createMailDeliveryPolicy({ providerId: "smtp", ledger, suppression: fakeSuppression(), supportsAttachments: true });
    const result = await policy.deliver({ message: MESSAGE, options: OPTIONS, send: async () => OK });
    assert.equal(!result.ok && result.unknown, true);
  });
  test("a definitive failure is marked failed and may be retried", async () => {
    const { policy, marks, send, sent } = build();
    const fail = async () => ({ ok: false as const, retryable: true, errorCode: "SMTP_451", message: "later" });
    await policy.deliver({ message: MESSAGE, options: OPTIONS, send: fail });
    assert.deepEqual(marks[0], { workspaceId: "ws-1", idempotencyKey: "k1", recipient: "reader@example.com", outcome: "failed", errorCode: "SMTP_451" });
    assert.deepEqual(await policy.deliver({ message: MESSAGE, options: OPTIONS, send }), OK);
    assert.equal(sent.length, 1);
  });
});

describe("test mode", () => {
  test("redirect rewrites the recipient and keeps the original in a header", async () => {
    const { policy, sent, send } = build({ testMode: { kind: "redirect", to: { email: "owner@example.com" } } });
    await policy.deliver({ message: MESSAGE, options: OPTIONS, send });
    assert.equal(sent[0]!.to.email, "owner@example.com");
    assert.equal(sent[0]!.headers!["X-Original-To"], " Reader@Example.com ");
  });
  test("capture stores and sends nothing", async () => {
    const captured: unknown[] = [];
    const sink: MailCapturePort = { async capture(input) { captured.push(input); return { id: "c1" }; } };
    const { policy, sent, send, rows } = build({ testMode: { kind: "capture", sink } });
    const result = await policy.deliver({ message: MESSAGE, options: OPTIONS, send });
    assert.deepEqual(result, { ok: true, providerMessageId: "captured:c1", acceptedAt: NOW() });
    assert.equal(sent.length, 0);
    assert.equal(rows.size, 0);
    assert.deepEqual(captured, [{ message: MESSAGE, lane: "transactional", idempotencyKey: "k1" }]);
  });
  test("default clock is used when none is injected", async () => {
    const sink: MailCapturePort = { async capture() { return { id: "c" }; } };
    const policy = createMailDeliveryPolicy({ providerId: "smtp", ledger: fakeLedger().ledger, suppression: fakeSuppression(), supportsAttachments: true }, { testMode: { kind: "capture", sink } });
    const result = await policy.deliver({ message: MESSAGE, options: OPTIONS, send: async () => OK });
    assert.match(result.ok ? result.acceptedAt : "", /^\d{4}-/);
  });
});

describe("createPolicyMailer", () => {
  function inner(): { port: MailerPort; calls: unknown[] } {
    const calls: unknown[] = [];
    return {
      calls,
      port: {
        capabilities: () => ({ driver: "fake", supportsIdempotencyKey: false, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: true }),
        async send(input, optional) { calls.push({ input, optional }); return OK; },
        async sendBatch() { throw new Error("policy must not batch"); },
      },
    };
  }
  test("send and sendBatch go recipient by recipient through the policy", async () => {
    const { port, calls } = inner();
    const mailer = createPolicyMailer({ inner: port, policy: build().policy });
    assert.equal(mailer.capabilities({}).driver, "fake");
    assert.deepEqual(await mailer.send({ ...OPTIONS, message: MESSAGE }), OK);
    const results = await mailer.sendBatch({ ...OPTIONS, idempotencyKey: "k2", messages: [MESSAGE, { ...MESSAGE, to: { email: "b@example.com" } }] }, { purpose: "transactional" });
    assert.deepEqual(results, [OK, OK]);
    assert.equal(calls.length, 3);
    assert.deepEqual((calls[2] as { optional: unknown }).optional, { purpose: "transactional" });
  });
  test("defaults optional to {} for single and batch sends", async () => {
    const { port, calls } = inner();
    const mailer = createPolicyMailer({ inner: port, policy: build().policy });
    await mailer.sendBatch({ ...OPTIONS, messages: [MESSAGE] });
    assert.deepEqual((calls[0] as { optional: unknown }).optional, {});
  });
});
