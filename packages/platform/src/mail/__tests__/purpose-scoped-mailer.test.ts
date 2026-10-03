import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { wrapMailerWithPurposeGate } from "../purpose-scoped-mailer.js";
import type { MailerPort, OutboundEmail, MailerSendOptions, MailerSendResult } from "../ports.js";
/**
 * @file the purpose-scoped mailer seam gate
 *
 * This security-critical unit gives unknown lane values the restrictive gate; the adversarial "unrecognized lane value" cases below are the
 * load-bearing tests here, written and prioritized before the happy-path cases, per the
 * Implementation Outline's TDD focus note. This exact class of bug (two call sites silently
 * converging on the same untyped `purpose: "transactional"` value) was independently
 * verified in this codebase before this spec existed — these tests exist because of that
 * finding, not hypothetically.
 * See docs/decisions/DR-001-purpose-scoped-mail.md.
 */
const FAKE_EMAIL: OutboundEmail = {
    workspaceId: "ws-1",
    to: { email: "someone@example.com" },
    from: { email: "no-reply@example.com" },
    subject: "test",
    text: "test body",
};
const SUCCESS: MailerSendResult = { ok: true, providerMessageId: "msg-1", acceptedAt: "2026-09-30T00:00:00Z" };
function fakeInnerMailer(result: MailerSendResult = SUCCESS): {
    mailer: MailerPort;
    sends: MailerSendOptions[];
    messages: OutboundEmail[];
    batches: {
        messages: readonly OutboundEmail[];
        options: MailerSendOptions;
    }[];
    capabilities: ReturnType<MailerPort["capabilities"]>;
} {
    const sends: MailerSendOptions[] = [];
    const messages: OutboundEmail[] = [];
    const batches: {
        messages: readonly OutboundEmail[];
        options: MailerSendOptions;
    }[] = [];
    const capabilities = {
        driver: "memory", supportsIdempotencyKey: true, supportsWebhookFeedback: false,
        maxBatchSize: 10, supportsAttachments: true,
    };
    const mailer: MailerPort = {
        async send({ message, ...required }, optional = {}) {
            const options = { ...required, ...optional };
            messages.push(structuredClone(message));
            sends.push(structuredClone(options));
            return result;
        },
        async sendBatch({ messages, ...required }, optional = {}) {
            const options = { ...required, ...optional };
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
        readiness: { isReady: () => durableReady },
    });
    // Simulates a future third call site with a discriminator value nobody anticipated.
    await assert.rejects(() => gated.send(sendInput(FAKE_EMAIL, {
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "future-feature" },
        // Deliberately invalid runtime discriminator — deliberately an unrecognized value to prove fail-closed behavior
        lane: "some-brand-new-value-nobody-mapped",
    } as unknown as MailerSendOptions), sendOptions({
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "future-feature" },
        // Deliberately invalid runtime discriminator — deliberately an unrecognized value to prove fail-closed behavior
        lane: "some-brand-new-value-nobody-mapped",
    } as unknown as MailerSendOptions)), /MAILER_SEND_REFUSED_NO_DURABLE_PATH/, "an unrecognized lane value must be refused in production, same as an explicit notification-lane send with no durable path");
    assert.equal(sends.length, 0, "the inner mailer must never be called for a refused send");
    durableReady = true;
    await gated.send(sendInput(FAKE_EMAIL, {
        idempotencyKey: "k2",
        workspaceId: "ws-1",
        sourceContext: { module: "future-feature" },
        // Deliberately invalid runtime discriminator — same unrecognized value, now with a durable path registered
        lane: "some-brand-new-value-nobody-mapped",
    } as unknown as MailerSendOptions), sendOptions({
        idempotencyKey: "k2",
        workspaceId: "ws-1",
        sourceContext: { module: "future-feature" },
        // Deliberately invalid runtime discriminator — same unrecognized value, now with a durable path registered
        lane: "some-brand-new-value-nobody-mapped",
    } as unknown as MailerSendOptions));
    assert.equal(sends.length, 1, "once a durable path is ready, the same (still-unrecognized) lane value proceeds — proving the gate discriminates on readiness, not just on recognizing the value");
});
test("AC-16: a legacy transactional send without a lane defaults to notification", async () => {
    const { mailer, sends } = fakeInnerMailer();
    let durableReady = false;
    const gated = wrapMailerWithPurposeGate({
        inner: mailer, mode: "production",
        readiness: { isReady: ({ capabilityName: capability }) => capability === "forms" && durableReady },
    });
    const options: MailerSendOptions = {
        idempotencyKey: "legacy-1", workspaceId: "ws-1",
        sourceContext: { module: "forms" }, purpose: "transactional",
    };
    await assert.rejects(() => gated.send(sendInput(FAKE_EMAIL, options), sendOptions(options)), /capability "forms"/);
    assert.equal(sends.length, 0);
    durableReady = true;
    await gated.send(sendInput(FAKE_EMAIL, options), sendOptions(options));
    assert.deepEqual(sends, [options]);
});
test("AC-17: post-fix vocabulary split resolves members (interactive) and forms (notification) to distinct lanes", async () => {
    const { mailer, sends } = fakeInnerMailer();
    const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "production", readiness: { isReady: () => false } });
    // Interactive lane (members' shape, post-fix) — must proceed even with no durable path.
    await gated.send(sendInput(FAKE_EMAIL, {
        idempotencyKey: "members-1",
        workspaceId: "ws-1",
        sourceContext: { module: "members" },
        lane: "interactive",
    } as unknown as MailerSendOptions), sendOptions({
        idempotencyKey: "members-1",
        workspaceId: "ws-1",
        sourceContext: { module: "members" },
        lane: "interactive",
    } as unknown as MailerSendOptions));
    assert.equal(sends.length, 1);
    // Notification lane (forms' shape, post-fix) — must be refused with no durable path.
    await assert.rejects(() => gated.send(sendInput(FAKE_EMAIL, {
        idempotencyKey: "forms-1",
        workspaceId: "ws-1",
        sourceContext: { module: "forms" },
        lane: "notification",
    } as unknown as MailerSendOptions), sendOptions({
        idempotencyKey: "forms-1",
        workspaceId: "ws-1",
        sourceContext: { module: "forms" },
        lane: "notification",
    } as unknown as MailerSendOptions)));
    assert.equal(sends.length, 1, "the notification-lane send must not have reached the inner mailer");
});
test("AC-18: notification-lane send refused in production without a durable path — structured refusal, not silent drop", async () => {
    const { mailer, sends } = fakeInnerMailer();
    const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "production", readiness: { isReady: () => false } });
    await assert.rejects(() => gated.send(sendInput(FAKE_EMAIL, {
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "forms" },
        lane: "notification",
    } as unknown as MailerSendOptions), sendOptions({
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "forms" },
        lane: "notification",
    } as unknown as MailerSendOptions)), (err: Error) => err.message.includes("MAILER_SEND_REFUSED_NO_DURABLE_PATH"));
    assert.equal(sends.length, 0);
});
test("AC-19: interactive-lane send proceeds under the same conditions (no durable path) that refuse notification-lane", async () => {
    const { mailer, sends } = fakeInnerMailer();
    const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "production", readiness: { isReady: () => false } });
    await gated.send(sendInput(FAKE_EMAIL, {
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "members" },
        lane: "interactive",
    } as unknown as MailerSendOptions), sendOptions({
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "members" },
        lane: "interactive",
    } as unknown as MailerSendOptions));
    assert.equal(sends.length, 1, "interactive lane must never be gated on durable-outbox readiness");
});
test("AC-20: notification-lane readiness is scoped to the sending capability", async () => {
    const { mailer, sends } = fakeInnerMailer();
    const checked: string[] = [];
    const gated = wrapMailerWithPurposeGate({
        inner: mailer, mode: "production",
        readiness: { isReady: ({ capabilityName: capability }) => { checked.push(capability); return capability === "forms"; } },
    });
    const options: MailerSendOptions = {
        idempotencyKey: "k1", workspaceId: "ws-1",
        sourceContext: { module: "forms" }, lane: "notification",
    };
    await gated.send(sendInput(FAKE_EMAIL, options), sendOptions(options));
    assert.equal(sends.length, 1);
    await assert.rejects(() => gated.send(sendInput(FAKE_EMAIL, { ...options, sourceContext: { module: "members" } }), sendOptions({ ...options, sourceContext: { module: "members" } })), /MAILER_SEND_REFUSED_NO_DURABLE_PATH:.*capability "members"/);
    assert.deepEqual(checked, ["forms", "members"]);
    assert.equal(sends.length, 1, "another capability's durable path cannot permit this send");
});
test("U-001-B3/INV-06: local mode never refuses, regardless of lane or durable-path readiness", async () => {
    const { mailer, sends } = fakeInnerMailer();
    const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "local", readiness: { isReady: () => false } });
    await gated.send(sendInput(FAKE_EMAIL, {
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "forms" },
        lane: "notification",
    } as unknown as MailerSendOptions), sendOptions({
        idempotencyKey: "k1",
        workspaceId: "ws-1",
        sourceContext: { module: "forms" },
        lane: "notification",
    } as unknown as MailerSendOptions));
    assert.equal(sends.length, 1, "local mode must behave exactly as it does today — no refusal path");
});
test("U-001-ORD1: mode is resolved once and cached, not re-read from process.env on every send", async () => {
    const { mailer, sends } = fakeInnerMailer();
    const gated = wrapMailerWithPurposeGate({ inner: mailer, mode: "local", readiness: { isReady: () => false } });
    const originalEnv = process.env.FIXTURE_RUNTIME_MODE;
    try {
        process.env.FIXTURE_RUNTIME_MODE = "production";
        // The decorator was constructed with mode "local" already resolved/injected — a later
        // mutation of process.env must not change its behavior mid-process.
        await gated.send(sendInput(FAKE_EMAIL, {
            idempotencyKey: "k1",
            workspaceId: "ws-1",
            sourceContext: { module: "forms" },
            lane: "notification",
        } as unknown as MailerSendOptions), sendOptions({
            idempotencyKey: "k1",
            workspaceId: "ws-1",
            sourceContext: { module: "forms" },
            lane: "notification",
        } as unknown as MailerSendOptions));
        assert.equal(sends.length, 1, "decorator must not re-resolve mode from a live env read");
    }
    finally {
        if (originalEnv === undefined)
            delete process.env.FIXTURE_RUNTIME_MODE;
        else
            process.env.FIXTURE_RUNTIME_MODE = originalEnv;
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
    const outcomes: readonly MailerSendResult[] = [SUCCESS, failure];
    for (const mode of ["production", "local"] as const) {
        for (const index of [0, 1]) {
            const result: MailerSendResult = outcomes[index]!;
            const { mailer, sends, messages } = fakeInnerMailer(result);
            const gated = wrapMailerWithPurposeGate({ inner: mailer, mode, readiness: { isReady: () => false } });
            const options: MailerSendOptions = {
                idempotencyKey: "forward-1", workspaceId: "ws-1", timeoutMs: 1234,
                sourceContext: { module: "members", ref: "member-1" }, purpose: "transactional",
                lane: mode === "production" ? "interactive" : "notification",
            };
            const expectedMessage = structuredClone(message);
            const expectedOptions = structuredClone(options);
            const expectedResult: MailerSendResult = structuredClone(result);
            assert.deepEqual(await gated.send(sendInput(message, options), sendOptions(options)), expectedResult);
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
        readiness: { isReady: ({ capabilityName: capability }) => capability === "forms" && durableReady },
    });
    const messages = [FAKE_EMAIL, { ...FAKE_EMAIL, to: { email: "second@example.com" } }];
    const options: MailerSendOptions = {
        idempotencyKey: "batch-1", workspaceId: "ws-1",
        sourceContext: { module: "forms" }, lane: "notification",
    };
    assert.deepEqual(gated.capabilities({}), capabilities);
    await assert.rejects(() => gated.sendBatch(batchInput(messages, options), sendOptions(options)), /capability "forms"/);
    assert.equal(batches.length, 0);
    assert.equal(sends.length, 0, "refused batches must not deliver individually either");
    const interactive = { ...options, lane: "interactive" as const };
    assert.deepEqual(await gated.sendBatch(batchInput(messages, interactive), sendOptions(interactive)), [SUCCESS, SUCCESS]);
    durableReady = true;
    assert.deepEqual(await gated.sendBatch(batchInput(messages, options), sendOptions(options)), [SUCCESS, SUCCESS]);
    assert.deepEqual(batches, [{ messages, options: interactive }, { messages, options }]);
    assert.equal(sends.length, 0, "permitted batches use the inner batch method");
});
function sendInput(message: OutboundEmail, options: MailerSendOptions) { return { message, idempotencyKey: options.idempotencyKey, workspaceId: options.workspaceId, sourceContext: options.sourceContext }; }
function batchInput(messages: readonly OutboundEmail[], options: MailerSendOptions) { return { messages, idempotencyKey: options.idempotencyKey, workspaceId: options.workspaceId, sourceContext: options.sourceContext }; }
function sendOptions({ idempotencyKey, workspaceId, sourceContext, ...optional }: MailerSendOptions) { return optional; }
