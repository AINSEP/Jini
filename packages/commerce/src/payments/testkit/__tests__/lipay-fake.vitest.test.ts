import { describe, expect, test } from "vitest";
import { providerConformanceCases } from "../provider-conformance.js";
import { createLipayFake, lipayFakeContext } from "../lipay-fake.js";

const USD = (minorUnits: number) => ({ minorUnits, currency: "USD" });
const now = () => 1_800_000_000_000;
const ctx = lipayFakeContext({ now });
const intent = { amount: USD(10_000), idempotencyKey: "k1", correlationId: "pay_1", captureMode: "auto" as const };

describe("LiPay fake", () => {
  test("every implemented method refuses live mode before consuming scripts or touching fake state", async () => {
    const { server, provider } = createLipayFake({ now });
    await provider.createIntent({ req: intent, ctx });
    const live = { ...ctx, account: { ...ctx.account, mode: "live" as const } };
    const refund = { providerRef: "ch_1", amount: USD(1_000), idempotencyKey: "r1", correlationId: "rf_1" };
    server.script({ op: "createIntent", behaviours: ["reject"] });
    server.script({ op: "refund", behaviours: ["reject"] });
    const refusal = { kind: "rejected", error: { code: "INVALID_REQUEST", message: "LiPay fake is test-only", retryable: false } };
    expect(await provider.createIntent({ req: intent, ctx: live }, {})).toEqual(refusal);
    expect(await provider.refund!({ req: refund, ctx: live }, {})).toEqual(refusal);
    expect(await provider.retrieve!({ providerRef: "ch_1", ctx: live }, {})).toEqual(refusal);
    // Even malformed bytes stop at the mode guard, before signature verification or parsing.
    expect(await provider.verifyWebhook({ rawBody: Buffer.from("not json"), headers: {}, ctx: live }, {})).toEqual(refusal);
    expect(server.refundOf({ refundId: "re_2" })).toBeUndefined();
    expect(await provider.createIntent({ req: intent, ctx })).toMatchObject({ kind: "rejected", error: { code: "DECLINED" } });
    expect(await provider.refund!({ req: refund, ctx })).toMatchObject({ kind: "rejected", error: { code: "DECLINED" } });
    expect(await provider.createIntent({ req: intent, ctx })).toMatchObject({ kind: "ok", value: { evidence: { providerRef: "ch_2" } } });
    expect(await provider.refund!({ req: refund, ctx })).toMatchObject({ kind: "ok", value: { providerRefundRef: "re_3" } });
    expect(await provider.retrieve!({ providerRef: "ch_1", ctx })).toMatchObject({ kind: "ok", value: { refunds: [{ providerRefundRef: "re_3" }] } });
    const delivery = server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "evt_after_live" });
    expect(await provider.verifyWebhook({ ...delivery, ctx })).toMatchObject({ kind: "ok", value: [{ providerEventId: "evt_after_live" }] });
  });

  test("passes the provider conformance kit", async () => {
    const { provider } = createLipayFake({ now });
    for (const c of providerConformanceCases({ provider, makeContext: () => ctx })) await c.run();
  });

  test("createIntent: ok echoes our correlation id; timeout charges but answers unknown; reject moves nothing", async () => {
    const { server, provider } = createLipayFake({ now });
    server.script({ op: "createIntent", behaviours: ["ok", "timeout", "reject"] });
    const ok = await provider.createIntent({ req: intent, ctx });
    expect(ok).toEqual({ kind: "ok", value: { next: { kind: "none" }, evidence: { providerRef: "ch_1", correlationId: "pay_1", status: "succeeded", amount: USD(10_000), refunds: [], disputes: [] } } });
    expect(await provider.createIntent({ req: intent, ctx })).toMatchObject({ kind: "unknown", error: { code: "TRANSPORT_ERROR", retryable: true } });
    expect(await provider.retrieve!({ providerRef: "ch_2", ctx })).toMatchObject({ kind: "ok", value: { status: "succeeded" } });
    expect(await provider.createIntent({ req: intent, ctx })).toMatchObject({ kind: "rejected", error: { code: "DECLINED" } });
    expect(await provider.retrieve!({ providerRef: "ch_3", ctx })).toMatchObject({ kind: "rejected" });
  });

  test("refund: ok is pending at first; timeout still creates it; settle moves it; reject creates nothing", async () => {
    const { server, provider } = createLipayFake({ now });
    await provider.createIntent({ req: intent, ctx });
    server.script({ op: "refund", behaviours: ["ok", "timeout", "reject"] });
    const req = { providerRef: "ch_1", amount: USD(3_000), idempotencyKey: "r1", correlationId: "rf_1" };
    expect(await provider.refund!({ req, ctx })).toEqual({ kind: "ok", value: { providerRefundRef: "re_2", correlationId: "rf_1", amount: USD(3_000), status: "pending" } });
    expect(await provider.refund!({ req: { ...req, correlationId: "rf_2" }, ctx })).toMatchObject({ kind: "unknown" });
    expect(server.refundOf({ refundId: "re_3" })).toMatchObject({ correlationId: "rf_2", status: "pending" });
    expect(await provider.refund!({ req, ctx })).toMatchObject({ kind: "rejected" });
    server.settleRefund({ refundId: "re_2", status: "succeeded" });
    expect(server.refundOf({ refundId: "re_2" })?.status).toBe("succeeded");
  });

  test("webhooks verify and carry one refund (refund.updated) or the whole charge (charge.refunded)", async () => {
    const { server, provider } = createLipayFake({ now }, { echoesCorrelation: false });
    await provider.createIntent({ req: intent, ctx });
    await provider.refund!({ req: { providerRef: "ch_1", amount: USD(1_000), idempotencyKey: "a", correlationId: "rf_a" }, ctx });
    await provider.refund!({ req: { providerRef: "ch_1", amount: USD(2_000), idempotencyKey: "b", correlationId: "rf_b" }, ctx });
    const one = await provider.verifyWebhook({ ...server.webhook({ type: "refund.updated", id: "re_3", eventId: "evt_1" }), ctx });
    expect(one).toMatchObject({ kind: "ok", value: [{ providerEventId: "evt_1", providerRef: "ch_1", evidence: { refunds: [{ providerRefundRef: "re_3", amount: USD(2_000) }] } }] });
    expect((one as { value: [{ evidence: { refunds: [object] } }] }).value[0].evidence.refunds[0]).not.toHaveProperty("correlationId");
    const all = await provider.verifyWebhook({ ...server.webhook({ type: "charge.refunded", id: "ch_1", eventId: "evt_2" }, { echoCorrelation: true }), ctx });
    expect(all).toMatchObject({ kind: "ok", value: [{ evidence: { correlationId: "pay_1", refunds: [{ correlationId: "rf_a" }, { correlationId: "rf_b" }] } }] });
  });

  test.each([
    ["a tampered body", (d: { rawBody: Uint8Array; headers: Record<string, string> }) => ({ ...d, rawBody: Buffer.from("{}") })],
    ["a missing header", (d: { rawBody: Uint8Array; headers: Record<string, string> }) => ({ ...d, headers: {} })],
  ])("%s is rejected", async (_n, mutate) => {
    const { server, provider } = createLipayFake({ now });
    await provider.createIntent({ req: intent, ctx });
    const delivery = mutate(server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "e" }));
    expect(await provider.verifyWebhook({ ...delivery, ctx })).toMatchObject({ kind: "rejected", error: { code: "SIGNATURE_INVALID" } });
  });

  test("a stale timestamp or a missing secret is rejected", async () => {
    const { server, provider } = createLipayFake({ now });
    await provider.createIntent({ req: intent, ctx });
    const delivery = server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "e" });
    expect(await provider.verifyWebhook({ ...delivery, ctx: lipayFakeContext({ now: () => now() + 301_000 }) })).toMatchObject({ kind: "rejected" });
    expect(await provider.verifyWebhook({ ...delivery, ctx: { ...ctx, credentials: {} } })).toMatchObject({ kind: "rejected" });
  });
});
