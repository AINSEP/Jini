import assert from "node:assert/strict";
import test from "node:test";

import { readCommerceStatus } from "../../status.js";

test("an unexpected payment-adapter failure propagates instead of reporting an unavailable runtime", () => {
  // F6.2: swallowing listProviders errors as [] would ship an untruthful status.
  const fault = new Error("registry corrupt");
  assert.throws(() => readCommerceStatus({ workspaceId: "ws", resolvePaymentRuntime: () => ({ listProviders: () => { throw fault; } }) }), (error) => error === fault);
});

test("an available runtime with no providers still exposes discovery and a fresh configuration snapshot", () => {
  const input = { workspaceId: "ws-b", resolvePaymentRuntime: () => ({ listProviders: () => [] }) };
  const first = readCommerceStatus(input);
  assert.deepEqual(first.paymentRuntime, { status: "available", reason: null });
  assert.deepEqual(first.providers, []);
  assert.equal(first.capabilities.providerDiscovery, "available");
  (first.configuration as { reason: string }).reason = "caller mutation";
  assert.deepEqual(readCommerceStatus(input).configuration, { status: "unavailable", schema: null, reason: "The payment runtime does not expose a provider configuration contract." });
});
