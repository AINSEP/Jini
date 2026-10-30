import { describe, expect, it, vi } from "vitest";
import { leasedProviderItem, paymentsProviderContract } from "../../kernel.js";
import type { PaymentProvider } from "../../contract/provider.js";
import { createLipayFake, lipayFakeContext } from "../../testkit/lipay-fake.js";

const methods = [
  ["createIntent", "rejected", false], ["refund", "rejected", false], ["capture", "rejected", false],
  ["void", "rejected", false], ["retrieve", "unknown", true], ["verifyWebhook", "unknown", true],
] as const;
const outcome = { kind: "rejected", error: { code: "DECLINED", message: "provider declined", retryable: false } } as const;
const required = {
  req: { providerRef: "charge", amount: { minorUnits: 100, currency: "USD" }, idempotencyKey: "key", correlationId: "payment", captureMode: "auto" as const },
  providerRef: "charge", ctx: lipayFakeContext({ now: () => 0 }), rawBody: new Uint8Array([1]), headers: { signature: "opaque" },
};

function wrap(port: PaymentProvider) {
  let current = true;
  const isCurrent = vi.fn(() => current);
  const item = leasedProviderItem({ pluginId: "payments-fake", lease: { port, isCurrent } });
  if ("problem" in item) throw new Error(item.problem);
  return { item, isCurrent, retire: () => { current = false; } };
}

describe("payments provider contract and lease", () => {
  it("accepts the real fake and refuses malformed ports through the domain validator", () => {
    const provider = createLipayFake({ now: () => 0 }).provider;
    expect(paymentsProviderContract.contract).toBe("payments");
    expect(paymentsProviderContract.validate({ provider })).toBeUndefined();
    expect(paymentsProviderContract.validate({ provider: { ...provider, createIntent: undefined } }, {})).toBe("createIntent must be a function");
    expect(leasedProviderItem({ pluginId: "bad", lease: { port: null, isCurrent: () => true } }, {}))
      .toEqual({ problem: "its module's default export is not an object" });
  });

  it.each(methods)("guards %s on every call, forwards arguments, and admits no retired call", async (method, kind, retryable) => {
    const inner = vi.fn(async function (this: PaymentProvider) { expect(this.id).toBe("lipay"); return outcome; });
    const fake = createLipayFake({ now: () => 0 }).provider;
    const port: PaymentProvider = { ...fake, capabilities: { ...fake.capabilities, capture: "manual", void: true },
      createIntent: inner, refund: inner, capture: inner, void: inner, retrieve: inner, verifyWebhook: inner };
    const h = wrap(port);
    expect(await h.item.module[method]!(required)).toEqual(outcome);
    expect(inner.mock.calls).toEqual([[required, {}]]);
    h.retire();
    expect(await h.item.module[method]!(required, {})).toEqual({ kind,
      error: { code: "PROVIDER_NOT_REGISTERED", message: "payment provider lease is retired", retryable } });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(h.isCurrent.mock.calls).toEqual([[{}], [{}]]);
  });

  it("forwards cancellation and refund options unchanged", async () => {
    const fake = createLipayFake({ now: () => 0 }).provider;
    const inner = vi.fn(async () => outcome);
    const { item } = wrap({ ...fake, createIntent: inner, refund: inner });
    const options = { signal: new AbortController().signal, reason: "requested" };
    await item.module.createIntent(required, options);
    await item.module.refund!(required, options);
    expect(inner.mock.calls).toEqual([[required, options], [required, options]]);
  });

  it("snapshots identity, capabilities and credentials independently of plugin mutations", () => {
    const fake = createLipayFake({ now: () => 0 }).provider;
    const currencies = ["USD"], credentialKeys = ["secretKey"];
    const port = { ...fake, capabilities: { ...fake.capabilities, currencies }, credentialKeys };
    const { item } = wrap(port);
    Object.assign(port, { id: "changed", displayName: "Changed" });
    currencies.push("EUR"); credentialKeys.push("other");
    Object.assign(port.capabilities, { capture: "manual" });
    (port.capabilities.confirmation as string[]).push("redirect");
    expect([item.pluginId, item.module.id, item.module.displayName, item.module.credentialKeys])
      .toEqual(["payments-fake", "lipay", "LiPay (fake)", ["secretKey"]]);
    expect(item.module.capabilities).toEqual({ refunds: "partial", capture: "auto", void: false, disputes: false,
      retrieve: "payment+refunds", echoesCorrelation: true, confirmation: ["none"], currencies: ["USD"] });
    expect(Object.isFrozen(item.module)).toBe(true);
    expect(Object.isFrozen(item.module.capabilities)).toBe(true);
    expect(Object.isFrozen(item.module.capabilities.currencies)).toBe(true);
    expect(Object.isFrozen(item.module.capabilities.confirmation)).toBe(true);
    expect(Object.isFrozen(item.module.credentialKeys)).toBe(true);
  });

  it("keeps unsupported operations absent and preserves unrestricted currencies", () => {
    const fake = createLipayFake({ now: () => 0 }).provider;
    const { item } = wrap({ ...fake, capabilities: { ...fake.capabilities, refunds: "none", retrieve: "none" }, refund: undefined, retrieve: undefined });
    expect([item.module.refund, item.module.capture, item.module.void, item.module.retrieve]).toEqual([undefined, undefined, undefined, undefined]);
    expect(item.module.capabilities.currencies).toBe("any");
  });
});
