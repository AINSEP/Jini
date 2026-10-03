import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { resolveDefinition, resolveDefinitionRaw } from "../settings.js";
import type { SettingDefinitionRecord } from "../types.js";

function definition(key: string, target?: string, status: SettingDefinitionRecord["status"] = "active"): SettingDefinitionRecord {
  return {
    settingId: key, version: 1, workspaceId: null, namespace: "core.guard", key,
    ownerKind: "core", ownerId: null, schema: { type: "string" }, defaultValue: "default",
    scopes: 7, secret: false, status: target ? "alias" : status,
    aliasOfNamespace: target ? "core.guard" : null, aliasOfKey: target ?? null,
    coercionTag: null, createdAt: "t0", updatedAt: "t0",
  };
}

for (const [name, definitions] of [
  ["self cycle", [definition("a", "a")]],
  ["two-key cycle", [definition("a", "b"), definition("b", "a")]],
  ["depth two", [definition("a", "b"), definition("b", "c"), definition("c")]],
] as const) {
  test(`alias resolution fails closed on ${name} with bounded reads`, async () => {
    const repo = new InMemorySettingsRepo({ definitions: [...definitions] });
    const find = repo.findActiveDefinition.bind(repo);
    let reads = 0;
    repo.findActiveDefinition = async (input) => {
      // A finite fault also prevents the old recursive implementation from hanging this test.
      assert.ok(++reads <= 2, "resolution must never follow more than one alias");
      return find(input);
    };
    const input = { namespace: "core.guard", key: "a", workspaceId: null };
    assert.equal(await resolveDefinitionRaw({ repo }, input), null);
    reads = 0;
    assert.equal(await resolveDefinition({ repo }, input), null);
  });
}

test("one alias still resolves through platform fallback and preserves tombstone status on the raw path", async () => {
  for (const status of ["active", "tombstone"] as const) {
    const target = definition("b", undefined, status);
    const repo = new InMemorySettingsRepo({ definitions: [definition("a", "b"), target] });
    const input = { namespace: "core.guard", key: "a", workspaceId: "ws-1" };
    assert.deepEqual(await resolveDefinitionRaw({ repo }, input), target);
    assert.deepEqual(await resolveDefinition({ repo }, input), status === "tombstone" ? null : target);
  }
});
