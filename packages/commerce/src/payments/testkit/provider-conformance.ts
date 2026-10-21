/**
 * @file Provider conformance test-kit (commerce design 2026-10-21, lot L0 skeleton).
 *
 * Every provider plugin (Stripe, PayPal, LiPay, third-party) runs the same cases, so "conforms to
 * the provider contract" is one executable definition instead of each adapter's own reading of
 * `contract/provider.ts`. Test-runner-agnostic on purpose: a case is `{ name, run }` and `run`
 * throws (`node:assert/strict`) on failure, so a plugin repo wires it into vitest, node:test or
 * jest with a one-line loop.
 *
 * Skeleton scope: shape, capability/method consistency, and the two "never throws" rules that
 * keep a provider fault from becoming an unhandled rejection in the kernel. Wire-level cases
 * (recorded webhook fixtures, idempotency replay) are added with the real adapters (L6).
 */
import assert from "node:assert/strict";
import type { IntentRequest, PaymentProvider, ProviderContext } from "../contract/provider.js";
import { CAPABILITY_METHOD_RULES, paymentProviderModuleProblem } from "../provider-module-guard.js";

/** One conformance case; `run` rejects with an assertion error on failure. */
export interface ProviderConformanceCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

export interface ProviderConformanceRequired {
  readonly provider: PaymentProvider;
  /** A fresh context per call: credentials, account, a fake `httpClient`, clock and URLs. */
  readonly makeContext: () => ProviderContext;
}

export interface ProviderConformanceOptional {
  /** Request used for the createIntent case; defaults to 10.00 USD with the provider's capture mode. */
  readonly intentRequest?: IntentRequest;
  /** Body + headers that are NOT a valid webhook for this provider; defaults to unsigned junk bytes. */
  readonly garbageWebhook?: { readonly rawBody: Uint8Array; readonly headers: Readonly<Record<string, string>> };
}

const OUTCOME_KINDS: readonly unknown[] = ["ok", "rejected", "unknown"];

function assertShape(provider: PaymentProvider): void {
  const problem = paymentProviderModuleProblem(provider);
  assert.equal(problem, undefined, `provider shape is invalid: ${problem}`);
}

/** Calls `invoke`, failing the case (never propagating) if it throws or rejects. */
async function neverThrows(label: string, invoke: () => Promise<unknown>): Promise<unknown> {
  try {
    return await invoke();
  } catch (error) {
    return assert.fail(`${label} threw instead of returning an Outcome: ${String(error)}`);
  }
}

function assertOutcome(label: string, value: unknown): { readonly kind: unknown } {
  const outcome = value as { readonly kind?: unknown; readonly error?: { readonly code?: unknown } } | null;
  assert.ok(typeof outcome === "object" && outcome !== null && OUTCOME_KINDS.includes(outcome.kind), `${label} must resolve to an Outcome ({ kind: "ok" | "rejected" | "unknown" })`);
  if (outcome.kind !== "ok") assert.equal(typeof outcome.error?.code, "string", `${label}: an Outcome of kind "${String(outcome.kind)}" must carry a PaymentError`);
  return outcome as { readonly kind: unknown };
}

function defaultIntentRequest(provider: PaymentProvider): IntentRequest {
  return {
    amount: { minorUnits: 1000, currency: "USD" },
    idempotencyKey: "conformance-intent-1",
    correlationId: "pay_conformance_1",
    captureMode: provider.capabilities.capture,
  };
}

const GARBAGE_WEBHOOK = { rawBody: new TextEncoder().encode("not a webhook \u0000ÿ{"), headers: {} };

/**
 * The conformance cases for one provider.
 * @param required.provider - The provider export under test (as the plugin's module exports it).
 * @param required.makeContext - Builds a `ProviderContext` with fake transport for each call.
 * @returns Cases in a stable order; run each and treat a rejection as that case's failure.
 * @complexity O(1) cases; each `run` makes at most one provider call.
 */
export function providerConformanceCases(
  required: ProviderConformanceRequired,
  optional: ProviderConformanceOptional = {}
): ProviderConformanceCase[] {
  const { provider, makeContext } = required;
  return [
    { name: "identity and shape: passes isPaymentProviderModule", run: async () => assertShape(provider) },
    {
      name: "capabilities consistency: every promised operation has its method",
      run: async () => {
        // No assertShape here: the load guard names only the FIRST problem; this case names every missing method.
        const capabilities = provider.capabilities as unknown as Readonly<Record<string, unknown>>;
        const missing = CAPABILITY_METHOD_RULES.filter(([method, , promised]) => promised(capabilities) && typeof provider[method] !== "function")
          .map(([method, rule]) => `${rule} but ${method}() is missing`);
        assert.deepEqual(missing, [], `capabilities promise operations the provider does not implement: ${missing.join("; ")}`);
      },
    },
    {
      name: "verifyWebhook: a garbage body is rejected and never throws",
      run: async () => {
        assertShape(provider);
        const webhook = optional.garbageWebhook ?? GARBAGE_WEBHOOK;
        const outcome = assertOutcome("verifyWebhook", await neverThrows("verifyWebhook", () => provider.verifyWebhook({ ...webhook, ctx: makeContext() })));
        // `rejected`, not merely non-ok: `unknown` would send ingest into retries for a forged delivery.
        assert.equal(outcome.kind, "rejected", "verifyWebhook must reject a garbage body (not accept it, not answer unknown)");
      },
    },
    {
      name: "createIntent: returns an Outcome and never throws",
      run: async () => {
        assertShape(provider);
        const req = optional.intentRequest ?? defaultIntentRequest(provider);
        assertOutcome("createIntent", await neverThrows("createIntent", () => provider.createIntent({ req, ctx: makeContext() })));
      },
    },
  ];
}
