import assert from "node:assert/strict";
import { afterEach, describe, test, vi } from "vitest";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import { createMailAdapterContext, type MailProviderModule, type MailerSendRequired } from "../index.js";

const credential = Object.freeze({ token: "test-sending-key" });
const httpClient: HttpClientPort = { send: async () => { throw new Error("Unexpected HTTP request"); } };
const kit = Object.freeze({ httpClient });
const input = Object.freeze({ credential, kit });
const delivery: MailerSendRequired = {
  workspaceId: "workspace", idempotencyKey: "delivery", sourceContext: { module: "test" },
  message: { workspaceId: "workspace", to: { email: "to@example.com" }, from: { email: "from@example.com" }, subject: "Context" },
};
const instant = "2026-10-28T12:00:00.000Z";
const now = () => new Date(instant);

/** Representative plugin module: validates its own setting and consumes the clock when sending. */
function providerFixture({ id, settingKey }: { id: string; settingKey: string }): MailProviderModule {
  return {
    id, label: id, credentialKeys: ["token"],
    capabilities: { hosted: true, feedback: false, domainVerification: false },
    create(context) {
      const clock = context.now;
      assert.equal(typeof clock, "function");
      assert.ok(clock);
      assert.ok(context.settings && typeof context.settings === "object");
      const value = (context.settings as Record<string, unknown>)[settingKey];
      if (value !== undefined && typeof value !== "string") throw new Error("Invalid provider setting");
      const send = async () => ({ ok: true as const, providerMessageId: `${id}:${value ?? "default"}`, acceptedAt: clock().toISOString() });
      return {
        capabilities: () => ({ driver: id, supportsIdempotencyKey: false, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
        send,
        sendBatch: async ({ messages }) => Promise.all(messages.map(() => send())),
      };
    },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("mail module create context", () => {
  test("omitted options supply a live wall clock and empty settings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    const context = createMailAdapterContext(input);
    assert.equal(context.now().toISOString(), instant);
    assert.deepEqual(context.settings, {});
    vi.setSystemTime(new Date("2026-10-28T12:00:01.000Z"));
    assert.equal(context.now().toISOString(), "2026-10-28T12:00:01.000Z");
  });

  test("a supplied clock keeps working when settings are omitted", () => {
    const context = createMailAdapterContext(input, { now });
    assert.equal(context.now, now);
    assert.equal(context.now().toISOString(), instant);
    assert.deepEqual(context.settings, {});
  });

  test("supplying settings alone retains the default clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    const settings = Object.freeze({ region: "eu-west-1" });
    const context = createMailAdapterContext(input, { settings });
    assert.equal(context.now().toISOString(), instant);
    assert.equal(context.settings, settings);
  });

  test("undefined settings use the same defaults", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    const context = createMailAdapterContext(input, { settings: undefined });
    assert.equal(context.now().toISOString(), instant);
    assert.deepEqual(context.settings, {});
  });

  test("preserves credential and guarded HTTP identity without mutating inputs", () => {
    const context = createMailAdapterContext(input, Object.freeze({ now, settings: Object.freeze({}) }));
    assert.equal(context.credential, credential);
    assert.equal(context.kit, kit);
    assert.equal(context.kit.httpClient, httpClient);
    assert.deepEqual(Object.keys(input), ["credential", "kit"]);
  });

  test("empty settings belong to each installation independently", () => {
    const first = createMailAdapterContext(input);
    const second = createMailAdapterContext(input);
    assert.notEqual(first.settings, second.settings);
    (first.settings as Record<string, unknown>).region = "eu-west-1";
    assert.deepEqual(second.settings, {});
  });

  test.each([{ settings: null }, { settings: false }, { settings: 0 }, { settings: "" }, { settings: ["opaque"] }])("passes opaque settings %j to the module without validation", ({ settings }) => {
    assert.equal(createMailAdapterContext(input, { settings }).settings, settings);
  });

  for (const [id, settingKey, value] of [["amazon-ses", "region", "eu-west-1"], ["resend-email", "domain", "mail.example.com"]] as const) {
    test(`${id} settings change the created mailer's output`, async () => {
      const provider = providerFixture({ id, settingKey });
      const baseline = provider.create(createMailAdapterContext(input, { now }));
      const treatment = provider.create(createMailAdapterContext(input, { now, settings: Object.freeze({ [settingKey]: value }) }));
      assert.deepEqual(await baseline.send(delivery), { ok: true, providerMessageId: `${id}:default`, acceptedAt: instant });
      assert.deepEqual(await treatment.send(delivery), { ok: true, providerMessageId: `${id}:${value}`, acceptedAt: instant });
    });

    test(`${id} sends use the injected clock at send time`, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));
      const provider = providerFixture({ id, settingKey });
      const settings = Object.freeze({ [settingKey]: value });
      const baseline = provider.create(createMailAdapterContext(input, { settings }));
      let epochMs = Date.parse("2020-01-01T00:00:00.000Z");
      const treatment = provider.create(createMailAdapterContext(input, { settings, now: () => new Date(epochMs) }));
      epochMs += 1000;
      assert.deepEqual(await baseline.send(delivery), { ok: true, providerMessageId: `${id}:${value}`, acceptedAt: instant });
      assert.deepEqual(await treatment.send(delivery), { ok: true, providerMessageId: `${id}:${value}`, acceptedAt: "2020-01-01T00:00:01.000Z" });
      const { message, ...identity } = delivery;
      assert.deepEqual(await treatment.sendBatch({ ...identity, messages: [message] }),
        [{ ok: true, providerMessageId: `${id}:${value}`, acceptedAt: "2020-01-01T00:00:01.000Z" }]);
    });
  }

  test("the module retains authority to reject its own settings", () => {
    const provider = providerFixture({ id: "amazon-ses", settingKey: "region" });
    const context = createMailAdapterContext(input, { now, settings: { region: 42 } });
    assert.throws(() => provider.create(context), /Invalid provider setting/);
  });
});
