import assert from "node:assert/strict";
import { test } from "vitest";
import { ValueValidationFailedError } from "@jini-ai/core/settings";
import { parseFormDeliveryBindings } from "../form-delivery.js";

test("a vendor-shaped secret under an ordinary delivery config key is refused before job serialization", () => {
  const secrets = ["gh" + "p_" + "x".repeat(36), "sk-" + "ant-" + "y".repeat(95), "AI" + "za" + "z".repeat(35)];
  for (const secret of secrets) {
    for (const config of [{ column: secret }, { range: { author: [secret, 1] } }]) {
      assert.throws(() => parseFormDeliveryBindings({ value: [
        { bindingId: "b1", adapterId: "rows", connectionRef: "conn-1", enabled: true, config },
      ] }), (error: unknown) => {
        assert.ok(error instanceof ValueValidationFailedError);
        assert.match(error.message, /^Form delivery bindings \(core\.forms\.deliveryBindings\) binding 1: /);
        assert.equal(error.message.includes(secret), false);
        return true;
      });
    }
  }
});

test("ordinary form-delivery config values remain accepted", () => {
  const bindings = [{ bindingId: "b1", adapterId: "rows", connectionRef: "conn-1", enabled: true,
    config: { branch: "main", endpoint: "https://example.com/hook" } }];
  assert.deepEqual(parseFormDeliveryBindings({ value: bindings }), bindings);
});
