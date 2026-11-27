import assert from "node:assert/strict";
import { test } from "vitest";
import type { PositionalMailer as MailerPort, MailerSendResult } from "@jini-ai/core/contracts/mail";
import { SenderIdentityNotConfiguredError } from "../sender-identity.js";
import {
  createMailTestSendLimiter, planMailTestSend, readTestRecipient, runMailTestSend,
  TEST_SEND_BURST, TEST_SEND_DUPLICATE_MS, TEST_SEND_REFILL_MS, type MailTestSendDeps, type MailTestSendPlan,
} from "../test-send.js";

/**
 * @file The shared test-send operation (`test-send.ts`) behind `mail_send_test` and the admin
 * mail-test-send route: recipient rules, the truthful outcome mapping, the limiter, and the tool's
 * chosen recipient and test-mode card details. All ports are in-memory fakes.
 */

const OWNER = { principalId: "owner", workspaceId: "ws", username: "owner", email: "owner@example.com", passwordHash: "x", version: 1 };
const T0 = Date.parse("2026-10-22T10:00:00.000Z");
const ok = (providerMessageId = "pm-1"): MailerSendResult => ({ ok: true, providerMessageId, acceptedAt: "2026-10-22T10:00:00.000Z" });

function mailerWith(result: MailerSendResult, driver = "smtp"): MailerPort & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    capabilities: () => ({ driver, supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
    send: async (message, options) => { sent.push({ message, options }); return result; },
    sendBatch: async () => [],
  };
}

// `undefined` overrides model a host that leaves a port out (exactOptionalPropertyTypes).
function depsWith(overrides: { [K in keyof MailTestSendDeps]?: MailTestSendDeps[K] | undefined } = {}): MailTestSendDeps {
  return <MailTestSendDeps>{
    workspaceId: "ws", mailer: mailerWith(ok()),
    userRepo: { findByPrincipalId: async () => OWNER },
    mailSenderIdentity: { resolve: async () => ({ email: "site@example.com", name: "Site" }) },
    ...overrides,
  };
}

const plan = (overrides: Partial<MailTestSendPlan> = {}): MailTestSendPlan => ({ to: "owner@example.com", chosen: false, driver: "smtp", ...overrides, approval: { providerId: null, driver: overrides.driver ?? "smtp", from: { email: "site@example.com", name: "Site" }, mode: overrides.capture ? "capture" : overrides.redirectTo ? "redirect" : "off", effectiveRecipient: overrides.redirectTo ?? overrides.to ?? "owner@example.com" } });

test("readTestRecipient: absent stays absent, one plain address is trimmed, anything else is refused", () => {
  assert.equal(readTestRecipient({ value: undefined }), undefined);
  assert.equal(readTestRecipient({ value: "  ops@example.com " }), "ops@example.com");
  for (const bad of ["", "   ", 3, null, "no-at-sign", "a@b", "Ops <ops@example.com>", "a@example.com, b@example.com", `${"a".repeat(250)}@example.com`]) {
    assert.throws(() => readTestRecipient({ value: bad }), { name: "ToolInputError", message: /^to must be one email address/ }, String(bad));
  }
});

test("planMailTestSend: the operator's own address by default, a username address next, a chosen one as given", async () => {
  assert.deepEqual(await planMailTestSend({ ...{ principalId: "owner" }, deps: depsWith() }), plan());
  const byUsername = depsWith({ userRepo: { findByPrincipalId: async () => ({ ...OWNER, email: undefined, username: "ops@example.com" }) } });
  assert.equal((await planMailTestSend({ ...{ principalId: "owner" }, deps: byUsername })).to, "ops@example.com");
  const none = depsWith({ userRepo: { findByPrincipalId: async () => null } });
  assert.deepEqual(await planMailTestSend({ ...{ principalId: "owner", to: "x@example.com" }, deps: none }), plan({ to: "x@example.com", chosen: true }));
  await assert.rejects(planMailTestSend({ ...{ principalId: "owner" }, deps: none }), /Enter a recipient/);
  await assert.rejects(planMailTestSend({ ...{ principalId: "owner" }, deps: depsWith({ userRepo: undefined }) }), /no email address/);
});

test("planMailTestSend: test mode is read so the plan names a redirect or a capture", async () => {
  assert.equal((await planMailTestSend({ ...{ principalId: "owner" }, deps: depsWith({ mailTestMode: async () => ({ mode: "redirect", to: "qa@example.com" }) }) })).redirectTo, "qa@example.com");
  assert.deepEqual(await planMailTestSend({ ...{ principalId: "owner" }, deps: depsWith({ mailTestMode: async () => ({ mode: "capture" }) }) }), plan({ capture: true }));
  assert.deepEqual(await planMailTestSend({ ...{ principalId: "owner" }, deps: depsWith({ mailTestMode: async () => ({ mode: "off" }) }) }), plan());
});

test("runMailTestSend: accepted carries the provider's message id and the send keeps its lane and idempotency key", async () => {
  const mailer = mailerWith(ok());
  const result = await runMailTestSend({ ...{ principalId: "owner", plan: plan(), ref: "req-1" }, deps: depsWith({ mailer }) }, { now: () => T0 });
  assert.deepEqual(result, { to: "owner@example.com", from: "site@example.com", driver: "smtp", at: "2026-10-22T10:00:00.000Z", outcome: "accepted", providerMessageId: "pm-1" });
  assert.deepEqual((mailer.sent[0] as { options: unknown }).options, { mailTestApproval: plan().approval, idempotencyKey: "mail:test:owner:req-1", workspaceId: "ws", sourceContext: { module: "mail", ref: "req-1" }, purpose: "transactional", lane: "interactive" });
});

test("runMailTestSend: a refusal uses fixed code-specific copy and keeps retryability and retry hint", async () => {
  const throttled = mailerWith({ ok: false, retryable: true, errorCode: "MAIL_RATE_LIMITED", message: "slow down", retryAfterMs: 900 });
  assert.deepEqual(await runMailTestSend({ ...{ principalId: "owner", plan: plan(), ref: "r" }, deps: depsWith({ mailer: throttled }) }, { now: () => T0 }),
    { to: "owner@example.com", from: "site@example.com", driver: "smtp", at: "2026-10-22T10:00:00.000Z", outcome: "failed", errorCode: "MAIL_RATE_LIMITED", message: "The mail delivery rate limit was reached. Try again later.", retryable: true, retryAfterMs: 900 });
  const suppressed = mailerWith({ ok: false, retryable: false, errorCode: "MAIL_SUPPRESSED", message: "recipient is suppressed" });
  const result = await runMailTestSend({ ...{ principalId: "owner", plan: plan(), ref: "r" }, deps: depsWith({ mailer: suppressed }) });
  assert.equal(result.outcome, "failed");
  assert.equal("retryAfterMs" in result, false);
  assert.match(result.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("runMailTestSend: the local limiter refuses a duplicate click and a drained bucket before any send", async () => {
  const mailer = mailerWith(ok());
  const limiter = { tryTake: () => ({ ok: false as const, reason: "duplicate" as const, retryAfterMs: 5 }) };
  assert.deepEqual(await runMailTestSend({ ...{ principalId: "owner", plan: plan(), ref: "r" }, deps: depsWith({ mailer, mailTestSendLimiter: limiter }) }, { now: () => T0 }),
    { to: "owner@example.com", from: "site@example.com", driver: "smtp", at: "2026-10-22T10:00:00.000Z", outcome: "failed", errorCode: "MAIL_TEST_DUPLICATE", message: "A test email to this address was just sent; wait a moment before sending another.", retryable: true, retryAfterMs: 5 });
  const drained = { tryTake: () => ({ ok: false as const, reason: "rate_limited" as const, retryAfterMs: 7 }) };
  const result = await runMailTestSend({ ...{ principalId: "owner", plan: plan(), ref: "r" }, deps: depsWith({ mailer, mailTestSendLimiter: drained }) });
  assert.equal(result.outcome === "failed" && result.errorCode, "MAIL_TEST_RATE_LIMITED");
  assert.equal(mailer.sent.length, 0);
  // The limiter keys on the lower-cased recipient, so case changes are the same click.
  const keys: string[] = [];
  await runMailTestSend({ ...{ principalId: "owner", plan: plan({ to: "Owner@Example.com" }), ref: "r" }, deps: depsWith({ mailTestSendLimiter: { tryTake: ({ to }) => { keys.push(to); return { ok: true }; } } }) });
  assert.deepEqual(keys, ["owner@example.com"]);
});

test("createMailTestSendLimiter: a second click inside the window is a duplicate; it expires; another recipient is not one", () => {
  let now = T0;
  const limiter = createMailTestSendLimiter({}, { now: () => now });
  assert.deepEqual(limiter.tryTake({ principalId: "p", to: "a@x.co" }), { ok: true });
  now += 1_000;
  assert.deepEqual(limiter.tryTake({ principalId: "p", to: "a@x.co" }), { ok: false, reason: "duplicate", retryAfterMs: TEST_SEND_DUPLICATE_MS - 1_000 });
  assert.deepEqual(limiter.tryTake({ principalId: "p", to: "b@x.co" }), { ok: true });
  now += TEST_SEND_DUPLICATE_MS;
  assert.deepEqual(limiter.tryTake({ principalId: "p", to: "a@x.co" }), { ok: true });
});

test("createMailTestSendLimiter: the burst drains, then one token returns per refill interval", () => {
  let now = T0;
  const limiter = createMailTestSendLimiter({}, { now: () => now });
  for (let index = 0; index < TEST_SEND_BURST; index += 1) assert.deepEqual(limiter.tryTake({ principalId: "p", to: `r${index}@x.co` }), { ok: true });
  assert.deepEqual(limiter.tryTake({ principalId: "p", to: "late@x.co" }), { ok: false, reason: "rate_limited", retryAfterMs: TEST_SEND_REFILL_MS });
  now += TEST_SEND_REFILL_MS / 2;
  assert.deepEqual(limiter.tryTake({ principalId: "p", to: "late@x.co" }), { ok: false, reason: "rate_limited", retryAfterMs: TEST_SEND_REFILL_MS / 2 });
  now += TEST_SEND_REFILL_MS / 2;
  assert.deepEqual(limiter.tryTake({ principalId: "p", to: "late@x.co" }), { ok: true });
  const small = createMailTestSendLimiter({}, { now: () => now, burst: 1, refillMs: 10, duplicateMs: 1 });
  assert.deepEqual(small.tryTake({ principalId: "p", to: "a@x.co" }), { ok: true });
  assert.equal(small.tryTake({ principalId: "p", to: "b@x.co" }).ok, false);
  assert.equal(createMailTestSendLimiter().tryTake({ principalId: "p", to: "a@x.co" }).ok, true);
});

test("a console transport reports local capture rather than external acceptance", async () => {
  const deps = depsWith({ mailer: mailerWith(ok("console-1"), "console") });
  const prepared = await planMailTestSend({ deps, principalId: "owner" });
  const result = await runMailTestSend({ deps, principalId: "owner", plan: prepared, ref: "console" });
  assert.deepEqual([result.outcome, "where" in result && result.where], ["captured", "console"]);
});


test("test-send planning settles the current lane before freezing driver and sender", async () => {
  let driver = "console"; const base = mailerWith(ok());
  const deps = depsWith({ mailer: { ...base, capabilities: () => ({ ...base.capabilities(), driver }) }, mailLaneReady: async ({ lane }) => { assert.equal(lane, "transactional"); driver = "smtp"; return true; } });
  const prepared = await planMailTestSend({ deps, principalId: "owner" });
  assert.equal(prepared.driver, "smtp"); assert.equal(prepared.approval.driver, "smtp");
  assert.equal((await runMailTestSend({ deps, principalId: "owner", plan: prepared, ref: "after-boot" })).outcome, "accepted");
});

test("planMailTestSend: without a composed sender identity, a delivering mailer refuses and a console one uses the placeholder", async () => {
  const smtp = depsWith({ mailSenderIdentity: undefined });
  await assert.rejects(planMailTestSend({ deps: smtp, principalId: "owner" }), SenderIdentityNotConfiguredError);
  const local = depsWith({ mailSenderIdentity: undefined, mailer: mailerWith(ok(), "console") });
  assert.deepEqual((await planMailTestSend({ deps: local, principalId: "owner" })).approval.from, { email: "no-reply@mail.local", name: "Site" });
});

test("planMailTestSend: the host's placeholder sender is the fallback handed to the identity resolver", async () => {
  const fallbacks: unknown[] = [];
  const deps = depsWith({
    mailTestFallbackSender: { email: "no-reply@mail.local", name: "Host" },
    mailSenderIdentity: { resolve: async ({ fallback }) => { fallbacks.push(fallback); return fallback; } },
  });
  assert.deepEqual((await planMailTestSend({ deps, principalId: "owner" })).approval.from, { email: "no-reply@mail.local", name: "Host" });
  assert.deepEqual(fallbacks, [{ email: "no-reply@mail.local", name: "Host" }]);
});

test.each([
  { mode: { mode: "capture" } as const, messageId: "captured:local-1",
    outcome: { outcome: "captured", where: "capture", providerMessageId: "captured:local-1" } },
  { mode: { mode: "redirect", to: "qa@example.com" } as const, messageId: "smtp-1",
    outcome: { outcome: "redirected", redirectedTo: "qa@example.com", providerMessageId: "smtp-1" } },
])("reports $mode.mode without calling it ordinary acceptance", async ({ mode, messageId, outcome }) => {
  const mailer = mailerWith(ok(messageId));
  const deps = depsWith({ mailer, mailTestMode: async () => mode });
  const prepared = await planMailTestSend({ deps, principalId: "owner" });
  assert.deepEqual(await runMailTestSend({ deps, principalId: "owner", plan: prepared, ref: "mode-test" }, { now: () => T0 }),
    { to: "owner@example.com", from: "site@example.com", driver: "smtp", at: "2026-10-22T10:00:00.000Z", ...outcome });
  const [sent] = mailer.sent as Array<{ options: { mailTestApproval: MailTestSendPlan["approval"] } }>;
  assert.deepEqual(sent?.options.mailTestApproval, { providerId: null, driver: "smtp", from: { email: "site@example.com", name: "Site" },
    mode: mode.mode, effectiveRecipient: mode.mode === "redirect" ? "qa@example.com" : "owner@example.com" });
});

test("an approval that no longer matches the provider refuses delivery and a freshly prepared retry can send", async () => {
  let provider = "first";
  const mailer = mailerWith(ok());
  const limiterCalls: unknown[] = [];
  const deps = depsWith({ mailer, mailTestRequests: new Map(), mailTestProvider: async () => provider,
    mailTestSendLimiter: { tryTake: required => { limiterCalls.push(required); return { ok: true }; } } });
  const input = { deps, principalId: "owner", ref: "same-request" };
  const stale = await planMailTestSend(input);
  provider = "second";
  await assert.rejects(runMailTestSend({ ...input, plan: stale }), {
    name: "ToolInputError", message: "Mail configuration changed since approval. Prepare a new test-send approval; nothing was sent.",
  });
  assert.deepEqual(mailer.sent, []);
  assert.deepEqual(limiterCalls, []);
  const fresh = await planMailTestSend(input);
  const sent = await runMailTestSend({ ...input, plan: fresh }, { now: () => T0 });
  assert.deepEqual(await runMailTestSend({ ...input, plan: fresh }), sent);
  assert.equal(sent.outcome, "accepted");
  assert.equal(mailer.sent.length, 1);
  assert.deepEqual(limiterCalls, [{ principalId: "owner", to: "owner@example.com" }]);
});

test("the full request cache drops the oldest outcome but retains replay of newer requests", async () => {
  const mailer = mailerWith(ok());
  const completed = Promise.resolve({ to: "owner@example.com", from: "site@example.com", driver: "smtp", at: "2026-10-22T10:00:00.000Z",
    outcome: "accepted", providerMessageId: "earlier" } as const);
  const requests = new Map<string, ReturnType<typeof runMailTestSend>>();
  for (let i = 0; i < 4096; i++) requests.set(`owner:ref-${i}`, completed);
  const deps = depsWith({ mailer, mailTestRequests: requests });
  const input = { deps, principalId: "owner", plan: plan() };
  const sent = await runMailTestSend({ ...input, ref: "newest" }, { now: () => T0 });
  assert.equal(requests.size, 4096);
  assert.equal(requests.has("owner:ref-0"), false);
  assert.deepEqual(await runMailTestSend({ ...input, ref: "ref-1" }), await completed);
  assert.deepEqual(await runMailTestSend({ ...input, ref: "newest" }), sent);
  assert.equal(mailer.sent.length, 1);
});

test("an uncertain provider outcome is not retryable and exposes only fixed recovery copy", async () => {
  const mailer = mailerWith({ ok: false, unknown: true, retryable: true, errorCode: "MAIL_PROVIDER_UNAVAILABLE",
    message: "Untrusted provider diagnostic", retryAfterMs: 750 });
  const deps = depsWith({ mailer });
  assert.deepEqual(await runMailTestSend({ deps, principalId: "owner", plan: plan(), ref: "uncertain" }, { now: () => T0 }), {
    to: "owner@example.com", from: "site@example.com", driver: "smtp", at: "2026-10-22T10:00:00.000Z",
    outcome: "unknown", errorCode: "MAIL_PROVIDER_UNAVAILABLE", message: "The configured mail provider is unavailable. Check its configuration.",
    retryable: false, retryAfterMs: 750,
  });
});
