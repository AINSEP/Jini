/**
 * @file The open provider registry and the dispatch path through it.
 *
 * The property under test is the one the whole design exists for: core never enumerates providers,
 * so a provider it has never heard of can be added and dispatched to without editing any core type.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createPaymentProviderRegistry } from "../registry.js";
import type { PaymentProvider } from "../ports.js";
import { cleanup, makeLipay, WORKSPACE_ID } from "./support.js";
import { InMemoryPaymentCredentials } from "../credentials.js";

function stubProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    id: "acme",
    displayName: "Acme Pay",
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
    ...overrides,
  };
}

test("registry: register / get / list, and an unknown id resolves to null", () => {
  const registry = createPaymentProviderRegistry({ providers: [stubProvider()] });

  assert.equal(registry.get({ id: "acme" })?.displayName, "Acme Pay");
  assert.equal(registry.get({ id: "never-registered" }), null);
  assert.deepEqual(
    registry.list().map((p) => p.id),
    ["acme"]
  );
});

test("registry: a duplicate provider id is a composition-time error, not a silent overwrite", () => {
  const registry = createPaymentProviderRegistry({ providers: [stubProvider()] });
  assert.throws(() => registry.register({ provider: stubProvider() }), /already registered/);
});

test("registry: an id outside ADR-026's grammar is rejected (it becomes a URL segment and an env-var fragment)", () => {
  const registry = createPaymentProviderRegistry({ providers: [] });
  assert.throws(() => registry.register({ provider: stubProvider({ id: "Acme_Pay" }) }), /invalid payment provider id/);
  assert.throws(() => registry.register({ provider: stubProvider({ id: "../etc" }) }), /invalid payment provider id/);
  // Hyphens are legal — a regional gateway like `m-pesa` must be registrable.
  registry.register({ provider: stubProvider({ id: "m-pesa" }) });
  assert.equal(registry.get({ id: "m-pesa" })?.id, "m-pesa");
});

test("registry: declaring refund support without implementing refund() fails at registration", () => {
  const registry = createPaymentProviderRegistry({ providers: [] });
  assert.throws(
    () =>
      registry.register({ provider: stubProvider({
          capabilities: { ...stubProvider().capabilities, refunds: "partial" },
        }) }
      ),
    /implements no refund\(\)/
  );
});

test("lipay: a provider core has never heard of is dispatched to with zero core edits", async () => {
  let seenIdempotencyKey: string | null = null;
  const regional = stubProvider({
    id: "m-pesa",
    displayName: "M-Pesa",
    capabilities: {
      refunds: "none",
      tokenization: false,
      recurring: false,
      confirmation: ["out_of_band"],
      currencies: ["KES"],
      webhooks: true,
    },
    async createCharge(input) {
      seenIdempotencyKey = input.idempotencyKey;
      return {
        ok: true,
        providerRef: "mp_1",
        status: "pending",
        next: { kind: "out_of_band", instructions: "Approve the STK push on your handset." },
      };
    },
  });

  const { api, db, dir } = await makeLipay({
    providers: [regional],
    credentials: new InMemoryPaymentCredentials({ "m-pesa": { secretKey: "sk_test" } }),
  });

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "m-pesa",
    amount: { minorUnits: 25_000, currency: "KES" },
    idempotencyKey: "order-9001",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payment.status, "pending");
    assert.equal(result.payment.providerRef, "mp_1");
    assert.deepEqual(result.next, { kind: "out_of_band", instructions: "Approve the STK push on your handset." });
  }
  assert.equal(seenIdempotencyKey, "order-9001", "the caller's key is forwarded to the provider");

  cleanup(db, dir);
});

test("lipay: listProviders reports capabilities, which is what a picker renders from", async () => {
  const { api, db, dir } = await makeLipay();

  const summaries = api.listProviders();
  assert.deepEqual(
    summaries.map((s) => s.id),
    ["lipay"]
  );
  assert.equal(summaries[0].capabilities.refunds, "partial");
  assert.equal(summaries[0].capabilities.webhooks, true);
  assert.ok(summaries[0].capabilities.confirmation.includes("out_of_band"));
  assert.ok(!summaries[0].capabilities.confirmation.includes("client_action"));

  cleanup(db, dir);
});

test("lipay: charging an unregistered provider is a typed error and writes nothing", async () => {
  const { api, db, dir, http } = await makeLipay();

  const result = await api.charge({
    workspaceId: WORKSPACE_ID,
    providerId: "stripe",
    amount: { minorUnits: 100, currency: "USD" },
    idempotencyKey: "k1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "PROVIDER_NOT_REGISTERED");
  assert.equal(http.calls.length, 0);
  assert.equal((await api.listPayments({ workspaceId: WORKSPACE_ID })).length, 0);

  cleanup(db, dir);
});


test("lipay lists and dispatches to every configured provider, preserving distinct capabilities", async () => {
  const dispatched: string[] = [];
  const acme = stubProvider({ async createCharge(input) {
    dispatched.push(`acme:${input.idempotencyKey}`);
    return { ok: true, providerRef: "acme_charge", status: "succeeded", next: { kind: "none" } };
  } });
  const regional = stubProvider({ id: "m-pesa", displayName: "M-Pesa", capabilities: {
    refunds: "none", tokenization: false, recurring: false, confirmation: ["out_of_band"], currencies: ["KES"], webhooks: true,
  }, async createCharge(input) {
    dispatched.push(`m-pesa:${input.idempotencyKey}`);
    return { ok: true, providerRef: "mp_charge", status: "pending", next: { kind: "out_of_band", instructions: "Approve on handset" } };
  } });
  const { api, db, dir } = await makeLipay({ providers: [acme, regional], credentials: new InMemoryPaymentCredentials({ acme: { secretKey: "acme_sk" }, "m-pesa": { secretKey: "mp_sk" } }) });
  try {
    assert.deepEqual(api.listProviders(), [
      { id: "acme", displayName: "Acme Pay", capabilities: { refunds: "none", tokenization: false, recurring: false, confirmation: ["none"], currencies: "any", webhooks: false } },
      { id: "m-pesa", displayName: "M-Pesa", capabilities: { refunds: "none", tokenization: false, recurring: false, confirmation: ["out_of_band"], currencies: ["KES"], webhooks: true } },
    ]);
    for (const [providerId, currency, providerRef, status] of [["acme", "USD", "acme_charge", "succeeded"], ["m-pesa", "KES", "mp_charge", "pending"]] as const) {
      const result = await api.charge({ workspaceId: WORKSPACE_ID, providerId, amount: { minorUnits: 123, currency }, idempotencyKey: `order-${providerId}` });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected charge success");
      assert.equal(result.payment.providerRef, providerRef);
      assert.equal(result.payment.status, status);
      assert.equal((await api.getPayment({ workspaceId: WORKSPACE_ID, id: result.payment.id }))?.providerId, providerId);
    }
    assert.deepEqual(dispatched, ["acme:order-acme", "m-pesa:order-m-pesa"]);
  } finally {
    cleanup(db, dir);
  }
});
