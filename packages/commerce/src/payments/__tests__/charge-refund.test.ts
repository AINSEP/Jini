/**
 * @file Outbound charge and refund: idempotency, capability gating, and the aggregate money
 * invariants the schema cannot express.
 *
 * The adversarial cases here are the ones that only fail across MULTIPLE records: a replayed
 * charge, a reused key carrying different money, and partial refunds that individually pass but
 * together exceed the payment. `amount_refunded_minor <= amount_minor` has no CHECK constraint
 * behind it, so it holds only if this chokepoint holds.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { HttpRequest } from "@jini-ai/core/primitives";
import { InMemoryPaymentCredentials } from "../credentials.js";
import { activateLipay } from "./storage.js";
import type { PaymentProvider } from "../ports.js";
import {
  chargeOk,
  cleanup,
  FakeHttpClient,
  makeLipay,
  refundOk,
  SECRET_KEY,
  tempDb,
  TestClock,
  testIdGen,
  WORKSPACE_ID,
} from "./support.js";

const USD = (minorUnits: number) => ({ minorUnits, currency: "USD" });

test("charge: a successful charge shapes a real request and records a payment row", async () => {
  const { api, db, dir, http } = await makeLipay({ responses: [chargeOk("ch_1", "pending")] });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
    reference: "order-1",
    customer: { email: "buyer@example.com" },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payment.status, "pending");
    assert.equal(result.payment.providerRef, "ch_1");
    assert.equal(result.payment.amount.currency, "USD");
    assert.equal(result.payment.amountRefundedMinor, 0);
    assert.deepEqual(result.next, { kind: "redirect", url: "https://lipay.test/checkout/ch_1" });
    assert.equal(result.replayed, false);
  }

  assert.equal(http.calls.length, 1);
  const call = http.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://lipay.test/v1/charges");
  assert.equal(call.headers.authorization, `Bearer ${SECRET_KEY}`);
  assert.equal(call.headers["idempotency-key"], "order-1");
  assert.deepEqual(JSON.parse(call.body ?? "{}"), {
    amount: 2500,
    currency: "USD",
    reference: "order-1",
    customer: { email: "buyer@example.com" },
    callback_url: "https://site.test/payments/webhook/lipay",
    return_url: "https://site.test/checkout/return",
  });

  cleanup(db, dir);
});

test("charge: providerOptions, when supplied, are forwarded verbatim into the outbound provider request", async () => {
  const { api, db, dir, http } = await makeLipay({ responses: [chargeOk("ch_1", "pending")] });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
    providerOptions: { phoneNumber: "+254700000000" },
  });

  assert.equal(result.ok, true);
  const body = JSON.parse(http.calls[0]?.body ?? "{}");
  assert.equal(body.phoneNumber, "+254700000000", "provider-specific options reach the gateway's request body");

  cleanup(db, dir);
});

test("charge: replaying an idempotency key returns the original payment and never calls the provider twice", async () => {
  const { api, db, dir, http } = await makeLipay({ responses: [chargeOk("ch_1")] });
  const request = {
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  } as const;

  const first = await api.charge(request);
  const second = await api.charge(request);

  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(second.payment.id, first.payment.id);
    assert.equal(second.replayed, true);
    // Disclosed consequence of §3's schema: the next-action is transport state with no column.
    assert.equal(second.next, null);
  }
  assert.equal(http.calls.length, 1, "the provider was called exactly once for two identical requests");
  assert.equal((await api.listPayments({ workspaceId: WORKSPACE_ID })).length, 1);

  cleanup(db, dir);
});

test("charge: the same key with a different amount is a conflict, not a silent replay", async () => {
  const { api, db, dir, http } = await makeLipay({ responses: [chargeOk("ch_1")] });

  await api.charge({ workspaceId: WORKSPACE_ID, providerId: "lipay", amount: USD(2500), idempotencyKey: "order-1" });
  const conflict = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(9900),
    idempotencyKey: "order-1",
  });

  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(http.calls.length, 1);

  cleanup(db, dir);
});

test("charge: the same key with a different currency is also a conflict", async () => {
  const { api, db, dir } = await makeLipay({ responses: [chargeOk("ch_1")] });

  await api.charge({ workspaceId: WORKSPACE_ID, providerId: "lipay", amount: USD(2500), idempotencyKey: "order-1" });
  const conflict = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: { minorUnits: 2500, currency: "EUR" },
    idempotencyKey: "order-1",
  });

  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");

  cleanup(db, dir);
});

test("charge: a missing credential bundle fails before any HTTP call and writes no payment row", async () => {
  const { api, db, dir, http } = await makeLipay({ credentials: new InMemoryPaymentCredentials() });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "NO_CREDENTIALS_CONFIGURED");
    assert.equal(result.payment, null);
  }
  assert.equal(http.calls.length, 0);
  assert.equal((await api.listPayments({ workspaceId: WORKSPACE_ID })).length, 0, "no attempt was possible, so none is recorded");

  cleanup(db, dir);
});

test("charge: malformed money is rejected before the provider is reached", async () => {
  const { api, db, dir, http } = await makeLipay();

  for (const amount of [
    { minorUnits: 0, currency: "USD" },
    { minorUnits: -100, currency: "USD" },
    { minorUnits: 10.5, currency: "USD" },
    { minorUnits: 100, currency: "usd" },
    { minorUnits: 100, currency: "DOLLARS" },
  ]) {
    const result = await api.charge({
      workspaceId: WORKSPACE_ID,
      providerId: "lipay",
      amount,
      idempotencyKey: `k-${amount.minorUnits}-${amount.currency}`,
    });
    assert.equal(result.ok, false, `${JSON.stringify(amount)} should have been rejected`);
    if (!result.ok) assert.equal(result.error.code, "INVALID_REQUEST");
  }
  assert.equal(http.calls.length, 0);

  cleanup(db, dir);
});

test("charge: a currency the provider does not accept is refused by core, not by the provider", async () => {
  const kesOnly: PaymentProvider = {
    id: "m-pesa",
    displayName: "M-Pesa",
    credentialKeys: ["secretKey"],
    capabilities: {
      refunds: "none",
      tokenization: false,
      recurring: false,
      confirmation: ["out_of_band"],
      currencies: ["KES"],
      webhooks: true,
    },
    async createCharge() {
      throw new Error("core must not reach the provider for an unsupported currency");
    },
    async parseWebhook() {
      return { ok: true, events: [] };
    },
  };

  const { api, db, dir } = await makeLipay({
    providers: [kesOnly],
    credentials: new InMemoryPaymentCredentials({ "m-pesa": { secretKey: "sk" } }),
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "m-pesa",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "CURRENCY_UNSUPPORTED");

  cleanup(db, dir);
});

test("charge: a declined charge is a typed DECLINED and marks the payment failed, never a throw", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [{ status: 402, headers: {}, bodyText: JSON.stringify({ error: { code: "card_declined", message: "Card was declined." } }) }],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DECLINED");
    assert.equal(result.error.retryable, false);
    assert.equal(result.payment?.status, "failed");
    assert.match(result.payment?.lastError ?? "", /DECLINED/);
  }

  cleanup(db, dir);
});

test("charge: a transport failure is typed and retryable, and the attempt is still recorded", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      () => {
        throw new Error("egress refused: private address");
      },
    ],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "TRANSPORT_ERROR");
    assert.equal(result.error.retryable, true);
    assert.equal(result.payment?.status, "failed");
  }
  assert.equal((await api.listPayments({ workspaceId: WORKSPACE_ID })).length, 1);

  cleanup(db, dir);
});

test("charge: a 5xx is retryable while a 4xx is not", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      { status: 503, headers: {}, bodyText: "upstream unavailable" },
      { status: 400, headers: {}, bodyText: JSON.stringify({ error: { code: "bad_request", message: "nope" } }) },
    ],
  });

  const first = await api.charge({ workspaceId: WORKSPACE_ID, providerId: "lipay", amount: USD(100), idempotencyKey: "a" });
  const second = await api.charge({ workspaceId: WORKSPACE_ID, providerId: "lipay", amount: USD(100), idempotencyKey: "b" });

  assert.equal(first.ok, false);
  if (!first.ok) {
    assert.equal(first.error.code, "PROVIDER_ERROR");
    assert.equal(first.error.retryable, true);
    assert.equal(first.error.providerStatus, 503);
  }
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error.retryable, false);

  cleanup(db, dir);
});

test("charge: workspace scoping — another workspace cannot read the payment", async () => {
  const { api, db, dir } = await makeLipay({ responses: [chargeOk("ch_1")] });

  const created = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.notEqual((await api.getPayment({ workspaceId: WORKSPACE_ID, id: created.payment.id })), null);
  assert.equal((await api.getPayment({ workspaceId: "workspace-2", id: created.payment.id })), null);
  assert.equal((await api.listPayments({ workspaceId: "workspace-2" })).length, 0);

  cleanup(db, dir);
});

test("charge: payment history is newest-first, workspace-scoped, and honors explicit limits", async () => {
  const { api, db, dir, clock } = await makeLipay({ responses: [chargeOk("ch_1"), chargeOk("ch_2"), chargeOk("ch_other"), chargeOk("ch_3")] });
  try {
    const expected = [];
    for (const [key, workspaceId] of [["old", WORKSPACE_ID], ["middle", WORKSPACE_ID], ["other", "workspace-2"], ["new", WORKSPACE_ID]]) {
      clock.advance(1000);
      const result = await api.charge({ workspaceId, providerId: "lipay", amount: USD(2500), idempotencyKey: key });
      assert.ok(result.ok);
      if (workspaceId === WORKSPACE_ID) expected.unshift(result.payment);
    }
    assert.deepEqual(await api.listPayments({ workspaceId: WORKSPACE_ID }), expected);
    assert.deepEqual(await api.listPayments({ workspaceId: WORKSPACE_ID }, { limit: 2 }), expected.slice(0, 2));
    assert.deepEqual(await api.listPayments({ workspaceId: WORKSPACE_ID }, { limit: 1 }), expected.slice(0, 1));
    const other = await api.listPayments({ workspaceId: "workspace-2" });
    assert.deepEqual(other.map(row => row.idempotencyKey), ["other"]);
    assert.equal(other[0].workspaceId, "workspace-2");
  } finally {
    cleanup(db, dir);
  }
});

async function succeededPayment(responses: readonly unknown[]) {
  const harness = await makeLipay({ responses: responses as never });
  const created = await harness.api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(1000),
    idempotencyKey: "order-1",
  });
  if (!created.ok) throw new Error("charge fixture failed");
  return { ...harness, payment: created.payment };
}

test("refund: a partial refund moves the payment to partially_refunded and accumulates the total", async () => {
  const { api, db, dir, payment, http } = await succeededPayment([chargeOk("ch_1", "succeeded"), refundOk("re_1"), refundOk("re_2")]);
  assert.equal(payment.status, "succeeded");

  const first = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "refund-1",
    amount: USD(400),
    reason: "partial return",
  });

  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.payment.status, "partially_refunded");
    assert.equal(first.payment.amountRefundedMinor, 400);
    assert.equal(first.refund.status, "succeeded");
    assert.equal(first.refund.providerRef, "re_1");
  }

  assert.equal(http.calls.length, 2);
  const call = http.calls[1];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://lipay.test/v1/charges/ch_1/refunds");
  assert.equal(call.headers.authorization, `Bearer ${SECRET_KEY}`);
  assert.equal(call.headers["idempotency-key"], "refund-1");
  assert.equal(call.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(call.body ?? "{}"), { amount: 400, currency: "USD", reason: "partial return" });

  const second = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "refund-2",
    amount: USD(600),
  });

  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.payment.status, "refunded");
    assert.equal(second.payment.amountRefundedMinor, 1000);
  }

  cleanup(db, dir);
});

test("refund: the charge reference is encoded as one URL segment", async () => {
  const { api, db, dir, payment, http } = await succeededPayment([chargeOk("ch/a ?#", "succeeded"), refundOk("re_1")]);
  try {
    const result = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "encoded-refund", amount: USD(100) });
    assert.ok(result.ok);
    assert.equal(http.calls[1].url, "https://lipay.test/v1/charges/ch%2Fa%20%3F%23/refunds");
  } finally {
    cleanup(db, dir);
  }
});

test("refund: partial refunds that individually pass but together exceed the payment are rejected", async () => {
  const { api, db, dir, payment, http } = await succeededPayment([
    chargeOk("ch_1", "succeeded"),
    refundOk("re_1"),
    refundOk("re_2"),
  ]);

  const first = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r1", amount: USD(700) });
  assert.equal(first.ok, true);

  const callsBefore = http.calls.length;
  const overshoot = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r2",
    amount: USD(700),
  });

  assert.equal(overshoot.ok, false);
  if (!overshoot.ok) {
    assert.equal(overshoot.error.code, "INVALID_REQUEST");
    assert.match(overshoot.error.message, /exceeds the 300 still refundable/);
  }
  assert.equal(http.calls.length, callsBefore, "the over-refund never reached the provider");
  assert.equal((await api.getPayment({ workspaceId: WORKSPACE_ID, id: payment.id }))?.amountRefundedMinor, 700);

  cleanup(db, dir);
});

test("refund: omitting the amount refunds exactly what remains", async () => {
  const { api, db, dir, payment } = await succeededPayment([
    chargeOk("ch_1", "succeeded"),
    refundOk("re_1"),
    refundOk("re_2"),
  ]);

  await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r1", amount: USD(250) });
  const rest = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r2" });

  assert.equal(rest.ok, true);
  if (rest.ok) {
    assert.equal(rest.refund.amount.minorUnits, 750);
    assert.equal(rest.payment.status, "refunded");
    assert.equal(rest.payment.amountRefundedMinor, 1000);
  }

  cleanup(db, dir);
});

test("refund: replaying a refund key returns the stored refund without calling the provider again", async () => {
  const { api, db, dir, payment, http } = await succeededPayment([chargeOk("ch_1", "succeeded"), refundOk("re_1")]);

  const first = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r1", amount: USD(400) });
  const callsAfterFirst = http.calls.length;
  const replay = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r1", amount: USD(400) });

  assert.equal(first.ok && replay.ok, true);
  if (first.ok && replay.ok) {
    assert.equal(replay.refund.id, first.refund.id);
    assert.equal(replay.replayed, true);
  }
  assert.equal(http.calls.length, callsAfterFirst);
  assert.equal((await api.getPayment({ workspaceId: WORKSPACE_ID, id: payment.id }))?.amountRefundedMinor, 400);

  cleanup(db, dir);
});

test("refund: reusing a refund key for a different amount is a conflict", async () => {
  const { api, db, dir, payment } = await succeededPayment([chargeOk("ch_1", "succeeded"), refundOk("re_1")]);

  await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r1", amount: USD(400) });
  const conflict = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: USD(500),
  });

  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");

  cleanup(db, dir);
});

test("refund: a pending payment cannot be refunded", async () => {
  const { api, db, dir } = await makeLipay({ responses: [chargeOk("ch_1", "pending")] });
  const created = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(1000),
    idempotencyKey: "order-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const result = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: created.payment.id, idempotencyKey: "r1" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_REQUEST");
    assert.match(result.error.message, /status 'pending' cannot be refunded/);
  }

  cleanup(db, dir);
});

test("refund: a provider that declares full-refunds-only rejects a partial one before any HTTP", async () => {
  let refundCalls = 0;
  const fullOnly: PaymentProvider = {
    id: "acme",
    displayName: "Acme",
    credentialKeys: ["secretKey"],
    capabilities: {
      refunds: "full",
      tokenization: false,
      recurring: false,
      confirmation: ["none"],
      currencies: "any",
      webhooks: false,
    },
    async createCharge() {
      return { ok: true, providerRef: "acme_1", status: "succeeded", next: { kind: "none" } };
    },
    async refund() {
      refundCalls += 1;
      return { ok: true, providerRef: "acme_re_1", status: "succeeded" };
    },
    async parseWebhook() {
      return { ok: true, events: [] };
    },
  };

  const { api, db, dir } = await makeLipay({
    providers: [fullOnly],
    credentials: new InMemoryPaymentCredentials({ acme: { secretKey: "sk" } }),
  });
  const created = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "acme",
    amount: USD(1000),
    idempotencyKey: "order-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const partial = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: created.payment.id,
    idempotencyKey: "r1",
    amount: USD(400),
  });
  assert.equal(partial.ok, false);
  if (!partial.ok) assert.equal(partial.error.code, "CAPABILITY_UNSUPPORTED");
  assert.equal(refundCalls, 0);

  const full = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: created.payment.id,
    idempotencyKey: "r2",
    amount: USD(1000),
  });
  assert.equal(full.ok, true);
  assert.equal(refundCalls, 1);

  cleanup(db, dir);
});

test("refund: a provider that declares no refund support is refused by core", async () => {
  const noRefunds: PaymentProvider = {
    id: "acme",
    displayName: "Acme",
    credentialKeys: ["secretKey"],
    capabilities: {
      refunds: "none",
      tokenization: false,
      recurring: false,
      confirmation: ["none"],
      currencies: "any",
      webhooks: false,
    },
    async createCharge() {
      return { ok: true, providerRef: "acme_1", status: "succeeded", next: { kind: "none" } };
    },
    async parseWebhook() {
      return { ok: true, events: [] };
    },
  };

  const { api, db, dir } = await makeLipay({
    providers: [noRefunds],
    credentials: new InMemoryPaymentCredentials({ acme: { secretKey: "sk" } }),
  });
  const created = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "acme",
    amount: USD(1000),
    idempotencyKey: "order-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const result = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: created.payment.id, idempotencyKey: "r1" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "CAPABILITY_UNSUPPORTED");

  cleanup(db, dir);
});

test("charge: an empty or whitespace-only idempotency key is rejected before any HTTP call", async () => {
  const { api, db, dir, http } = await makeLipay();

  for (const idempotencyKey of ["", "   ", "\t\n"]) {
    const result = await api.charge({
      workspaceId: WORKSPACE_ID,
      providerId: "lipay",
      amount: USD(2500),
      idempotencyKey,
    });
    assert.equal(result.ok, false, `${JSON.stringify(idempotencyKey)} should have been rejected`);
    if (!result.ok) assert.equal(result.error.code, "INVALID_REQUEST");
  }
  assert.equal(http.calls.length, 0);

  cleanup(db, dir);
});

test("charge: two concurrent charges racing the same idempotency key resolve to one payment, not a crash", async () => {
  const { api, db, dir, http } = await makeLipay({ responses: [chargeOk("ch_1", "pending")] });
  const request = {
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "race-1",
  } as const;

  // Both calls run their synchronous prefix (including the upfront "does this key already exist?"
  // read) before either reaches the first `await` — the same interleaving window a real double-click
  // or client retry racing an in-flight request produces on one Node process.
  const [first, second] = await Promise.all([api.charge(request), api.charge(request)]);

  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.payment.id, second.payment.id, "both concurrent calls resolve to the SAME payment row");
    assert.equal(
      [first.replayed, second.replayed].filter((replayed) => replayed).length,
      1,
      "exactly one of the two lost the race to the UNIQUE index and was reconciled, not both"
    );
  }
  assert.equal(http.calls.length, 1, "only the race's winner ever reached the provider");
  assert.equal((await api.listPayments({ workspaceId: WORKSPACE_ID })).length, 1, "no duplicate payment row from the race");

  cleanup(db, dir);
});

test("refund: malformed amount is rejected before the provider is reached", async () => {
  const { api, db, dir, http, payment } = await succeededPayment([chargeOk("ch_1", "succeeded")]);

  for (const amount of [
    { minorUnits: 0, currency: "USD" },
    { minorUnits: -100, currency: "USD" },
    { minorUnits: 10.5, currency: "USD" },
    { minorUnits: 100, currency: "usd" },
    { minorUnits: 100, currency: "DOLLARS" },
  ]) {
    const result = await api.refund({
      workspaceId: WORKSPACE_ID,
      paymentId: payment.id,
      idempotencyKey: `k-${amount.minorUnits}-${amount.currency}`,
      amount,
    });
    assert.equal(result.ok, false, `${JSON.stringify(amount)} should have been rejected`);
    if (!result.ok) assert.equal(result.error.code, "INVALID_REQUEST");
  }
  assert.equal(http.calls.length, 1, "only the original charge reached the provider; no refund attempt did");

  cleanup(db, dir);
});

test("refund: a currency different from the original charge's is refused, not silently converted", async () => {
  const { api, db, dir, payment } = await succeededPayment([chargeOk("ch_1", "succeeded")]);

  const result = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: { minorUnits: 100, currency: "EUR" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CURRENCY_UNSUPPORTED");
    assert.match(result.error.message, /does not match the payment's USD/);
  }

  cleanup(db, dir);
});

test("refund: a missing credential bundle fails before any HTTP call, mirroring charge's own gate", async () => {
  const { api, db, dir, http, credentials, payment } = await succeededPayment([chargeOk("ch_1", "succeeded")]);
  credentials.set({ providerId: "lipay", bundle: null });

  const result = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: USD(400),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "NO_CREDENTIALS_CONFIGURED");
  assert.equal(http.calls.length, 1, "only the original charge reached the provider; the refund never did");

  cleanup(db, dir);
});

const refundRows = (db: import("better-sqlite3").Database) =>
  db.prepare(`SELECT * FROM "p_lipay__refunds" ORDER BY created_at, id`).all() as {
    id: string;
    payment_id: string;
    status: string;
    provider_ref: string | null;
  }[];

test("refund: a provider-side failure marks the refund row failed, never a throw", async () => {
  const { api, db, dir, payment } = await succeededPayment([
    chargeOk("ch_1", "succeeded"),
    { status: 500, headers: {}, bodyText: "upstream unavailable" },
  ]);

  const result = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: USD(400),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROVIDER_ERROR");
    assert.equal(result.error.retryable, true);
  }
  const rows = refundRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed");
  // The payment itself is untouched by a refund attempt that never reached the provider successfully.
  assert.equal((await api.getPayment({ workspaceId: WORKSPACE_ID, id: payment.id }))?.amountRefundedMinor, 0);

  cleanup(db, dir);
});

test("refund: a provider-pending refund does not advance amount_refunded_minor until confirmed", async () => {
  const { api, db, dir, payment } = await succeededPayment([
    chargeOk("ch_1", "succeeded"),
    { status: 200, headers: {}, bodyText: JSON.stringify({ id: "re_1", status: "pending" }) },
  ]);

  const result = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: USD(400),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.refund.status, "pending");
    assert.equal(result.payment.amountRefundedMinor, 0, "a still-pending refund must not move the payment's total");
    assert.equal(result.payment.status, "succeeded", "the payment stays put until the refund is confirmed");
  }

  cleanup(db, dir);
});

// The tests below target `providers/lipay-gateway.ts`'s own response-shape validation directly —
// every malformed-gateway-response branch `buildChargeResult`/`buildRefundResult`/`toNextAction`
// can take, exercised through the real gateway (never a stub of the gateway itself).

test("charge: a decline surfaced only via the provider's error code (not HTTP 402) is still typed DECLINED", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      { status: 400, headers: {}, bodyText: JSON.stringify({ error: { code: "insufficient_funds", message: "no funds" } }) },
    ],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DECLINED");
    assert.equal(result.error.providerStatus, 400);
  }

  cleanup(db, dir);
});

test("charge: a decline with no error body at all falls back to a generic declined message", async () => {
  const { api, db, dir } = await makeLipay({ responses: [{ status: 402, headers: {}, bodyText: "" }] });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "DECLINED");
    assert.equal(result.error.message, "lipay declined the charge (402)");
  }

  cleanup(db, dir);
});

test("charge: a 429 is retryable, the same as a 5xx", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [{ status: 429, headers: {}, bodyText: JSON.stringify({ error: { code: "rate_limited", message: "slow down" } }) }],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROVIDER_ERROR");
    assert.equal(result.error.retryable, true);
    assert.equal(result.error.providerStatus, 429);
  }

  cleanup(db, dir);
});

test("charge: a non-JSON response body from the provider fails closed as a malformed response, never a throw", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [{ status: 200, headers: {}, bodyText: "not json at all" }],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROVIDER_ERROR");
    assert.match(result.error.message, /no charge id/);
  }

  cleanup(db, dir);
});

test("charge: a 2xx response with no charge id is a malformed-response PROVIDER_ERROR", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [{ status: 200, headers: {}, bodyText: JSON.stringify({ status: "succeeded" }) }],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROVIDER_ERROR");
    assert.match(result.error.message, /no charge id/);
  }

  cleanup(db, dir);
});

test("charge: an unrecognized charge status is a malformed-response PROVIDER_ERROR", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [{ status: 200, headers: {}, bodyText: JSON.stringify({ id: "ch_1", status: "processing" }) }],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROVIDER_ERROR");
    assert.match(result.error.message, /unrecognized charge status 'processing'/);
  }

  cleanup(db, dir);
});

test("charge: an out_of_band next_action with instructions is passed through verbatim", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      {
        status: 200,
        headers: {},
        bodyText: JSON.stringify({
          id: "ch_1",
          status: "pending",
          next_action: { type: "out_of_band", instructions: "Dial *123# and enter code 456" },
        }),
      },
    ],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.next, { kind: "out_of_band", instructions: "Dial *123# and enter code 456" });
  }

  cleanup(db, dir);
});

test("charge: an out_of_band next_action without instructions omits the field rather than inventing one", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      { status: 200, headers: {}, bodyText: JSON.stringify({ id: "ch_1", status: "pending", next_action: { type: "out_of_band" } }) },
    ],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.next, { kind: "out_of_band" });

  cleanup(db, dir);
});

test("charge: a redirect next_action with an empty url is a malformed-response PROVIDER_ERROR", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      { status: 200, headers: {}, bodyText: JSON.stringify({ id: "ch_1", status: "pending", next_action: { type: "redirect", url: "" } }) },
    ],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROVIDER_ERROR");
    assert.match(result.error.message, /malformed next_action/);
  }

  cleanup(db, dir);
});

test("charge: a response that omits next_action entirely defaults to none rather than failing", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [{ status: 200, headers: {}, bodyText: JSON.stringify({ id: "ch_1", status: "succeeded" }) }],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.next, { kind: "none" });

  cleanup(db, dir);
});

test("charge: a next_action whose type field is present but not a string defaults to none", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      { status: 200, headers: {}, bodyText: JSON.stringify({ id: "ch_1", status: "succeeded", next_action: { type: 7 } }) },
    ],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.next, { kind: "none" });

  cleanup(db, dir);
});

test("charge: a next_action of a type the gateway doesn't recognize is a malformed-response PROVIDER_ERROR", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      {
        status: 200,
        headers: {},
        bodyText: JSON.stringify({ id: "ch_1", status: "pending", next_action: { type: "client_action" } }),
      },
    ],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROVIDER_ERROR");
    assert.match(result.error.message, /malformed next_action/);
  }

  cleanup(db, dir);
});

test("charge: a thrown non-Error transport failure is still typed as a retryable TRANSPORT_ERROR", async () => {
  const { api, db, dir } = await makeLipay({
    responses: [
      () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal -- deliberate: proving the
        // `err instanceof Error ? err.message : String(err)` fallback actually stringifies a
        // non-Error throw rather than crashing on `.message` of something that lacks it.
        throw "socket hang up";
      },
    ],
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "lipay",
    amount: USD(2500),
    idempotencyKey: "order-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "TRANSPORT_ERROR");
    assert.equal(result.error.message, "socket hang up");
    assert.equal(result.error.retryable, true);
  }

  cleanup(db, dir);
});

test("refund: a 2xx response with no refund id is a malformed-response PROVIDER_ERROR", async () => {
  const { api, db, dir, payment } = await succeededPayment([
    chargeOk("ch_1", "succeeded"),
    { status: 200, headers: {}, bodyText: JSON.stringify({ status: "succeeded" }) },
  ]);

  const result = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: USD(400),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROVIDER_ERROR");
    assert.match(result.error.message, /no refund id/);
  }

  cleanup(db, dir);
});

test("refund: a decline surfaced only via the provider's error code (not HTTP 402) is still typed DECLINED", async () => {
  const { api, db, dir, payment } = await succeededPayment([
    chargeOk("ch_1", "succeeded"),
    { status: 400, headers: {}, bodyText: JSON.stringify({ error: { code: "card_declined", message: "cannot reverse" } }) },
  ]);

  const result = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: USD(400),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "DECLINED");

  cleanup(db, dir);
});

test("refund: a thrown Error during the provider call is a retryable TRANSPORT_ERROR", async () => {
  const { api, db, dir, payment } = await succeededPayment([
    chargeOk("ch_1", "succeeded"),
    () => {
      throw new Error("egress refused: private address");
    },
  ]);

  const result = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: USD(400),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "TRANSPORT_ERROR");
    assert.equal(result.error.message, "egress refused: private address");
    assert.equal(result.error.retryable, true);
  }

  cleanup(db, dir);
});

test("refund: a thrown non-Error value during the provider call is still typed as a retryable TRANSPORT_ERROR", async () => {
  const { api, db, dir, payment } = await succeededPayment([
    chargeOk("ch_1", "succeeded"),
    () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal -- deliberate: same as the
      // charge-side case above, proving the refund catch's own `String(err)` fallback runs.
      throw "socket hang up";
    },
  ]);

  const result = await api.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "r1",
    amount: USD(400),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "TRANSPORT_ERROR");
    assert.equal(result.error.message, "socket hang up");
  }

  cleanup(db, dir);
});

// The tests below target `lipay-plugin.ts` itself: the request-shape/idempotency/state-machine
// gating logic that sits between the public API and the gateway.

test("refund: a second partial refund that doesn't complete the payment still moves the total, even though the status doesn't change", async () => {
  const { api, db, dir, payment } = await succeededPayment([chargeOk("ch_1", "succeeded"), refundOk("re_1"), refundOk("re_2")]);

  const first = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r1", amount: USD(300) });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.payment.status, "partially_refunded");

  // 300 + 300 = 600, still short of the 1000 charged — `canTransition("partially_refunded",
  // "partially_refunded")` is `false` (same-status is deliberately not a transition, per
  // state-machine.ts), so this exercises the branch that updates the total WITHOUT touching status.
  const second = await api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r2", amount: USD(300) });

  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.payment.status, "partially_refunded", "status is unchanged, not reset or cleared");
    assert.equal(second.payment.amountRefundedMinor, 600, "the total still accumulates despite the no-op status transition");
  }

  cleanup(db, dir);
});

test("refund: an unexpected (non-constraint) database failure during insertion propagates rather than being swallowed as a typed error", async (t) => {
  const { api, db, dir, payment } = await succeededPayment([chargeOk("ch_1", "succeeded")]);
  const failure = new Error("injected INSERT I/O failure");
  const prepare = db.prepare.bind(db);
  let insertAttempts = 0;
  t.mock.method(db, "prepare", (sql: string) => {
    if (/^insert into "p_lipay__refunds"/i.test(sql)) {
      insertAttempts += 1;
      throw failure;
    }
    return prepare(sql);
  });

  await assert.rejects(
    () => api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "r1", amount: USD(400) }),
    (err: unknown) => err === failure
  );

  assert.equal(insertAttempts, 1, "reads remain operational and the INSERT is reached");
  cleanup(db, dir);
});

test("charge: an unexpected (non-constraint) database failure during insertion propagates rather than being swallowed as a typed error", async (t) => {
  const { api, db, dir } = await makeLipay({ responses: [chargeOk("ch_1", "pending")] });
  const failure = new Error("injected INSERT I/O failure");
  const prepare = db.prepare.bind(db);
  let insertAttempts = 0;
  t.mock.method(db, "prepare", (sql: string) => {
    if (/^insert into "p_lipay__payments"/i.test(sql)) {
      insertAttempts += 1;
      throw failure;
    }
    return prepare(sql);
  });

  await assert.rejects(
    () => api.charge({ workspaceId: WORKSPACE_ID, providerId: "lipay", amount: USD(2500), idempotencyKey: "order-1" }),
    (err: unknown) => err === failure
  );

  assert.equal(insertAttempts, 1, "reads remain operational and the INSERT is reached");
  cleanup(db, dir);
});

test("refund: a provider that was unregistered since the charge was made is a typed PROVIDER_NOT_REGISTERED, not a crash", async () => {
  // Two separate `activateLipay` instances sharing ONE sqlite file: the first has "acme"
  // registered and makes the charge; the second (simulating a later boot with that provider's
  // plugin disabled/removed) has no "acme" at all, and is the one that receives the refund call.
  const { db, dbPath, dir } = tempDb();
  const acme: PaymentProvider = {
    id: "acme",
    displayName: "Acme",
    credentialKeys: ["secretKey"],
    capabilities: {
      refunds: "full",
      tokenization: false,
      recurring: false,
      confirmation: ["none"],
      currencies: "any",
      webhooks: false,
    },
    async createCharge() {
      return { ok: true, providerRef: "acme_1", status: "succeeded", next: { kind: "none" } };
    },
    async refund() {
      return { ok: true, providerRef: "acme_re_1", status: "succeeded" };
    },
    async parseWebhook() {
      return { ok: true, events: [] };
    },
  };

  const apiWithAcme = await activateLipay({
    db,
    dbPath,
    workspaceId: WORKSPACE_ID,
    httpClient: new FakeHttpClient(),
    credentials: new InMemoryPaymentCredentials({ acme: { secretKey: "sk" } }),
    providers: [acme],
    clock: new TestClock(Date.UTC(2026, 6, 30, 12, 0, 0)),
    idGen: testIdGen("pay"),
    webhookBaseUrl: "https://site.test",
    returnUrl: "https://site.test/checkout/return",
  });
  const created = await apiWithAcme.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "acme",
    amount: USD(1000),
    idempotencyKey: "order-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const apiWithoutAcme = await activateLipay({
    db,
    dbPath,
    workspaceId: WORKSPACE_ID,
    httpClient: new FakeHttpClient(),
    credentials: new InMemoryPaymentCredentials(),
    providers: [],
    clock: new TestClock(Date.UTC(2026, 6, 30, 12, 0, 0)),
    idGen: testIdGen("pay"),
    webhookBaseUrl: "https://site.test",
    returnUrl: "https://site.test/checkout/return",
  });

  const result = await apiWithoutAcme.refund({
    workspaceId: WORKSPACE_ID,
    paymentId: created.payment.id,
    idempotencyKey: "r1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "PROVIDER_NOT_REGISTERED");

  cleanup(db, dir);
});

test("refund: two concurrent refunds racing the same idempotency key resolve to one refund, not a crash", async () => {
  const { api, db, dir, http, payment } = await succeededPayment([chargeOk("ch_1", "succeeded"), refundOk("re_1")]);
  const request = {
    workspaceId: WORKSPACE_ID,
    paymentId: payment.id,
    idempotencyKey: "refund-race-1",
    amount: USD(400),
  } as const;

  const [first, second] = await Promise.all([api.refund(request), api.refund(request)]);

  assert.equal(first.ok && second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.refund.id, second.refund.id, "both concurrent calls resolve to the SAME refund row");
    assert.equal(
      [first.replayed, second.replayed].filter((replayed) => replayed).length,
      1,
      "exactly one of the two lost the race to the UNIQUE index and was reconciled, not both"
    );
  }
  assert.equal(http.calls.length, 2, "one charge call plus exactly one refund call — the race's other side never reached the provider");

  cleanup(db, dir);
});

for (const [firstAmount, secondAmount, accepted] of [[700, 700, 1], [400, 300, 2]]) {
  test(`refund: distinct in-flight keys reserve the remaining balance (${firstAmount}+${secondAmount})`, async (t) => {
    const { api, db, dir, payment, http } = await succeededPayment([chargeOk("ch_1", "succeeded")]);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let firstEntered!: () => void;
    const firstInFlight = new Promise<void>(resolve => { firstEntered = resolve; });
    let secondEntered!: () => void;
    const secondInFlight = new Promise<void>(resolve => { secondEntered = resolve; });
    const send = t.mock.method(http, "send", async (request: HttpRequest) => {
      const key = request.headers["idempotency-key"];
      if (key === "in-flight-1") firstEntered();
      else secondEntered();
      await held;
      return refundOk(key === "in-flight-1" ? "re_1" : "re_2");
    });
    try {
      const first = api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "in-flight-1", amount: USD(firstAmount) });
      await firstInFlight;
      const second = api.refund({ workspaceId: WORKSPACE_ID, paymentId: payment.id, idempotencyKey: "in-flight-2", amount: USD(secondAmount) });
      // The second attempt must either be rejected while the first is held or enter the provider;
      // both paths are observed without a timer or a scheduling guess.
      await Promise.race([second.then(() => undefined), secondInFlight]);
      release();
      const results = await Promise.all([first, second]);
      assert.equal(results.filter(result => result.ok).length, accepted);
      if (accepted === 1) {
        const rejected = results.find(result => !result.ok);
        assert.ok(rejected && !rejected.ok);
        assert.equal(rejected.error.code, "INVALID_REQUEST");
      }
      assert.equal(send.mock.calls.length, accepted, "only reserved refunds reach the provider");
      const total = accepted === 1 ? firstAmount : firstAmount + secondAmount;
      assert.equal((await api.getPayment({ workspaceId: WORKSPACE_ID, id: payment.id }))?.amountRefundedMinor, total);
      assert.equal(refundRows(db).length, accepted);
    } finally {
      release();
      cleanup(db, dir);
    }
  });
}
