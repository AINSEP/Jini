import { describe, expect, test } from "vitest";

import { paymentError } from "../../contract/provider.js";
import type { LedgerTx, PaymentsLedger } from "../../ledger/repo.js";
import { LIPAY, SCRIPTED, USD, authorizedScripted, paidLipay, recordingAlerts, rejected, timedOut, world, type World } from "./harness.js";

/**
 * @file `PaymentsPort.refund` in the owner's order (lookup → grant → reserve → attempt; dispatch
 * outside; settle), with grants re-checked by the service, every refusal typed, and the
 * idempotency race resolved to a replay.
 */

async function refundGrant(w: World, paymentId: string, amountMinor: number, key = "rk-1", scope = LIPAY) {
  return w.grant({ op: "refund", paymentId, amount: { minorUnits: amountMinor, currency: "USD" }, idempotencyKey: key, scope });
}

for (const ledgerKind of ["memory", "sqlite"] as const) {
  describe(`refund on ${ledgerKind}`, () => {
    test("a granted refund reserves, dispatches with our refund id as the correlation id, and settles through the writer", async () => {
      const w = await world({ ledgerKind });
      const paid = await paidLipay(w);
      const grant = await refundGrant(w, paid.id, 3_000);
      const result = await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant }, { reason: "damaged" });
      expect(result).toMatchObject({ ok: true, replayed: false, refund: { paymentId: paid.id, amount: USD(3_000), status: "pending" }, payment: { refundHeld: USD(3_000), status: "succeeded" } });
      const refundId = result.ok ? result.refund.id : "";
      const { attempts, refunds } = await w.read(paid.id);
      expect(attempts.at(-1)).toMatchObject({ op: "refund", operationKey: "refund:rk-1", refundId, outcome: "ok" });
      expect(refunds).toEqual([expect.objectContaining({ id: refundId, idempotencyKey: "rk-1", reason: "damaged", providerRefundRef: expect.any(String) })]);
      expect(w.lipay.server.refundOf({ refundId: refunds[0]!.providerRefundRef! })).toMatchObject({ correlationId: refundId, amount: USD(3_000) });
      // Single use: the grant cannot move money twice.
      expect(await w.grants.redeem({ grant, binding: { op: "refund", workspaceId: "ws", mode: "test", paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1" } })).toBe(false);
    });
  });
}

describe("refund: idempotency", () => {
  test("the same request again is replayed without a grant; the provider is called once", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    const first = await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant: await refundGrant(w, paid.id, 3_000) });
    const again = await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant: "spent" });
    expect(again).toMatchObject({ ok: true, replayed: true, refund: (first as { refund: unknown }).refund });
    expect((await w.read(paid.id)).attempts.filter((a) => a.op === "refund")).toHaveLength(1);
  });

  test("the same key for another amount, payment or site is a conflict", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    const other = await paidLipay(w, "ik-2");
    await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant: await refundGrant(w, paid.id, 3_000) });
    const conflict = { ok: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "idempotency key already used for a different refund request", retryable: false } };
    expect(await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(2_000), idempotencyKey: "rk-1", grant: "g" })).toEqual(conflict);
    expect(await w.service.refund({ scope: LIPAY, paymentId: other.id, amount: USD(3_000), idempotencyKey: "rk-1", grant: "g" })).toEqual(conflict);
    expect(await w.service.refund({ scope: { ...LIPAY, siteId: "site-2" }, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant: "g" })).toEqual(conflict);
  });

  test("an idempotency race lost at the reservation insert turns into the winner's replay", async () => {
    let blind = false;
    const wrap = (ledger: PaymentsLedger): PaymentsLedger => ({
      transaction: ({ fn }) => ledger.transaction({ fn: (tx) => fn(new Proxy(tx, {
        get: (target, name) => (blind && name === "findRefundByIdempotencyKey"
          ? () => { blind = false; return Promise.resolve(null); }
          : Reflect.get(target, name).bind(target)),
      }) as LedgerTx) }),
    });
    const w = await world({ wrapLedger: wrap });
    const paid = await paidLipay(w);
    const first = await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant: await refundGrant(w, paid.id, 3_000) });
    blind = true;
    const grant = await refundGrant(w, paid.id, 3_000);
    expect(await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant })).toMatchObject({ ok: true, replayed: true, refund: (first as { refund: unknown }).refund });
    expect((await w.read(paid.id)).refunds).toHaveLength(1);
  });
});

describe("refund: refusals", () => {
  test.each([
    ["an unusable scope", { scope: { ...LIPAY, mode: "prod" as never } }, "INVALID_REQUEST", 'scope.mode must be "test" or "live"'],
    ["an unregistered provider", { scope: { ...LIPAY, providerId: "gone" } }, "PROVIDER_NOT_REGISTERED", "no payment provider 'gone' is registered"],
    ["a fractional amount", { amount: USD(1.5) }, "INVALID_REQUEST", "amount: minorUnits must be a safe integer number of minor units"],
    ["a blank idempotency key", { idempotencyKey: "" }, "INVALID_REQUEST", "idempotencyKey must be a non-empty string"],
    ["a blank payment id", { paymentId: "" }, "INVALID_REQUEST", "paymentId must be a non-empty string"],
    ["an unknown payment", { paymentId: "pay_nope" }, "INVALID_REQUEST", "payment 'pay_nope' not found in this scope"],
    ["another site's payment", { scope: { ...LIPAY, siteId: "site-2" } }, "INVALID_REQUEST", "payment 'PAID' not found in this scope"],
    ["another currency", { amount: { minorUnits: 3_000, currency: "EUR" } }, "INVALID_REQUEST", "refund currency EUR differs from the payment's USD"],
    ["a bad grant", { grant: "forged" }, "GRANT_INVALID", "the refund grant is missing, expired, used or bound to another request"],
    ["more than is refundable", { amount: USD(10_001) }, "INVALID_REQUEST", "the refund exceeds the refundable amount (10000 minor units left)"],
  ])("%s", async (_name, change, code, message) => {
    const w = await world();
    const paid = await paidLipay(w);
    const request = { scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant: "", ...change };
    const grant = change.grant ?? await w.grant({ op: "refund", paymentId: request.paymentId, amount: request.amount, idempotencyKey: request.idempotencyKey });
    const result = await w.service.refund({ ...request, grant });
    expect(result).toEqual({ ok: false, error: { code, message: message.replace("PAID", paid.id), retryable: false } });
    expect((await w.read(paid.id)).refunds).toEqual([]);
  });

  test("a payment that has not succeeded cannot be refunded", async () => {
    const w = await world();
    const authorized = await authorizedScripted(w);
    const grant = await refundGrant(w, authorized.id, 100, "rk-1", SCRIPTED);
    expect(await w.service.refund({ scope: SCRIPTED, paymentId: authorized.id, amount: USD(100), idempotencyKey: "rk-1", grant }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "the payment has not succeeded, so it cannot be refunded" } });
  });

  test("a payment whose outcome never came back has no provider reference to refund", async () => {
    const w = await world();
    w.lipay.server.script({ op: "createIntent", behaviours: ["timeout"] });
    const lost = await w.service.createIntent({ scope: LIPAY, amount: USD(10_000), idempotencyKey: "ik-1", reference: "o" });
    const id = (lost as { payment: { id: string } }).payment.id;
    expect(await w.service.refund({ scope: LIPAY, paymentId: id, amount: USD(100), idempotencyKey: "rk-1", grant: "g" }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "the payment has no provider reference to refund against" } });
  });

  test("a provider without refunds, or one that promises refunds but has no method, is CAPABILITY_UNSUPPORTED", async () => {
    for (const options of [{ scripted: { refunds: "none" as const } }, { scriptedOmit: ["refund" as const] }]) {
      const w = await world(options);
      expect(await w.service.refund({ scope: SCRIPTED, paymentId: "p", amount: USD(1), idempotencyKey: "k", grant: "g" }))
        .toMatchObject({ ok: false, error: { code: "CAPABILITY_UNSUPPORTED", message: "provider 'scripted' does not support refunds" } });
    }
  });

  test("a full-only provider refunds exactly the refundable amount", async () => {
    const w = await world({ scripted: { refunds: "full", capture: "auto" } });
    const paid = await w.service.createIntent({ scope: SCRIPTED, amount: USD(10_000), idempotencyKey: "ik", reference: "o" });
    const id = (paid as { payment: { id: string } }).payment.id;
    expect(await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk-1", grant: "g" }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "provider 'scripted' refunds only the whole refundable amount (10000 minor units)" } });
    const grant = await refundGrant(w, id, 10_000, "rk-2", SCRIPTED);
    expect(await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(10_000), idempotencyKey: "rk-2", grant }))
      .toMatchObject({ ok: true, refund: { status: "succeeded" }, payment: { status: "refunded", refunded: USD(10_000) } });
  });

  test("missing credentials refuse before anything is reserved or any grant is spent", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    const grant = await refundGrant(w, paid.id, 3_000);
    w.failContextFor("lipay");
    expect(await w.service.refund({ scope: LIPAY, paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1", grant })).toMatchObject({ ok: false, error: { code: "NO_CREDENTIALS_CONFIGURED" } });
    expect(await w.grants.redeem({ grant, binding: { op: "refund", workspaceId: "ws", mode: "test", paymentId: paid.id, amount: USD(3_000), idempotencyKey: "rk-1" } })).toBe(true);
  });
});

describe("refund: provider answers", () => {
  async function scriptedPaid(w: World) {
    const paid = await w.service.createIntent({ scope: SCRIPTED, amount: USD(10_000), idempotencyKey: "ik", reference: "o" });
    return (paid as { payment: { id: string } }).payment.id;
  }

  test("rejected: the reservation fails and the hold is released", async () => {
    const w = await world({ scripted: { capture: "auto" } });
    const id = await scriptedPaid(w);
    w.scripted.queue("refund", rejected());
    const result = await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk", grant: await refundGrant(w, id, 3_000, "rk", SCRIPTED) });
    expect(result).toEqual({ ok: false, error: { code: "DECLINED", message: "provider said no", retryable: false } });
    expect((await w.read(id)).refunds.map((r) => r.status)).toEqual(["failed"]);
    expect((await w.read(id)).payment?.refundHeldMinor).toBe(0);
  });

  test("rejected, then replayed under the same key: the rejection again, not success (C-1)", async () => {
    const w = await world({ scripted: { capture: "auto" } });
    const id = await scriptedPaid(w);
    w.scripted.queue("refund", { kind: "rejected", error: paymentError({ code: "PROVIDER_ERROR", message: "rate limited" }, { retryable: true }) });
    const first = await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk", grant: await refundGrant(w, id, 3_000, "rk", SCRIPTED) });
    expect(first).toEqual({ ok: false, error: { code: "PROVIDER_ERROR", message: "rate limited", retryable: false } });
    const again = await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk", grant: "g" });
    expect(again).toEqual({ ok: false, error: {
      code: "PROVIDER_ERROR", retryable: false,
      message: "rate limited (replayed: the earlier refund under this idempotencyKey was rejected and moved no money; a new attempt needs a new idempotencyKey)",
    } });
    expect(w.scripted.calls.filter((c) => c.op === "refund")).toHaveLength(1);
  });

  test("a refund the provider later reported failed replays as a failure, not success (C-1)", async () => {
    const w = await world({ scripted: { capture: "auto" } });
    const id = await scriptedPaid(w);
    await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk", grant: await refundGrant(w, id, 3_000, "rk", SCRIPTED) });
    const [row] = (await w.read(id)).refunds;
    await w.ledger.transaction({ fn: (tx) => tx.updateRefund({ id: row!.id, patch: { status: "failed", updatedAt: 1 } }) });
    const again = await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk", grant: "g" });
    expect(again).toEqual({ ok: false, error: {
      code: "DECLINED", retryable: false,
      message: "the refund under this idempotencyKey failed at the provider and moved no money; a new attempt needs a new idempotencyKey",
    } });
  });

  test("unknown: the refund is unknown and keeps holding the money (B4)", async () => {
    const w = await world({ scripted: { capture: "auto" } });
    const id = await scriptedPaid(w);
    w.scripted.queue("refund", timedOut());
    const result = await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk", grant: await refundGrant(w, id, 3_000, "rk", SCRIPTED) }, { reason: "r" });
    expect(result).toMatchObject({ ok: false, error: { code: "TRANSPORT_ERROR" } });
    expect((await w.read(id)).refunds.map((r) => r.status)).toEqual(["unknown"]);
    expect((await w.read(id)).payment?.refundHeldMinor).toBe(3_000);
    expect(w.scripted.calls.at(-1)).toMatchObject({ op: "refund", optional: { reason: "r" } });
  });

  test("a response the writer quarantines: PROVIDER_ERROR and an alert; the money stays held", async () => {
    const alerts = recordingAlerts();
    const w = await world({ scripted: { capture: "auto" }, alerts });
    const id = await scriptedPaid(w);
    w.scripted.queue("refund", { kind: "ok", value: { providerRefundRef: "sre_x", amount: USD(9_000), status: "succeeded" } });
    expect(await w.service.refund({ scope: SCRIPTED, paymentId: id, amount: USD(3_000), idempotencyKey: "rk", grant: await refundGrant(w, id, 3_000, "rk", SCRIPTED) }))
      .toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR" } });
    expect(alerts.raised.map((a) => a.kind)).toEqual(["quarantine"]);
    expect((await w.read(id)).payment?.refundHeldMinor).toBe(3_000);
  });
});
