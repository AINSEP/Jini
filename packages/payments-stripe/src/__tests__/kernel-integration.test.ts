/**
 * Stripe → payments service → ledger (review R2-F2): a manual-capture authorization, as Stripe's
 * `requires_capture` intent reports it (`captured: 0`), must land in the ledger as `authorized` and
 * then be capturable through the service — not be quarantined as a bad amount. Uses only the
 * commerce kernel's public entry point (memory ledger, registry, grant store, service); no other
 * plugin is imported.
 */
import { describe, expect, it } from "vitest";
import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import {
  createKernelProviderRegistry, createMemoryGrantStore, createPaymentsService, memoryPaymentsLedger,
  type PaymentScope, type ProviderContextPort,
} from "@jini-ai/commerce/payments/kernel";
import { createStripeProvider } from "../index.js";
import { intentPartiallyCaptured, intentRequiresCapture } from "./fixtures/payment-intent.js";
import { makeContext, NOW_MS } from "./support.js";

const SCOPE: PaymentScope = { workspaceId: "ws", siteId: "site_1", providerId: "stripe", providerAccountId: "acct_1Test", mode: "test" };
const usd = (minorUnits: number) => ({ minorUnits, currency: "USD" });

/** Answers each Stripe call with the fixture for its path, echoing OUR payment id back in `metadata` as Stripe does. */
function stripeServer(): HttpClientPort & { readonly paths: string[] } {
  const paths: string[] = [];
  let paymentId = "";
  return {
    paths,
    send: async ({ request }: { request: HttpRequest }): Promise<HttpResponse> => {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      const form = new URLSearchParams(String(request.body ?? ""));
      paymentId = form.get("metadata[jini_payment_id]") ?? paymentId;
      const fixture = url.pathname.endsWith("/capture") ? intentPartiallyCaptured : intentRequiresCapture;
      return { status: 200, headers: {}, bodyText: JSON.stringify({ ...fixture, metadata: { jini_payment_id: paymentId } }) };
    },
  };
}

describe("Stripe → service → ledger", () => {
  it("a manual authorization (captured 0) is authorized in the ledger, then captured through the service", async () => {
    const http = stripeServer();
    const ledger = memoryPaymentsLedger();
    const providers = createKernelProviderRegistry({ items: [{ pluginId: "payments-stripe", module: createStripeProvider() }] });
    const contexts: ProviderContextPort = { resolve: async () => ({ ok: true, ctx: makeContext(http) }) };
    let seq = 0;
    const now = () => NOW_MS;
    const grants = createMemoryGrantStore({ now, newToken: () => `grant_${++seq}` });
    const service = createPaymentsService({ ledger, providers, contexts, grants, now, newId: () => `id_${++seq}` });

    const authorized = await service.createIntent({ scope: SCOPE, amount: usd(2_000), idempotencyKey: "ik-1", reference: "order-1" }, { captureMode: "manual" });
    expect(authorized).toMatchObject({ ok: true, payment: { status: "authorized", captured: usd(0) } });
    if (!authorized.ok) return;
    const paymentId = authorized.payment.id;
    const quarantine = await ledger.transaction({ fn: (tx) => tx.listQuarantine({ workspaceId: "ws", mode: "test" }) });
    expect(quarantine).toEqual([]);

    const binding = { op: "capture" as const, workspaceId: "ws", mode: "test" as const, paymentId, amount: usd(1_500), idempotencyKey: "ik-cap" };
    const grant = await grants.mint({ binding, expiresAt: NOW_MS + 60_000 });
    const captured = await service.capture({ scope: SCOPE, paymentId, amount: usd(1_500), idempotencyKey: "ik-cap", grant });
    expect(captured).toMatchObject({ ok: true, payment: { status: "succeeded", captured: usd(1_500) } });
    expect(http.paths).toEqual(["POST /v1/payment_intents", `POST /v1/payment_intents/${intentRequiresCapture.id}/capture`]);
  });
});
