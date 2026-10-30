import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createPluginContributionCapture, createPluginContributionRegistry, createPluginProviderHost,
  type PluginManifest, type PluginSdk } from "@jini-ai/plugins/host";
import { createInboxWorker, createKernelProviderRegistry, createMemoryGrantStore, createOutboxRelay,
  createPaymentsOperator, createPaymentsService, createProviderContexts, createWebhookReceiver,
  leasedProviderItem, memoryPaymentsLedger, paymentsProviderContract, sameScope,
  type PaymentProvider, type PaymentsOutboxMessage, type ProviderContext } from "@jini-ai/commerce/payments/kernel";
import { createOrderPaymentProjector, payOrder, type CommerceOrderPaymentRecord, type CommerceOrderRecord,
  type PayOrderDeps } from "@jini-ai/commerce";
import stripePlugin from "../index.js";
import manifest from "../jini.plugin.json";

const scope = { workspaceId: "ws", siteId: "site", providerId: "stripe", providerAccountId: "acct_1", mode: "test" as const };
const bindings = { stripe: "payments-stripe" }, total = { minorUnits: 369, currency: "USD" };
const hosts: ReturnType<typeof createPluginProviderHost>[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.dispose({}))); vi.restoreAllMocks(); });
const unexpected = async () => { throw new Error("unexpected catalog operation"); };

/** Real adapter/host/kernel; only catalog storage, configuration and HTTP are test ports. */
async function fixture(_required: Record<string, never>, _optional: Record<string, never> = {}) {
  const state = { now: 1_800_000_000_000, association: null as CommerceOrderPaymentRecord | null,
    session: { object: "checkout.session", id: "cs_1", mode: "payment", livemode: false, amount_total: 369,
      currency: "usd", status: "open", payment_status: "unpaid", metadata: { jini_payment_id: "" }, url: "https://checkout.stripe.com/c/1" } };
  const contributions = createPluginContributionRegistry({}), capture = createPluginContributionCapture({ manifest: manifest as PluginManifest });
  const sdk = { providers: capture.providers } as PluginSdk;
  stripePlugin.definition.setup(sdk); contributions.replace({ contributions: capture.seal({ sdk }) });
  const host = createPluginProviderHost({ contributions, contracts: [paymentsProviderContract] }); hosts.push(host);
  const lease = await host.initialize({ contract: "payments", id: "stripe", input: {} });
  if (!lease) throw new Error("Stripe lease missing");
  const provider = lease.port as PaymentProvider;
  const inner = { create: vi.spyOn(provider, "createIntent"), verify: vi.spyOn(provider, "verifyWebhook"), retrieve: vi.spyOn(provider, "retrieve") };
  const item = leasedProviderItem({ pluginId: "payments-stripe", lease });
  if ("problem" in item) throw new Error(item.problem);
  const providers = createKernelProviderRegistry({ items: [item] }, { bindings });
  const send = vi.fn<ProviderContext["httpClient"]["send"]>(async ({ request }) => {
    expect(request).toMatchObject({ method: "POST", url: "https://api.stripe.com/v1/checkout/sessions",
      headers: { Authorization: "Bearer sk_test_fixture", "Content-Type": "application/x-www-form-urlencoded" } });
    const form = new URLSearchParams(request.body as string);
    state.session.metadata = { jini_payment_id: form.get("metadata[jini_payment_id]")! };
    return { status: 200, headers: {}, bodyText: JSON.stringify(state.session) };
  });
  const contexts = createProviderContexts({ bindings, now: () => state.now, httpClient: { send },
    configFor: ({ siteId }) => ({ read: async ({ pluginId }) => {
      expect([siteId, pluginId]).toEqual(["site", "payments-stripe"]);
      return { settings: { accountId: "acct_1" }, secrets: { test_secretKey: "sk_test_fixture", test_webhookSecret: "whsec_fixture" } };
    } }), urlsFor: () => ({ returnUrl: "https://shop.test/return", cancelUrl: "https://shop.test/cancel", webhookUrl: "https://shop.test/hook" }) });
  let sequence = 0;
  const now = () => state.now, newId = () => `id_${++sequence}`, ledger = memoryPaymentsLedger();
  const alerts = { raise: vi.fn(async (_required: unknown) => {}) };
  const kernel = { ledger, providers, contexts, now, newId, grants: createMemoryGrantStore({ now, newToken: newId }) };
  const payments = createPaymentsService(kernel, { alerts });
  const order: CommerceOrderRecord = { id: "order", workspaceId: "ws", memberId: "member", status: "pending", totalAmount: total,
    provider: "stripe", placedAt: new Date(state.now).toISOString(), createdAt: new Date(state.now).toISOString(), updatedAt: new Date(state.now).toISOString(), version: 1 };
  const orders: PayOrderDeps["orders"] = { findById: async key => key.workspaceId === "ws" && key.id === "order" ? structuredClone(order) : null,
    listItems: async key => key.workspaceId === "ws" && key.orderId === "order" ? [{ id: "item", workspaceId: "ws", orderId: "order", priceId: "price", productId: "product",
      description: "Notebook", quantity: 3, unitAmount: { minorUnits: 123, currency: "USD" }, createdAt: order.createdAt }] : [], placeOrder: unexpected,
    markPaid: vi.fn<PayOrderDeps["orders"]["markPaid"]>(async ({ workspaceId, orderId, at }) => {
      if (workspaceId !== "ws" || orderId !== "order") return "not_found";
      if (order.status === "paid") return "already_paid";
      if (order.status !== "pending") return "not_pending";
      order.status = "paid"; order.version++; order.updatedAt = at; return "paid";
    }) };
  const orderPayments: PayOrderDeps["orderPayments"] = {
    findByOrder: async key => key.workspaceId === "ws" && key.orderId === "order" ? structuredClone(state.association) : null,
    reserve: async record => {
      if (!state.association) { state.association = { ...structuredClone(record), paymentId: null }; return "reserved"; }
      return sameScope({ a: record, b: state.association }) && record.orderId === state.association.orderId
        && record.amount.minorUnits === state.association.amount.minorUnits && record.amount.currency === state.association.amount.currency ? "same_scope" : "conflict";
    }, bind: vi.fn<PayOrderDeps["orderPayments"]["bind"]>(async ({ workspaceId, orderId, paymentId }) => {
      if (!state.association || workspaceId !== "ws" || orderId !== "order") return "not_found";
      if (state.association.paymentId === paymentId) return "already_bound";
      if (state.association.paymentId !== null) return "conflict";
      state.association.paymentId = paymentId; return "bound";
    }) };
  const settle = { orders, orderPayments, payments, alerts, clock: { nowMs: now } };
  const deps: PayOrderDeps = { orders, orderPayments, payments, settle,
    prices: { findById: async key => key.workspaceId === "ws" && key.id === "price" ? { id: "price", workspaceId: "ws", productId: "product", unitAmount: total, status: "active", createdAt: order.createdAt, version: 1 } : null, listByProduct: unexpected, save: unexpected },
    priceRefs: { find: async key => { expect(key).toEqual({ workspaceId: "ws", priceId: "price", providerId: "stripe", providerAccountId: "acct_1", mode: "test" }); return null; }, save: unexpected } };
  const receiver = createWebhookReceiver({ ...kernel, endpoints: { resolve: async () => scope } });
  const endpoint = await receiver.resolveEndpoint({ path: { siteId: "site", providerId: "stripe", endpointId: "test" } });
  if (!endpoint.ok) throw new Error("endpoint missing");
  // Sign exact bytes independently of the adapter's verifier, including whitespace.
  const signed = ({ id = "evt_paid", type = "checkout.session.completed", patch = {}, live = false, created = now() / 1000 }, _optional: Record<string, never> = {}) => {
    const rawBody = Buffer.from(` ${JSON.stringify({ id, type, created, livemode: live, data: { object: { ...state.session, status: "complete", payment_status: "paid", ...patch } } })}\n`);
    const timestamp = Math.floor(now() / 1000), signature = createHmac("sha256", "whsec_fixture").update(`${timestamp}.`).update(rawBody).digest("hex");
    return { endpoint: endpoint.endpoint, rawBody, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` } };
  };
  const messages: PaymentsOutboxMessage[] = [], projector = createOrderPaymentProjector({ deps: settle });
  const publish = vi.fn(async ({ message }: { message: PaymentsOutboxMessage }) => { messages.push(message); await projector.handle({ message }); });
  const worker = createInboxWorker(kernel, { alerts }), relay = createOutboxRelay({ ledger, now, publish: { publish } });
  return { state, host, inner, item, send, kernel, payments, order, orders, orderPayments, deps, receiver, signed, worker, relay, publish, messages, projector, alerts,
    operator: createPaymentsOperator(kernel, { alerts }), run: () => payOrder({ deps, input: { workspaceId: "ws", orderId: "order", scope } }) };
}

it("pays an order through the real Stripe adapter, signed inbox, writer and order projector", async () => {
  const w = await fixture({}), result = await w.run();
  expect(result).toMatchObject({ ok: true, replayed: false, payment: { status: "requires_action", amount: total, reference: "order", next: { kind: "redirect", url: "https://checkout.stripe.com/c/1" } } });
  const form = new URLSearchParams(w.send.mock.calls[0]![0].request.body as string);
  expect(Object.fromEntries(form)).toEqual({ mode: "payment", success_url: "https://shop.test/return", cancel_url: "https://shop.test/cancel",
    client_reference_id: result.payment!.id, "metadata[jini_payment_id]": result.payment!.id, "payment_intent_data[metadata][jini_payment_id]": result.payment!.id,
    "line_items[0][quantity]": "3", "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": "123", "line_items[0][price_data][product_data][name]": "Notebook" });
  expect(w.order.status).toBe("pending");
  const attempt = await w.kernel.ledger.transaction({ fn: tx => tx.findAttemptByOperationKey({ workspaceId: "ws", mode: "test", operationKey: "intent:order:order" }) });
  expect(w.send.mock.calls[0]![0].request.headers!["Idempotency-Key"]).toBe(attempt!.id);
  expect(await w.receiver.receive(w.signed({}))).toEqual({ status: 200, body: { received: 1, duplicates: 0, ignored: false } });
  expect(await w.worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 1, parked: 0, dead: 0, quarantined: 0 });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 1, stopped: false });
  expect(await w.payments.getPayment({ scope, paymentId: result.payment!.id })).toMatchObject({ status: "succeeded", captured: total });
  expect([w.order.status, w.order.version, w.messages[0]!.payload.reference]).toEqual(["paid", 2, "order"]);
});
it("keeps completed-unpaid pending until asynchronous paid evidence, ignoring older unpaid evidence", async () => {
  const w = await fixture({}), first = await w.run();
  await w.receiver.receive(w.signed({ id: "evt_unpaid", patch: { payment_status: "unpaid" } })); await w.worker.runOnce({ limit: 10 });
  expect(await w.payments.getPayment({ scope, paymentId: first.payment!.id })).toMatchObject({ status: "pending", captured: { minorUnits: 0, currency: "USD" } });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 0, stopped: false }); expect(w.order.status).toBe("pending");
  expect(await w.receiver.receive(w.signed({ type: "checkout.session.async_payment_succeeded" }))).toMatchObject({ status: 200 });
  expect(await w.worker.runOnce({ limit: 10 })).toMatchObject({ applied: 1, quarantined: 0 }); await w.relay.runOnce({ limit: 10 });
  expect(await w.receiver.receive(w.signed({ id: "evt_older", created: w.state.now / 1000 - 10, patch: { payment_status: "unpaid" } }))).toMatchObject({ status: 200 });
  expect(await w.worker.runOnce({ limit: 10 })).toMatchObject({ applied: 1, quarantined: 0 });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 0, stopped: false });
  expect(await w.payments.getPayment({ scope, paymentId: first.payment!.id })).toMatchObject({ status: "succeeded", captured: total });
  expect([w.order.status, w.order.version, w.messages.length]).toEqual(["paid", 2, 1]);
});
it("deduplicates signed redelivery and fulfills exactly once across outbox redelivery", async () => {
  const w = await fixture({}); await w.run(); const delivery = w.signed({}); await w.receiver.receive(delivery); await w.worker.runOnce({ limit: 10 });
  w.publish.mockImplementationOnce(async ({ message }) => { w.messages.push(message); await w.projector.handle({ message }); throw new Error("bus response lost"); });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 0, stopped: true });
  expect([w.order.status, w.order.version]).toEqual(["paid", 2]);
  expect(await w.receiver.receive(delivery)).toEqual({ status: 200, body: { received: 0, duplicates: 1, ignored: false } });
  expect(await w.worker.runOnce({ limit: 10 })).toEqual({ seen: 0, applied: 0, parked: 0, dead: 0, quarantined: 0 });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 1, stopped: false });
  expect(w.messages).toHaveLength(2); expect(w.messages[0]!.id).toBe(w.messages[1]!.id); expect([w.order.status, w.order.version]).toEqual(["paid", 2]);
});
it("refuses duplicate Stripe claims and a claim from outside the explicit binding", async () => {
  const w = await fixture({}), impostor = { ...w.item, pluginId: "other-plugin" };
  expect(() => createKernelProviderRegistry({ items: [w.item, impostor] }, { bindings })).toThrow("already registered");
  expect(() => createKernelProviderRegistry({ items: [impostor] }, { bindings })).toThrow("bound to plugin"); expect(w.send).not.toHaveBeenCalled();
});
it("retires the lease before dispatch and asks for webhook redelivery without invoking the adapter", async () => {
  const w = await fixture({}); await w.host.dispose({});
  expect(await w.run()).toMatchObject({ ok: false, error: { code: "PROVIDER_NOT_REGISTERED" } });
  expect(await w.receiver.receive(w.signed({}))).toMatchObject({ status: 503, body: { code: "PROVIDER_NOT_REGISTERED" } });
  const context = await w.kernel.contexts.resolve({ scope, provider: w.item.module });
  if (!context.ok) throw new Error("fixture credentials missing");
  expect(await w.item.module.retrieve!({ ctx: context.ctx, providerRef: "cs_1" })).toMatchObject({ kind: "unknown", error: { code: "PROVIDER_NOT_REGISTERED", retryable: true } });
  expect(w.inner.create).not.toHaveBeenCalled(); expect(w.inner.verify).not.toHaveBeenCalled(); expect(w.inner.retrieve).not.toHaveBeenCalled();
  expect(w.send).not.toHaveBeenCalled(); expect(w.order.status).toBe("pending");
});

it.each([
  { patch: { amount_total: 370 }, reason: "amount-mismatch" },
  { patch: { currency: "eur" }, reason: "currency-mismatch" },
])("quarantines signed $reason evidence without fulfilling the order", async ({ patch, reason }) => {
  const w = await fixture({}), first = await w.run();
  expect(await w.receiver.receive(w.signed({ patch }))).toEqual({ status: 200, body: { received: 1, duplicates: 0, ignored: false } });
  expect(await w.worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 1, parked: 0, dead: 0, quarantined: 1 });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 0, stopped: false });
  expect(await w.payments.getPayment({ scope, paymentId: first.payment!.id })).toMatchObject({ status: "requires_action", amount: total, captured: { minorUnits: 0, currency: "USD" } });
  const quarantine = await w.kernel.ledger.transaction({ fn: tx => tx.listQuarantine({ workspaceId: "ws", mode: "test" }) });
  expect(quarantine.map(row => [row.paymentId, row.reason])).toEqual([[first.payment!.id, reason]]);
  expect(w.alerts.raise).toHaveBeenCalledWith({ alert: expect.objectContaining({ kind: "quarantine", paymentId: first.payment!.id }) });
  expect([w.order.status, w.order.version]).toEqual(["pending", 1]); expect(w.orders.markPaid).not.toHaveBeenCalled();
});
it.each([{ live: true, patch: {} }, { live: false, patch: { livemode: true } }])("refuses a signed wrong-mode event or session: %j", async input => {
  const w = await fixture({}); expect(await w.run()).toMatchObject({ ok: true, payment: { status: "requires_action" } });
  expect(await w.receiver.receive(w.signed(input))).toMatchObject({ status: 400, body: { code: "INVALID_REQUEST" } });
  expect(await w.worker.runOnce({ limit: 10 })).toEqual({ seen: 0, applied: 0, parked: 0, dead: 0, quarantined: 0 });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 0, stopped: false });
  expect([w.order.status, w.order.version]).toEqual(["pending", 1]); expect(w.orders.markPaid).not.toHaveBeenCalled();
});
it.each([{ amount: { minorUnits: 370, currency: "USD" } }, { siteId: "other-site" }, { mode: "live" as const }])(
  "blocks fulfillment when verified payment truth differs from the stored reservation: %j", async patch => {
    const w = await fixture({}), first = await w.run();
    // Simulate corrupt host storage; even authentic paid evidence must pass the association fence.
    Object.assign(w.state.association!, patch);
    await w.receiver.receive(w.signed({})); expect(await w.worker.runOnce({ limit: 10 })).toMatchObject({ applied: 1, quarantined: 0 });
    expect(await w.payments.getPayment({ scope, paymentId: first.payment!.id })).toMatchObject({ status: "succeeded", captured: total });
    expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 1, stopped: false });
    expect(w.alerts.raise).toHaveBeenCalledWith({ alert: expect.objectContaining({ kind: "fulfillment-blocked", workspaceId: "ws", paymentId: first.payment!.id }) });
    expect([w.order.status, w.order.version]).toEqual(["pending", 1]); expect(w.orders.markPaid).not.toHaveBeenCalled();
  });
it("leaves a lost response unknown without redispatch, alerts when aged, then settles a late signed webhook", async () => {
  const w = await fixture({}), dispatch = w.send.getMockImplementation()!;
  w.send.mockImplementationOnce(async args => { await dispatch(args); throw new Error("session created; response lost"); });
  const first = await w.run();
  expect(first).toMatchObject({ ok: false, error: { code: "TRANSPORT_ERROR", retryable: true }, payment: { status: "unknown", next: null } });
  expect(await w.run()).toMatchObject({ ok: true, replayed: true, payment: first.payment });
  w.state.now += 120_000;
  expect((await w.operator.reconcileUnknown({ olderThanMs: 60_000, limit: 10 })).payments).toEqual({ scanned: 1, settled: 0, failed: 0, left: 1, errors: 0 });
  expect(w.alerts.raise).toHaveBeenCalledTimes(1);
  expect(w.alerts.raise).toHaveBeenCalledWith({ alert: { kind: "unknown-aged", workspaceId: "ws", mode: "test", paymentId: first.payment!.id,
    detail: `payment ${first.payment!.id} is unknown: no provider reference (the provider never answered)` } });
  expect(await w.run()).toMatchObject({ ok: true, replayed: true, payment: { id: first.payment!.id, status: "unknown", next: null } });
  const row = await w.kernel.ledger.transaction({ fn: tx => tx.getPayment({ workspaceId: "ws", mode: "test", id: first.payment!.id }) });
  expect(row).toMatchObject({ status: "unknown", intentStatus: "unknown", providerRef: null, capturedMinor: 0 });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 0, stopped: false }); expect(w.order.status).toBe("pending");
  expect(w.send).toHaveBeenCalledTimes(1); expect(w.inner.retrieve).not.toHaveBeenCalled();
  const delivery = w.signed({});
  expect(await w.receiver.receive({ ...delivery, rawBody: Buffer.concat([delivery.rawBody, Buffer.from(" ")]) })).toMatchObject({ status: 400, body: { code: "SIGNATURE_INVALID" } });
  expect(await w.receiver.receive(delivery)).toEqual({ status: 200, body: { received: 1, duplicates: 0, ignored: false } });
  expect(await w.worker.runOnce({ limit: 10 })).toEqual({ seen: 1, applied: 1, parked: 0, dead: 0, quarantined: 0 });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 1, stopped: false });
  expect(await w.payments.getPayment({ scope, paymentId: first.payment!.id })).toMatchObject({ status: "succeeded", captured: total });
  expect([w.order.status, w.order.version]).toEqual(["paid", 2]); expect(w.send).toHaveBeenCalledTimes(1); expect(w.inner.retrieve).not.toHaveBeenCalled();
});
it("settles through a reserved but unbound association after a crash between dispatch and bind", async () => {
  const w = await fixture({}), fault = new Error("association store unavailable");
  vi.mocked(w.orderPayments.bind).mockRejectedValueOnce(fault);
  await expect(w.run()).rejects.toBe(fault);
  expect(w.state.association).toEqual({ ...scope, orderId: "order", amount: total, paymentId: null, createdAt: w.order.createdAt });
  expect(await w.payments.getPayment({ scope, paymentId: w.state.session.metadata.jini_payment_id })).toMatchObject({ status: "requires_action", reference: "order" });
  expect(w.order.status).toBe("pending"); expect(w.orders.markPaid).not.toHaveBeenCalled();
  expect(await w.receiver.receive(w.signed({}))).toEqual({ status: 200, body: { received: 1, duplicates: 0, ignored: false } });
  expect(await w.worker.runOnce({ limit: 10 })).toMatchObject({ applied: 1, quarantined: 0 });
  expect(await w.relay.runOnce({ limit: 10 })).toEqual({ published: 1, stopped: false });
  expect(w.state.association!.paymentId).toBe(w.state.session.metadata.jini_payment_id);
  expect([w.order.status, w.order.version]).toEqual(["paid", 2]); expect(w.send).toHaveBeenCalledTimes(1); expect(w.alerts.raise).not.toHaveBeenCalled();
});
it("concurrent payOrder calls share one payment while the first HTTP response is still in flight", async () => {
  const w = await fixture({}), dispatch = w.send.getMockImplementation()!;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), continued = new Promise<void>(resolve => { release = resolve; });
  w.send.mockImplementationOnce(async args => { enter(); await continued; return dispatch(args); });
  const firstRun = w.run(); await entered;
  const second = await w.run().finally(release), first = await firstRun;
  expect(second).toMatchObject({ ok: true, replayed: true, payment: { status: "unknown", next: null } });
  expect(first).toMatchObject({ ok: true, replayed: false, payment: { status: "requires_action" } });
  expect(first.payment!.id).toBe(second.payment!.id); expect(w.state.association!.paymentId).toBe(first.payment!.id);
  expect(w.send).toHaveBeenCalledTimes(1); expect(w.inner.create).toHaveBeenCalledTimes(1);
  expect(await w.run()).toMatchObject({ ok: true, replayed: true, payment: first.payment });
  await w.receiver.receive(w.signed({})); await w.worker.runOnce({ limit: 10 }); await w.relay.runOnce({ limit: 10 });
  expect([w.order.status, w.order.version]).toEqual(["paid", 2]); expect(w.send).toHaveBeenCalledTimes(1);
});
it("refuses a different mode reservation before any second provider dispatch", async () => {
  const w = await fixture({}); await w.run();
  await expect(payOrder({ deps: w.deps, input: { workspaceId: "ws", orderId: "order", scope: { ...scope, mode: "live" } } }))
    .rejects.toThrow("order already reserved for another scope");
  expect(w.send).toHaveBeenCalledTimes(1); expect(w.state.association!.mode).toBe("test"); expect(w.order.status).toBe("pending");
});
