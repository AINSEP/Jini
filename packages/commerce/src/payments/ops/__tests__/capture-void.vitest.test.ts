import { describe, expect, test } from "vitest";

import { paymentError } from "../../contract/provider.js";
import type { LedgerTx, PaymentsLedger } from "../../ledger/repo.js";
import { LIPAY, NOW, SCRIPTED, USD, authorizedScripted, paidLipay, recordingAlerts, rejected, timedOut, world, type World } from "./harness.js";

/**
 * @file `PaymentsPort.capture` / `void`: the refund skeleton on an authorization — grant re-check,
 * idempotency by attempt key, capability and state checks, provider answers.
 */

const captureGrant = (w: World, paymentId: string, minorUnits: number, key = "ck-1") =>
  w.grant({ op: "capture", paymentId, amount: USD(minorUnits), idempotencyKey: key, scope: SCRIPTED });
const voidGrant = (w: World, paymentId: string, key = "vk-1") => w.grant({ op: "void", paymentId, amount: null, idempotencyKey: key, scope: SCRIPTED });

for (const ledgerKind of ["memory", "sqlite"] as const) {
  describe(`capture and void on ${ledgerKind}`, () => {
    test("capturing a held authorization completes the payment", async () => {
      const w = await world({ ledgerKind });
      const held = await authorizedScripted(w);
      const result = await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(6_000), idempotencyKey: "ck-1", grant: await captureGrant(w, held.id, 6_000) });
      expect(result).toMatchObject({ ok: true, replayed: false, risk: { reasons: ["not-assessed"] }, payment: { status: "succeeded", captured: USD(6_000) } });
      const { attempts } = await w.read(held.id);
      // The requested amount is stored on the attempt (0004): a replay of the key is compared against it.
      expect(attempts.at(-1)).toMatchObject({ op: "capture", operationKey: "capture:ck-1", outcome: "ok", currency: "USD", amountMinor: 6_000 });
      expect(w.scripted.calls.at(-1)).toMatchObject({ op: "capture", req: { providerRef: `sp_${held.id}`, amount: USD(6_000), idempotencyKey: attempts.at(-1)!.id } });
    });

    test("voiding a held authorization cancels it", async () => {
      const w = await world({ ledgerKind });
      const held = await authorizedScripted(w);
      expect(await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: "vk-1", grant: await voidGrant(w, held.id) }))
        .toMatchObject({ ok: true, payment: { status: "canceled" } });
      expect((await w.read(held.id)).attempts.at(-1)).toMatchObject({ op: "void", currency: null, amountMinor: null });
    });
  });
}

describe("capture/void: idempotency", () => {
  test("the same key on the same payment replays; on another payment it conflicts", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    const other = await authorizedScripted(w, "ik-other");
    await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(10_000), idempotencyKey: "ck-1", grant: await captureGrant(w, held.id, 10_000) });
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(10_000), idempotencyKey: "ck-1", grant: "spent" }))
      .toMatchObject({ ok: true, replayed: true, risk: { reasons: ["idempotent-replay"] }, payment: { status: "succeeded" } });
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: other.id, amount: USD(10_000), idempotencyKey: "ck-1", grant: "g" }))
      .toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "idempotency key already used for a different capture request" } });
    expect(w.scripted.calls.filter((c) => c.op === "capture")).toHaveLength(1);
  });

  test("the same key on the same payment with a different amount or currency is a conflict, not a replay", async () => {
    const w = await world({ scripted: { currencies: ["USD", "EUR"] } });
    const held = await authorizedScripted(w);
    await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(6_000), idempotencyKey: "ck-1", grant: await captureGrant(w, held.id, 6_000) });
    const conflict = { ok: false, error: { code: "IDEMPOTENCY_CONFLICT", message: "idempotency key already used for a different capture request" } };
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(9_000), idempotencyKey: "ck-1", grant: "g" })).toMatchObject(conflict);
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: { minorUnits: 6_000, currency: "EUR" }, idempotencyKey: "ck-1", grant: "g" })).toMatchObject(conflict);
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(6_000), idempotencyKey: "ck-1", grant: "g" })).toMatchObject({ ok: true, replayed: true });
    expect(w.scripted.calls.filter((c) => c.op === "capture")).toHaveLength(1);
  });

  test("a capture attempt recorded before amounts were stored (NULL amount) replays on the payment alone", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(6_000), idempotencyKey: "ck-1", grant: await captureGrant(w, held.id, 6_000) });
    const [legacy] = (await w.read(held.id)).attempts.filter((a) => a.op === "capture");
    // Simulate a pre-0004 row: same key, no amount on record.
    await w.ledger.transaction({ fn: (tx) => tx.insertAttempt({ attempt: { ...legacy!, id: "att_legacy", operationKey: "capture:ck-old", currency: null, amountMinor: null } }) });
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(1), idempotencyKey: "ck-old", grant: "g" })).toMatchObject({ ok: true, replayed: true });
  });

  test("an idempotency race lost at the attempt insert turns into the winner's replay", async () => {
    let blind = false;
    const wrap = (ledger: PaymentsLedger): PaymentsLedger => ({
      transaction: ({ fn }) => ledger.transaction({ fn: (tx) => fn(new Proxy(tx, {
        get: (target, name) => (blind && name === "findAttemptByOperationKey"
          ? () => { blind = false; return Promise.resolve(null); }
          : Reflect.get(target, name).bind(target)),
      }) as LedgerTx) }),
    });
    const w = await world({ wrapLedger: wrap });
    const held = await authorizedScripted(w);
    // A first void under vk-1 is rejected: the authorization stays, the attempt row holds the key.
    w.scripted.queue("void", rejected());
    await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: "vk-1", grant: await voidGrant(w, held.id) });
    blind = true;
    // The blind lookup lets a second call with vk-1 reach the attempt insert, as a concurrent call would.
    const result = await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: "vk-1", grant: await voidGrant(w, held.id) });
    // The winner's attempt was rejected, so the replay reports that rejection, never success (C-1).
    expect(result).toMatchObject({ ok: false, error: { code: "DECLINED", retryable: false }, payment: { status: "authorized" } });
    expect(w.scripted.calls.filter((c) => c.op === "void")).toHaveLength(1);
  });
});

describe("capture/void: refusals", () => {
  test("providers without the capability, or promising it without the method", async () => {
    const plain = await world();
    expect(await plain.service.capture({ scope: LIPAY, paymentId: "p", amount: USD(1), idempotencyKey: "k", grant: "g" }))
      .toMatchObject({ ok: false, error: { code: "CAPABILITY_UNSUPPORTED", message: "provider 'lipay' does not support capture" } });
    expect(await plain.service.void({ scope: LIPAY, paymentId: "p", idempotencyKey: "k", grant: "g" }))
      .toMatchObject({ ok: false, error: { code: "CAPABILITY_UNSUPPORTED", message: "provider 'lipay' does not support void" } });
    const hollow = await world({ scriptedOmit: ["capture", "void"] });
    expect(await hollow.service.capture({ scope: SCRIPTED, paymentId: "p", amount: USD(1), idempotencyKey: "k", grant: "g" })).toMatchObject({ error: { code: "CAPABILITY_UNSUPPORTED" } });
    expect(await hollow.service.void({ scope: SCRIPTED, paymentId: "p", idempotencyKey: "k", grant: "g" })).toMatchObject({ error: { code: "CAPABILITY_UNSUPPORTED" } });
  });

  test.each([
    ["an unregistered provider", { scope: { ...SCRIPTED, providerId: "gone" } }, "PROVIDER_NOT_REGISTERED", "no payment provider 'gone' is registered"],
    ["a bad amount", { amount: USD(-1) }, "INVALID_REQUEST", "amount: minorUnits must be greater than zero"],
    ["a blank key", { idempotencyKey: " " }, "INVALID_REQUEST", "idempotencyKey must be a non-empty string"],
    ["an unknown payment", { paymentId: "nope" }, "INVALID_REQUEST", "payment 'nope' not found in this scope"],
    ["more than was authorized", { amount: USD(10_001) }, "INVALID_REQUEST", "capture must be in USD and at most the authorized 10000 minor units"],
    ["a bad grant", { grant: "forged" }, "GRANT_INVALID", "the capture grant is missing, expired, used or bound to another request"],
  ])("capture: %s", async (_name, change, code, message) => {
    const w = await world();
    const held = await authorizedScripted(w);
    const request = { scope: SCRIPTED, paymentId: held.id, amount: USD(5_000), idempotencyKey: "ck-1", grant: "", ...change };
    const grant = change.grant ?? await w.grant({ op: "capture", paymentId: request.paymentId, amount: request.amount, idempotencyKey: request.idempotencyKey, scope: SCRIPTED });
    expect(await w.service.capture({ ...request, grant })).toEqual({ ok: false, error: { code, message, retryable: false } });
    expect((await w.read(held.id)).payment?.intentStatus).toBe("authorized");
  });

  test("capture in another currency (the provider accepts it, the payment is not in it)", async () => {
    const w = await world({ scripted: { currencies: "any" } });
    const held = await authorizedScripted(w);
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: { minorUnits: 5, currency: "EUR" }, idempotencyKey: "ck", grant: "g" }))
      .toMatchObject({ ok: false, error: { message: "capture must be in USD and at most the authorized 10000 minor units" } });
  });

  test("an already captured payment cannot be captured again", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    const sw = await world({ scripted: { capture: "manual" } });
    const done = await sw.service.createIntent({ scope: SCRIPTED, amount: USD(100), idempotencyKey: "ik", reference: "o" });
    const id = (done as { payment: { id: string } }).payment.id;
    expect(await sw.service.capture({ scope: SCRIPTED, paymentId: id, amount: USD(100), idempotencyKey: "ck", grant: "g" }))
      .toMatchObject({ ok: false, error: { message: "cannot capture a payment that is succeeded" } });
    expect(paid.status).toBe("succeeded");
  });

  test("missing credentials", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    w.failContextFor("scripted");
    expect(await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: "vk", grant: "g" })).toMatchObject({ ok: false, error: { code: "NO_CREDENTIALS_CONFIGURED" } });
  });

  test("an invalid void scope fails before any authorization is released", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    expect(await w.service.void({ scope: { ...SCRIPTED, siteId: " " }, paymentId: held.id, idempotencyKey: "vk", grant: "g" }))
      .toEqual({ ok: false, error: { code: "INVALID_REQUEST", message: "scope.siteId must be a non-empty string", retryable: false } });
    expect(w.scripted.calls.map((c) => c.op)).toEqual(["createIntent"]);
    expect((await w.read(held.id)).payment).toMatchObject({ intentStatus: "authorized", capturedMinor: 0 });
  });
});

describe("capture/void: provider answers", () => {
  test("a rejected capture leaves the authorization as it was and records the attempt", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    w.scripted.queue("capture", rejected());
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(100), idempotencyKey: "ck-1", grant: await captureGrant(w, held.id, 100) }))
      .toMatchObject({ ok: false, error: { code: "DECLINED" }, payment: { status: "authorized" } });
    expect((await w.read(held.id)).attempts.at(-1)).toMatchObject({ op: "capture", outcome: "rejected", errorCode: "DECLINED" });
  });

  test("a rejected capture replayed under the same key reports the rejection, not success, and moves no money (C-1)", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    // A rate-limit rejection says a same-key retry may succeed; once rejected, this key can only replay.
    w.scripted.queue("capture", { kind: "rejected", error: paymentError({ code: "PROVIDER_ERROR", message: "rate limited" }, { retryable: true }) });
    const first = await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(100), idempotencyKey: "ck-1", grant: await captureGrant(w, held.id, 100) });
    expect(first).toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR", retryable: false } });
    const again = await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(100), idempotencyKey: "ck-1", grant: "g" });
    expect(again).toEqual({
      ok: false, payment: expect.objectContaining({ status: "authorized" }),
      error: { code: "PROVIDER_ERROR", message: "rate limited (replayed: the earlier capture under this idempotencyKey was rejected and moved no money; a new attempt needs a new idempotencyKey)", retryable: false },
    });
    expect(w.scripted.calls.filter((c) => c.op === "capture")).toHaveLength(1);
  });

  test("a void response the writer quarantines is PROVIDER_ERROR with an alert", async () => {
    const alerts = recordingAlerts();
    const w = await world({ alerts });
    const held = await authorizedScripted(w);
    w.scripted.queue("void", { kind: "ok", value: { providerRef: "sp_someone_else", status: "canceled", refunds: [], disputes: [] } });
    expect(await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: "vk-1", grant: await voidGrant(w, held.id) }))
      .toMatchObject({ ok: false, error: { code: "PROVIDER_ERROR" }, payment: { status: "authorized" } });
    expect(alerts.raised).toEqual([expect.objectContaining({ kind: "quarantine", paymentId: held.id, detail: expect.stringContaining("ref-conflict") })]);
  });
});

describe("capture/void: an ambiguous outcome blocks a conflicting dispatch until it is reconciled", () => {
  test("a capture that timed out blocks a void (retryable, the grant is NOT spent); a dispatched void blocks a capture", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    w.scripted.queue("capture", timedOut());
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(100), idempotencyKey: "ck-1", grant: await captureGrant(w, held.id, 100) }))
      .toMatchObject({ ok: false, error: { code: "TRANSPORT_ERROR" }, payment: { status: "authorized" } });
    const grant = await voidGrant(w, held.id);
    const blocked = await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: "vk-1", grant });
    expect(blocked).toMatchObject({
      ok: false, error: { code: "INVALID_REQUEST", retryable: true, message: "a capture of this payment is still unresolved; retry once it is reconciled" },
    });
    expect(w.scripted.calls.filter((c) => c.op === "void")).toHaveLength(0);
    // The capture's own key still replays (it is the same request, not a conflicting one).
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(100), idempotencyKey: "ck-1", grant: "g" })).toMatchObject({ ok: true, replayed: true });
    // Resolved (here: the provider's answer finally recorded): the same grant now works.
    const [open] = (await w.read(held.id)).attempts.filter((a) => a.op === "capture");
    await w.ledger.transaction({ fn: (tx) => tx.updateAttempt({ id: open!.id, patch: { outcome: "rejected", updatedAt: NOW } }) });
    expect(await w.service.void({ scope: SCRIPTED, paymentId: held.id, idempotencyKey: "vk-1", grant })).toMatchObject({ ok: true, payment: { status: "canceled" } });
  });

  test("a void left dispatched (a crash before its provider call) blocks a capture", async () => {
    const w = await world();
    const held = await authorizedScripted(w);
    const [intent] = (await w.read(held.id)).attempts;
    await w.ledger.transaction({ fn: (tx) => tx.insertAttempt({ attempt: { ...intent!, id: "att_v", op: "void", operationKey: "void:vk-0", outcome: "dispatched" } }) });
    expect(await w.service.capture({ scope: SCRIPTED, paymentId: held.id, amount: USD(100), idempotencyKey: "ck-1", grant: await captureGrant(w, held.id, 100) }))
      .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST", message: "a void of this payment is still unresolved; retry once it is reconciled" } });
  });
});
