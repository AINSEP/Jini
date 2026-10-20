import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { definition, fixture } from "./write-tool-fixture.js";

/** Pins for the `settings_set_value` dotted-key input normalizer. */

function normalizer(f: ReturnType<typeof fixture>) {
  const normalize = f.registrations.find((r) => r.descriptor.id === "settings_set_value")!.normalizeInput;
  assert.ok(normalize, "settings_set_value must carry an input normalizer");
  return async (input: Record<string, unknown>) => normalize({ input });
}

test("input that already names a namespace passes through untouched", async () => {
  const f = fixture();
  const find = vi.spyOn(f.settingsRepo, "findActiveDefinition");
  const input = { namespace: "core.presentation", key: "a.b", value: 1 };
  assert.deepEqual(await normalizer(f)(input), { input, notes: [] });
  assert.equal(find.mock.calls.length, 0);
});

for (const [label, key] of [["a non-string key", 5], ["an undotted key", "timezone"]] as const) {
  test(`${label} passes through untouched`, async () => {
    const f = fixture();
    const input = { key, value: 1 };
    assert.deepEqual(await normalizer(f)(input), { input, notes: [] });
  });
}

test("a unique split is resolved into namespace and key with a note", async () => {
  const f = fixture();
  assert.deepEqual(await normalizer(f)({ key: "core.presentation.timezone", value: "x" }), {
    input: { key: "timezone", namespace: "core.presentation", value: "x" }, notes: ["dotted key→namespace + key"],
  });
});

test("a split matching only a tombstoned definition does not count", async () => {
  const f = fixture([definition({ status: "tombstone" })]);
  await assert.rejects(() => normalizer(f)({ key: "core.presentation.timezone", value: "x" }), { name: "ToolInputError", message: "settings_set_value: no registered namespace/key pair matches this dotted key. Call settings_list_definitions to see valid keys; send namespace and key explicitly." });
});

test("two matching splits are refused as ambiguous, listing both", async () => {
  const f = fixture([definition(), definition({ settingId: "s2", namespace: "core", key: "presentation.timezone" })]);
  await assert.rejects(() => normalizer(f)({ key: "core.presentation.timezone", value: "x" }), { name: "ToolInputError", message: "settings_set_value: dotted key is ambiguous (namespace=core, key=presentation.timezone; namespace=core.presentation, key=timezone). Send namespace and key explicitly." });
});

test("leading and trailing dots are never split points", async () => {
  const f = fixture([definition({ namespace: "", key: "a" }), definition({ settingId: "s2", namespace: "a", key: "" })]);
  const find = vi.spyOn(f.settingsRepo, "findActiveDefinition");
  for (const key of [".a", "a."]) {
    await assert.rejects(() => normalizer(f)({ key, value: "x" }), { name: "ToolInputError", message: /^settings_set_value: no registered namespace\/key pair matches this dotted key\./ });
  }
  assert.equal(find.mock.calls.length, 0);
});

test("a dotted key over 512 characters is refused before readiness is awaited", async () => {
  const f = fixture(undefined, { settingsReady: new Promise<void>(() => {}) });
  await assert.rejects(() => normalizer(f)({ key: `a.${"b".repeat(511)}`, value: "x" }), { name: "ToolInputError", message: "settings_set_value: dotted key is too long. Send namespace and key separately." });
});

test("a dotted key of exactly 512 characters is resolved", async () => {
  const key = "b".repeat(510);
  const f = fixture([definition({ namespace: "a", key })]);
  assert.deepEqual((await normalizer(f)({ key: `a.${key}`, value: "x" })).notes, ["dotted key→namespace + key"]);
});
