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

const targetBinding = { bindingId: "orders", adapterId: "rows", connectionRef: "team-db", enabled: true, config: {} };

test.each([
  { label: "non-string reference", patch: { adapterId: true }, detail: "adapterId must be a non-empty string of at most 256 characters." },
  { label: "empty reference", patch: { connectionRef: "" }, detail: "connectionRef must be a non-empty string of at most 256 characters." },
  { label: "oversize reference", patch: { bindingId: "a".repeat(257) }, detail: "bindingId must be a non-empty string of at most 256 characters." },
  { label: "scalar formIds", patch: { formIds: "checkout" }, detail: "formIds must be a list of form ids (omit it for every form)." },
  { label: "oversize formIds list", patch: { formIds: Array.from({ length: 1001 }, (_, i) => `form-${i}`) }, detail: "formIds has 1001 entries; at most 1000 are allowed (omit formIds to mean every form)." },
  { label: "non-string middle form ID", patch: { formIds: ["checkout", 1, "refund"] }, detail: "every formIds entry must be a non-empty string of at most 256 characters." },
])("rejects $label with field-specific guidance", ({ patch, detail }) => {
  assert.throws(() => parseFormDeliveryBindings({ value: [{ ...targetBinding, ...patch }] }), (error: unknown) =>
    error instanceof ValueValidationFailedError &&
    error.message === `Form delivery bindings (core.forms.deliveryBindings) binding 1: ${detail}`);
});

test("keeps an empty selection distinct from all forms and accepts the maximum explicit list", () => {
  const formIds = Array.from({ length: 1000 }, (_, i) => `form-${i}`);
  const inputs = [
    { ...targetBinding },
    { ...targetBinding, bindingId: "no-forms", formIds: [] },
    { ...targetBinding, bindingId: "a".repeat(256), formIds },
  ];
  assert.deepEqual(parseFormDeliveryBindings({ value: inputs }), inputs);
});
