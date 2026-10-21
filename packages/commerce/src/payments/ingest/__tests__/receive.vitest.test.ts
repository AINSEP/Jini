import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import type { WebhookFact } from "../../contract/evidence.js";
import { paymentError, type PaymentProvider } from "../../contract/provider.js";
import { createKernelProviderRegistry, type ProviderContextPort } from "../../provider-registry.js";
import { createWebhookReceiver, type ResolvedEndpoint, type WebhookEndpointPort } from "../receive.js";
import { PATH, SCOPE, ingestWorld } from "./harness.js";

/**
 * @file Webhook receive: endpoint scope from host config (never the payload), verify over the
 * exact bytes, insert-or-ignore each fact into the inbox, never apply in the request.
 */

describe("resolveEndpoint", () => {
  test("a configured endpoint of a loaded provider resolves to its verified scope", async () => {
    const w = await ingestWorld();
    const resolved = await w.receiver.resolveEndpoint({ path: PATH });
    expect(resolved).toEqual({ ok: true, endpoint: { scope: SCOPE, provider: w.provider } });
  });

  test("an unknown endpoint is a 404", async () => {
    const w = await ingestWorld();
    const resolved = await w.receiver.resolveEndpoint({ path: { ...PATH, endpointId: "nope" } });
    expect(resolved).toEqual({ ok: false, response: { status: 404, body: { code: "ENDPOINT_NOT_FOUND", message: "no such webhook endpoint" } } });
  });

  test.each([
    ["another site", { ...SCOPE, siteId: "other-site" }],
    ["another provider", { ...SCOPE, providerId: "stripe" }],
    ["an unusable scope", { ...SCOPE, workspaceId: " " }],
  ])("config that names %s than the URL is a 404, never trusted", async (_label, scope) => {
    const w = await ingestWorld();
    w.endpointTable.set("site/lipay/ep1", scope);
    const resolved = await w.receiver.resolveEndpoint({ path: PATH });
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.response.status).toBe(404);
  });

  test("a configured endpoint whose provider plugin is not loaded is a 503 (the provider redelivers later)", async () => {
    const w = await ingestWorld();
    const receiver = createWebhookReceiver({ ...w, providers: createKernelProviderRegistry({ items: [] }) });
    const resolved = await receiver.resolveEndpoint({ path: PATH });
    expect(resolved).toEqual({ ok: false, response: { status: 503, body: { code: "PROVIDER_NOT_REGISTERED", message: "payments provider is not loaded" } } });
  });

  test("the abort signal is handed to the host's endpoint port, and omitted when there is none", async () => {
    const w = await ingestWorld();
    const seen: unknown[] = [];
    const endpoints: WebhookEndpointPort = { resolve: async (path, optional) => { seen.push(optional); return w.endpoints.resolve(path); } };
    const receiver = createWebhookReceiver({ ...w, endpoints });
    const signal = new AbortController().signal;
    await receiver.resolveEndpoint({ path: PATH }, { signal });
    await receiver.resolveEndpoint({ path: PATH });
    expect(seen).toEqual([{ signal }, {}]);
  });
});

describe("receive", () => {
  async function endpointOf(w: Awaited<ReturnType<typeof ingestWorld>>): Promise<ResolvedEndpoint> {
    const resolved = await w.receiver.resolveEndpoint({ path: PATH });
    if (!resolved.ok) throw new Error("unresolved");
    return resolved.endpoint;
  }

  test("a signed delivery records the fact (not the body) with the body hash, due now, and is NOT applied", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.charge();
    const delivery = w.fake.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "evt_1" });
    const response = await w.receiver.receive({ endpoint: await endpointOf(w), ...delivery });
    expect(response).toEqual({ status: 200, body: { received: 1, duplicates: 0 } });
    const [row] = await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 10 }));
    expect(row).toMatchObject({
      ...SCOPE, providerEventId: "evt_1", state: "received", attempts: 0, nextAttemptAt: w.now(), receivedAt: w.now(),
      bodySha256: createHash("sha256").update(delivery.rawBody).digest("hex"),
    });
    const fact = JSON.parse(row!.factsJson!) as WebhookFact;
    expect(fact).toMatchObject({ providerEventId: "evt_1", providerRef: "ch_1", evidence: { providerRef: "ch_1", status: "succeeded", correlationId: "pay_1" } });
    expect(row!.factsJson).not.toContain(Buffer.from(delivery.rawBody).toString("utf8"));
    const { payment, outbox } = await w.read();
    expect(payment.intentStatus).toBe("unknown");
    expect(outbox).toEqual([]);
  });

  test("a redelivery of the same provider event is acknowledged as a duplicate, not recorded twice", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.charge();
    expect(await w.deliver("charge.succeeded", "ch_1", "evt_1")).toEqual({ status: 200, body: { received: 1, duplicates: 0 } });
    expect(await w.deliver("charge.succeeded", "ch_1", "evt_1")).toEqual({ status: 200, body: { received: 0, duplicates: 1 } });
    expect(await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 10 }))).toHaveLength(1);
  });

  test("a body tampered with after signing is a 400 SIGNATURE_INVALID and nothing is recorded", async () => {
    const w = await ingestWorld();
    await w.insertPayment();
    await w.charge();
    const delivery = w.fake.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "evt_1" });
    const tampered = Buffer.from(Buffer.from(delivery.rawBody).toString("utf8").replace("evt_1", "evt_2"));
    const response = await w.receiver.receive({ endpoint: await endpointOf(w), rawBody: tampered, headers: delivery.headers });
    expect(response).toEqual({ status: 400, body: { code: "SIGNATURE_INVALID", message: "webhook rejected" } });
    expect(await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 10 }))).toEqual([]);
  });

  test("a verifier that cannot decide now is a 503, so the provider redelivers", async () => {
    const w = await ingestWorld();
    const endpoint = { ...(await endpointOf(w)) };
    const provider: PaymentProvider = {
      ...endpoint.provider,
      verifyWebhook: async () => ({ kind: "unknown", error: paymentError({ code: "TRANSPORT_ERROR", message: "jwks fetch timed out: secret-ish detail" }) }),
    };
    const response = await w.receiver.receive({ endpoint: { ...endpoint, provider }, rawBody: Buffer.from("{}"), headers: {} });
    expect(response).toEqual({ status: 503, body: { code: "TRANSPORT_ERROR", message: "webhook could not be verified now; retry" } });
  });

  test("missing credentials are a 503 with the error code (never the provider's text), and the signal reaches the context port", async () => {
    const w = await ingestWorld();
    const seen: unknown[] = [];
    const contexts: ProviderContextPort = {
      resolve: async (_required, optional) => {
        seen.push(optional);
        return { ok: false, error: paymentError({ code: "NO_CREDENTIALS_CONFIGURED", message: "slot webhookSecret empty" }) };
      },
    };
    const receiver = createWebhookReceiver({ ...w, contexts });
    const signal = new AbortController().signal;
    const endpoint = await endpointOf(w);
    const response = await receiver.receive({ endpoint, rawBody: Buffer.from("{}"), headers: {} }, { signal });
    await receiver.receive({ endpoint, rawBody: Buffer.from("{}"), headers: {} });
    expect(response).toEqual({ status: 503, body: { code: "NO_CREDENTIALS_CONFIGURED", message: "payments provider is not configured for this endpoint" } });
    expect(seen).toEqual([{ signal }, {}]);
  });

  test("several facts in one delivery are recorded in one transaction; zero facts is a plain 200", async () => {
    const w = await ingestWorld();
    const endpoint = await endpointOf(w);
    const facts: WebhookFact[] = [{ providerEventId: "evt_a", providerRef: "ch_1" }, { providerEventId: "evt_b", providerRef: "ch_1" }];
    const many = { ...endpoint.provider, verifyWebhook: async () => ({ kind: "ok" as const, value: facts }) };
    expect(await w.receiver.receive({ endpoint: { ...endpoint, provider: many }, rawBody: Buffer.from("x"), headers: {} }))
      .toEqual({ status: 200, body: { received: 2, duplicates: 0 } });
    const none = { ...endpoint.provider, verifyWebhook: async () => ({ kind: "ok" as const, value: [] }) };
    expect(await w.receiver.receive({ endpoint: { ...endpoint, provider: none }, rawBody: Buffer.from("x"), headers: {} }))
      .toEqual({ status: 200, body: { received: 0, duplicates: 0 } });
    const rows = await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 10 }));
    expect(rows.map((r) => r.providerEventId).sort()).toEqual(["evt_a", "evt_b"]);
  });

  test.each([
    ["an empty event id", { providerEventId: "", providerRef: "ch_1" }],
    ["a missing provider ref", { providerEventId: "evt_1" }],
    ["a null fact", null],
  ])("a provider plugin returning a fact with %s is a 500 (our side; the provider retries) and nothing is recorded", async (_label, bad) => {
    const w = await ingestWorld();
    const endpoint = await endpointOf(w);
    const good: WebhookFact = { providerEventId: "evt_ok", providerRef: "ch_1" };
    const provider = { ...endpoint.provider, verifyWebhook: async () => ({ kind: "ok" as const, value: [good, bad as unknown as WebhookFact] }) };
    const response = await w.receiver.receive({ endpoint: { ...endpoint, provider }, rawBody: Buffer.from("x"), headers: {} });
    expect(response).toEqual({ status: 500, body: { code: "INVALID_FACT", message: "payments provider returned an unusable webhook fact" } });
    expect(await w.tx((t) => t.listDueInbox({ now: w.now(), limit: 10 }))).toEqual([]);
  });

  test("a ledger failure propagates (the HTTP adapter answers 500) and records nothing", async () => {
    const w = await ingestWorld();
    const endpoint = await endpointOf(w);
    await w.insertPayment();
    await w.charge();
    const failing = { transaction: async () => { throw new Error("db down"); } };
    const receiver = createWebhookReceiver({ ...w, ledger: failing });
    const delivery = w.fake.server.webhook({ type: "charge.succeeded", id: "ch_1", eventId: "evt_1" });
    await expect(receiver.receive({ endpoint, ...delivery })).rejects.toThrow("db down");
  });
});
