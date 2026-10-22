import assert from "node:assert/strict";
import test from "node:test";

import { readCommerceStatus } from "../../index.js";

/**
 * @file ADR-001 bounded Commerce status read-model contract.
 *
 * The read model may describe only capabilities supplied by the composed payment runtime. It must
 * not turn provider registration into a claim that configuration, checkout, subscriptions,
 * webhook reconciliation, or revenue projections are operational.
 */

test("commerce status: reports an honest unavailable snapshot when no payment runtime is composed", () => {
  const status = readCommerceStatus({
    workspaceId: "workspace-1",
    resolvePaymentRuntime: () => null,
  });

  assert.deepEqual(status, {
    contractVersion: 1,
    workspaceId: "workspace-1",
    paymentRuntime: {
      status: "unavailable",
      reason: "No payment runtime is composed for this workspace.",
    },
    providers: [],
    configuration: {
      status: "unavailable",
      schema: null,
      reason: "The payment runtime does not expose a provider configuration contract.",
    },
    capabilities: {
      providerDiscovery: "unavailable",
      checkout: "unavailable",
      subscriptions: "unavailable",
      webhookReconciliation: "unavailable",
      revenue: "unavailable",
    },
  });
});

test("commerce status: preserves runtime provider declarations without promoting them to operational readiness", () => {
  const confirmation = ["redirect", "out_of_band"] as const;
  const currencies = ["KES", "USD"] as const;
  const regionalProvider = {
    id: "regional-pay",
    displayName: "Regional Pay",
    adapterInternal: "must-not-leak",
    capabilities: {
      refunds: "partial" as const,
      tokenization: false,
      recurring: true,
      confirmation,
      currencies,
      webhooks: true,
      adapterInternal: "must-not-leak",
    },
  };
  const status = readCommerceStatus({
    workspaceId: "workspace-1",
    resolvePaymentRuntime: () => ({
      listProviders: () => [
        regionalProvider,
        {
          id: "global-pay",
          displayName: "Global Pay",
          capabilities: {
            refunds: "none",
            tokenization: false,
            recurring: false,
            confirmation: ["none"],
            currencies: "any",
            webhooks: false,
          },
        },
      ],
    }),
  });

  assert.equal(status.paymentRuntime.status, "available");
  assert.equal(status.paymentRuntime.reason, null);
  assert.equal(status.capabilities.providerDiscovery, "available");
  assert.deepEqual(status.providers, [
    {
      id: "regional-pay",
      displayName: "Regional Pay",
      capabilities: {
        refunds: "partial",
        tokenization: false,
        recurring: true,
        confirmation: ["redirect", "out_of_band"],
        currencies: ["KES", "USD"],
        webhooks: true,
      },
    },
    {
      id: "global-pay",
      displayName: "Global Pay",
      capabilities: {
        refunds: "none",
        tokenization: false,
        recurring: false,
        confirmation: ["none"],
        currencies: "any",
        webhooks: false,
      },
    },
  ]);
  assert.notStrictEqual(status.providers[0], regionalProvider);
  assert.notStrictEqual(status.providers[0]?.capabilities.confirmation, confirmation);
  assert.notStrictEqual(status.providers[0]?.capabilities.currencies, currencies);
  assert.equal("adapterInternal" in (status.providers[0] ?? {}), false);
  assert.equal("adapterInternal" in (status.providers[0]?.capabilities ?? {}), false);
  assert.deepEqual(status.configuration, {
    status: "unavailable",
    schema: null,
    reason: "The payment runtime does not expose a provider configuration contract.",
  });
  assert.deepEqual(status.capabilities, {
    providerDiscovery: "available",
    checkout: "unavailable",
    subscriptions: "unavailable",
    webhookReconciliation: "unavailable",
    revenue: "unavailable",
  });
});
