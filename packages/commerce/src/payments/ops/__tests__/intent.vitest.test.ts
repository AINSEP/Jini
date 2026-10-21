import { describe, expect, test } from "vitest";

import { LedgerConstraintError, type LedgerTx, type PaymentsLedger } from "../../ledger/repo.js";
import { LIPAY, SCRIPTED, USD, recordingAlerts, rejected, riskPort, timedOut, world } from "./harness.js";

/**
 * @file `PaymentsPort.createIntent`: checks, idempotent replay and conflict, the risk gate, the
 * two transactions around the provider call, and every provider answer (ok, rejected, unknown,
 * thrown, unreadable) — on the in-memory ledger and on SQL over SQLite.
 */

const intent = (over: Partial<{ amount: { minorUnits: number; currency: string }; idempotencyKey: string; reference: string }> = {}) =>
  ({ scope: LIPAY, amount: USD(10_000), idempotencyKey: "ik-1", reference: "order-1", ...over });

for (const ledgerKind of ["memory", "sqlite"] as const) {
  describe(`createIntent on ${ledgerKind}`, () => {
    test("a charge: payment unknown + attempt dispatched first, then the response through the single writer", async () => {
      const w = await world({ ledgerKind });
      const result = await w.service.createIntent(intent());
      expect(result).toMatchObject({
        ok: true, replayed: false, risk: { verdict: "allow", reasons: [], fallback: false },
        payment: { scope: LIPAY, status: "succeeded", amount: USD(10_000), captured: USD(10_000), refunded: USD(0), refundHeld: USD(0), disputed: USD(0), reference: "order-1", next: { kind: "none" } },
      });
      const id = result.ok ? result.payment.id : "";
      const { attempts, evidence, outbox } = await w.read(id);
      expect(attempts).toEqual([expect.objectContaining({ op: "intent", operationKey: "intent:ik-1", outcome: "ok", errorCode: null, refundId: null })]);
      expect(evidence.map((e) => e.source)).toEqual(["response"]);
      expect(outbox).toEqual(["payment.succeeded"]);
      expect(w.lipay.server.refundOf({ refundId: "x" })).toBeUndefined();
    });
  });
}

describe("createIntent: idempotency", () => {
  test("the same request again is replayed from the ledger; the provider is called once", async () => {
    const w = await world();
    const first = await w.service.createIntent(intent());
    const again = await w.service.createIntent(intent());
    expect(again).toEqual({ ok: true, payment: (first as { payment: unknown }).payment, replayed: true, risk: { verdict: "allow", reasons: ["idempotent-replay"], fallback: false } });
    const id = (first as { payment: { id: string } }).payment.id;
    expect((await w.read(id)).attempts).toHaveLength(1);
  });

  test.each([
    ["amount", intent({ amount: USD(9_999) })],
    ["currency", intent({ amount: { minorUnits: 10_000, currency: "EUR" } })],
    ["reference", intent({ reference: "order-2" })],
    ["site", { ...intent(), scope: { ...LIPAY, siteId: "other-site" } }],
  ])("the same key with a different %s is a conflict", async (_name, request) => {
    const w = await world();
    await w.service.createIntent(intent());
    expect(await w.service.createIntent(request)).toEqual({
      ok: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "idempotency key already used for a different payment request", retryable: false },
    });
  });

  test("two concurrent calls with one key: the loser of the insert race replays the winner", async () => {
    const risk = riskPort("allow");
    const w = await world({ risk: { port: risk.port } });
    risk.hold();
    const a = w.service.createIntent(intent());
    const b = w.service.createIntent(intent());
    await new Promise((resolve) => setTimeout(resolve, 5));
    risk.release();
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.ok && r.replayed).sort()).toEqual([false, true]);
    expect(w.lipay.server.refundOf({ refundId: "re_1" })).toBeUndefined();
  });

  function racingLedger(ledger: PaymentsLedger, error: Error): PaymentsLedger {
    return {
      transaction: (fn) => ledger.transaction((tx) => fn(new Proxy(tx, {
        get: (target, name) => (name === "insertPayment" ? () => Promise.reject(error) : Reflect.get(target, name).bind(target)),
      }) as LedgerTx)),
    };
  }

  test("a unique failure with no winner to replay, or any other storage failure, propagates", async () => {
    const unique = new LedgerConstraintError({ kind: "unique", table: "commerce_payments" });
    const w1 = await world({ wrapLedger: (l) => racingLedger(l, unique) });
    await expect(w1.service.createIntent(intent())).rejects.toBe(unique);
    const check = new LedgerConstraintError({ kind: "check", table: "commerce_payments" });
    const w2 = await world({ wrapLedger: (l) => racingLedger(l, check) });
    await expect(w2.service.createIntent(intent())).rejects.toBe(check);
    const boom = new Error("disk full");
    const w3 = await world({ wrapLedger: (l) => racingLedger(l, boom) });
    await expect(w3.service.createIntent(intent())).rejects.toBe(boom);
  });
});

describe("createIntent: refusals write nothing", () => {
  test.each([
    ["an unusable scope", { ...intent(), scope: { ...LIPAY, workspaceId: " " } }, "INVALID_REQUEST", "scope.workspaceId must be a non-empty string"],
    ["an unregistered provider", { ...intent(), scope: { ...LIPAY, providerId: "nope" } }, "PROVIDER_NOT_REGISTERED", "no payment provider 'nope' is registered"],
    ["a zero amount", intent({ amount: USD(0) }), "INVALID_REQUEST", "amount: minorUnits must be greater than zero"],
    ["a lowercase currency", intent({ amount: { minorUnits: 1, currency: "usd" } }), "INVALID_REQUEST", "amount: currency must be an uppercase ISO-4217 alpha-3 code, got 'usd'"],
    ["a blank idempotency key", intent({ idempotencyKey: "" }), "INVALID_REQUEST", "idempotencyKey must be a non-empty string"],
    ["a blank reference", intent({ reference: "  " }), "INVALID_REQUEST", "reference must be a non-empty string"],
  ])("%s", async (_name, request, code, message) => {
    const w = await world();
    expect(await w.service.createIntent(request)).toEqual({ ok: false, error: { code, message, retryable: false } });
    expect(await w.ledger.transaction((tx) => tx.findPaymentByIdempotencyKey({ workspaceId: "ws", mode: "test", key: request.idempotencyKey }))).toBeNull();
  });

  test("a currency the provider does not accept", async () => {
    const w = await world();
    expect(await w.service.createIntent({ ...intent(), scope: SCRIPTED, amount: { minorUnits: 100, currency: "EUR" } }))
      .toMatchObject({ ok: false, error: { code: "CURRENCY_UNSUPPORTED", message: "provider 'scripted' does not accept EUR" } });
  });

  test("manual capture at a provider that only captures", async () => {
    const w = await world();
    expect(await w.service.createIntent(intent(), { captureMode: "manual" }))
      .toMatchObject({ ok: false, error: { code: "CAPABILITY_UNSUPPORTED", message: "provider 'lipay' cannot authorize without capturing" } });
  });

  test("missing credentials", async () => {
    const w = await world();
    w.failContextFor("lipay");
    expect(await w.service.createIntent(intent())).toMatchObject({ ok: false, error: { code: "NO_CREDENTIALS_CONFIGURED" } });
    expect(await w.ledger.transaction((tx) => tx.findPaymentByIdempotencyKey({ workspaceId: "ws", mode: "test", key: "ik-1" }))).toBeNull();
  });
});

describe("createIntent: risk gate", () => {
  test("deny refuses before anything is written", async () => {
    const w = await world({ risk: { port: riskPort("deny", ["velocity.party"]).port } });
    expect(await w.service.createIntent(intent(), { partyId: "party-1" })).toEqual({
      ok: false, error: { code: "RISK_DENIED", message: "the pre-charge risk gate denied this payment (velocity.party)", retryable: false },
    });
    expect(await w.ledger.transaction((tx) => tx.findPaymentByIdempotencyKey({ workspaceId: "ws", mode: "test", key: "ik-1" }))).toBeNull();
  });

  test("review authorizes only (manual capture) and is held for a person", async () => {
    const w = await world({ risk: { port: riskPort("review", ["geo.mismatch"]).port } });
    const result = await w.service.createIntent({ ...intent(), scope: SCRIPTED });
    expect(result).toMatchObject({ ok: true, risk: { verdict: "review", reasons: ["geo.mismatch"] }, payment: { status: "authorized", captured: USD(0) } });
    expect(w.scripted.calls[0]).toMatchObject({ op: "createIntent", req: { captureMode: "manual" } });
  });

  test("review at a provider that cannot authorize without capturing is refused", async () => {
    const w = await world({ risk: { port: riskPort("review", ["geo.mismatch"]).port } });
    expect(await w.service.createIntent(intent())).toMatchObject({
      ok: false, error: { code: "RISK_DENIED", message: "held for risk review (geo.mismatch), but provider 'lipay' cannot authorize without capturing" },
    });
  });

  test("allow passes the party id to the gate and the provider; the requested capture mode and provider options are kept", async () => {
    const seen: unknown[] = [];
    const port = { assess: async (input: unknown) => { seen.push(input); return { verdict: "allow" as const, reasons: [] }; } };
    const w = await world({ risk: { port } });
    const result = await w.service.createIntent({ ...intent(), scope: SCRIPTED }, { captureMode: "manual", partyId: "party-9", providerOptions: { phone: "+1" } });
    expect(result).toMatchObject({ ok: true, payment: { status: "authorized" } });
    expect(seen).toEqual([expect.objectContaining({ partyId: "party-9", amount: USD(10_000) })]);
    expect(w.scripted.calls[0]?.req).toMatchObject({ partyId: "party-9", providerOptions: { phone: "+1" }, captureMode: "manual" });
  });
});

describe("createIntent: provider answers", () => {
  test("rejected: the payment fails (no money moved) and the attempt records the error", async () => {
    const w = await world();
    w.lipay.server.script({ op: "createIntent", behaviours: ["reject"] });
    const result = await w.service.createIntent(intent());
    expect(result).toMatchObject({ ok: false, error: { code: "DECLINED", message: "card_declined" }, payment: { status: "failed" } });
    const { attempts } = await w.read((result as { payment: { id: string } }).payment.id);
    expect(attempts[0]).toMatchObject({ outcome: "rejected", errorCode: "DECLINED", errorMessage: "card_declined" });
  });

  test("unknown (timeout): the payment stays unknown, never failed (B4)", async () => {
    const w = await world();
    w.lipay.server.script({ op: "createIntent", behaviours: ["timeout"] });
    const result = await w.service.createIntent(intent());
    expect(result).toMatchObject({ ok: false, error: { code: "TRANSPORT_ERROR", retryable: true }, payment: { status: "unknown" } });
    expect((await w.read((result as { payment: { id: string } }).payment.id)).attempts[0]).toMatchObject({ outcome: "unknown" });
  });

  test.each([
    ["throws an Error", "throw", "provider threw: scripted createIntent exploded"],
    ["throws a non-Error", "throw-value", "provider threw: scripted createIntent threw a string"],
    ["answers no Outcome", "garbage", "provider returned no readable Outcome"],
    ["rejects without an error", { kind: "rejected" }, "provider returned no readable Outcome"],
    ["answers unknown without an error", { kind: "unknown" }, "provider returned no readable Outcome"],
  ])("a provider that %s is treated as unknown: money may have moved", async (_name, answer, message) => {
    const w = await world();
    w.scripted.queue("createIntent", answer as never);
    const result = await w.service.createIntent({ ...intent(), scope: SCRIPTED });
    expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR", message, retryable: true }, payment: { status: "unknown" } });
  });

  test("a response the writer quarantines: PROVIDER_ERROR, the payment stays unknown, a quarantine alert is raised", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts });
    w.scripted.queue("createIntent", { kind: "ok", value: { evidence: { providerRef: "sp_x", status: "succeeded", amount: USD(1), refunds: [], disputes: [] }, next: { kind: "none" } } });
    const result = await w.service.createIntent({ ...intent(), scope: SCRIPTED });
    expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR" }, payment: { status: "unknown" } });
    expect(alerts.raised).toEqual([expect.objectContaining({ kind: "quarantine", workspaceId: "ws", mode: "test", detail: expect.stringContaining("amount-mismatch") })]);
  });

  test("the response's next action is stored; the evidence's own next action wins over the envelope's", async () => {
    const w = await world();
    const redirect = { kind: "redirect" as const, url: "https://pay.test/3ds" };
    w.scripted.queue(
      "createIntent",
      { kind: "ok", value: { evidence: { providerRef: "sp_a", status: "requires_action", refunds: [], disputes: [] }, next: redirect } },
      { kind: "ok", value: { evidence: { providerRef: "sp_b", status: "requires_action", next: { kind: "out_of_band" }, refunds: [], disputes: [] }, next: redirect } },
    );
    expect(await w.service.createIntent({ ...intent(), scope: SCRIPTED })).toMatchObject({ ok: true, payment: { status: "requires_action", next: redirect } });
    expect(await w.service.createIntent({ ...intent({ idempotencyKey: "ik-2" }), scope: SCRIPTED })).toMatchObject({ ok: true, payment: { next: { kind: "out_of_band" } } });
  });

  test("an applied response whose refunds were partly quarantined still succeeds, with an alert (a failing sink changes nothing)", async () => {
    const alerts = recordingAlerts({ fail: true });
    const w = await world({ alerts });
    w.scripted.queue("createIntent", {
      kind: "ok",
      value: {
        evidence: { providerRef: "sp_r", status: "succeeded", refunds: [{ providerRefundRef: "r1", amount: { minorUnits: 5, currency: "EUR" }, status: "succeeded" }], disputes: [] },
        next: { kind: "none" },
      },
    });
    expect(await w.service.createIntent({ ...intent(), scope: SCRIPTED })).toMatchObject({ ok: true, payment: { status: "succeeded" } });
    expect(alerts.raised).toEqual([expect.objectContaining({ kind: "quarantine", detail: expect.stringContaining("currency-mismatch") })]);
  });

  test("rejected / unknown from the scripted provider (defaults otherwise)", async () => {
    const w = await world();
    w.scripted.queue("createIntent", rejected(), timedOut());
    expect(await w.service.createIntent({ ...intent(), scope: SCRIPTED })).toMatchObject({ ok: false, payment: { status: "failed" } });
    expect(await w.service.createIntent({ ...intent({ idempotencyKey: "ik-2" }), scope: SCRIPTED })).toMatchObject({ ok: false, payment: { status: "unknown" } });
  });
});
