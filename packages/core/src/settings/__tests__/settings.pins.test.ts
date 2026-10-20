import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { InMemorySettingsRepo } from "../repo.memory.js";
import { getEffective, registerCoercer, resolveDefinitionRaw, validateDefinitionInput, validateValueAgainstSchema } from "../settings.js";
import type { SettingDefinitionRecord, SettingValueRecord } from "../types.js";

/** Pins for `settings.ts` branches the resolver/registration suites leave open. */

const NOW = "2026-10-01T00:00:00.000Z";

function definition(overrides: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord {
  return {
    settingId: "setting-1", version: 1, workspaceId: null, namespace: "core.presentation", key: "timezone",
    ownerKind: "core", ownerId: null, schema: { type: "string" }, defaultValue: "UTC", scopes: 7,
    secret: false, status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

function value(overrides: Partial<SettingValueRecord>): SettingValueRecord {
  return {
    settingId: "setting-1", scope: "global", workspaceId: null, principalId: null, valueJson: "x", state: "set",
    defVersion: 1, seq: 1, updatedBy: "actor-1", updatedAt: NOW, originPluginId: null, ...overrides,
  };
}

const coordinate = { namespace: "core.presentation", key: "timezone" };

test("validateValueAgainstSchema accepts numbers only for a number schema", () => {
  assert.equal(validateValueAgainstSchema({ type: "number" }, 3), true);
  assert.equal(validateValueAgainstSchema({ type: "number" }, "3"), false);
});

test("validateDefinitionInput fences theme definitions to theme.* with a null workspace", () => {
  const base = { key: "k", ownerKind: "theme" as const, schema: { type: "string" as const }, defaultValue: "x", scopes: 1, secret: false };
  assert.deepEqual(validateDefinitionInput({ ...base, namespace: "theme.paper", workspaceId: null }), { valid: true });
  const rejected = validateDefinitionInput({ ...base, namespace: "core.paper", workspaceId: null });
  assert.equal(rejected.valid, false);
  assert.equal(!rejected.valid && rejected.error.message, "namespace 'core.paper' does not match the owner fence for owner_kind 'theme'");
});

test("getEffective returns a stale-version value unchanged when the definition has no coercion tag", async () => {
  const repo = new InMemorySettingsRepo({ definitions: [definition({ version: 2 })], globalValues: [value({ valueJson: "old", defVersion: 1 })] });
  assert.deepEqual(await getEffective({ repo }, { ...coordinate, scopeContext: {} }), { value: "old", sourceLayer: "global", defVersion: 2 });
});

test("getEffective falls back to identity when the coercion tag was never registered", async () => {
  const repo = new InMemorySettingsRepo({ definitions: [definition({ version: 2, coercionTag: "never-registered" })], globalValues: [value({ valueJson: "old", defVersion: 1 })] });
  assert.deepEqual(await getEffective({ repo }, { ...coordinate, scopeContext: {} }), { value: "old", sourceLayer: "global", defVersion: 2 });
});

test("getEffective coerces a stale user-layer value with the registered coercer", async () => {
  registerCoercer({ tag: "pins-suffix", fn: ({ value: stored }) => `${String(stored)}!` });
  const repo = new InMemorySettingsRepo({
    definitions: [definition({ version: 3, coercionTag: "pins-suffix" })],
    userValues: [value({ scope: "user", workspaceId: "ws-1", principalId: "p-1", valueJson: "u", defVersion: 2 })],
  });
  assert.deepEqual(await getEffective({ repo }, { ...coordinate, scopeContext: { workspaceId: "ws-1", principalId: "p-1" } }), { value: "u!", sourceLayer: "user", defVersion: 3 });
});

test("getEffective skips the user layer when only a principal (no workspace) is given", async () => {
  const repo = new InMemorySettingsRepo({ definitions: [definition()] });
  const user = vi.spyOn(repo, "getUserValue");
  const workspace = vi.spyOn(repo, "getWorkspaceValue");
  assert.deepEqual(await getEffective({ repo }, { ...coordinate, scopeContext: { principalId: "p-1" } }), { value: "UTC", sourceLayer: "default", defVersion: 1 });
  assert.equal(user.mock.calls.length, 0);
  assert.equal(workspace.mock.calls.length, 0);
});

test("getEffective reads the workspace but not the user layer when no principal is given", async () => {
  const repo = new InMemorySettingsRepo({ definitions: [definition()], workspaceValues: [value({ scope: "workspace", workspaceId: "ws-1", valueJson: "ws" })] });
  const user = vi.spyOn(repo, "getUserValue");
  assert.deepEqual(await getEffective({ repo }, { ...coordinate, scopeContext: { workspaceId: "ws-1" } }), { value: "ws", sourceLayer: "workspace", defVersion: 1 });
  assert.equal(user.mock.calls.length, 0);
});

test("resolveDefinitionRaw rejects a self-alias after a single lookup", async () => {
  const repo = new InMemorySettingsRepo({ definitions: [definition({ status: "alias", aliasOfNamespace: coordinate.namespace, aliasOfKey: coordinate.key })] });
  const find = vi.spyOn(repo, "findActiveDefinition");
  assert.equal(await resolveDefinitionRaw({ repo }, { ...coordinate, workspaceId: null }), null);
  assert.equal(find.mock.calls.length, 1);
});

test("resolveDefinitionRaw rejects an alias of an alias (depth > 1)", async () => {
  const repo = new InMemorySettingsRepo({ definitions: [
    definition({ settingId: "a", status: "alias", aliasOfNamespace: "core.b", aliasOfKey: "b" }),
    definition({ settingId: "b", namespace: "core.b", key: "b", status: "alias", aliasOfNamespace: "core.c", aliasOfKey: "c" }),
    definition({ settingId: "c", namespace: "core.c", key: "c" }),
  ] });
  assert.equal(await resolveDefinitionRaw({ repo }, { ...coordinate, workspaceId: null }), null);
});

test("resolveDefinitionRaw rejects an alias with a missing target coordinate", async () => {
  for (const malformed of [{ aliasOfNamespace: null, aliasOfKey: "k" }, { aliasOfNamespace: "core.x", aliasOfKey: null }]) {
    const repo = new InMemorySettingsRepo({ definitions: [definition({ status: "alias", ...malformed })] });
    assert.equal(await resolveDefinitionRaw({ repo }, { ...coordinate, workspaceId: null }), null);
  }
});

test("resolveDefinitionRaw follows a workspace alias to a platform target via the null-partition fallback", async () => {
  const target = definition({ settingId: "target", namespace: "core.target", key: "t" });
  const repo = new InMemorySettingsRepo({ definitions: [
    definition({ settingId: "alias", workspaceId: "ws-1", namespace: "site.alias", key: "a", ownerKind: "site", status: "alias", aliasOfNamespace: "core.target", aliasOfKey: "t" }),
    target,
  ] });
  const find = vi.spyOn(repo, "findActiveDefinition");
  assert.equal((await resolveDefinitionRaw({ repo }, { namespace: "site.alias", key: "a", workspaceId: "ws-1" }))?.settingId, "target");
  assert.deepEqual(find.mock.calls.map(([call]) => call), [
    { namespace: "site.alias", key: "a", workspaceId: "ws-1" },
    { namespace: "core.target", key: "t", workspaceId: "ws-1" },
    { namespace: "core.target", key: "t", workspaceId: null },
  ]);
});

test("resolveDefinitionRaw returns null for a dangling alias target", async () => {
  const repo = new InMemorySettingsRepo({ definitions: [definition({ status: "alias", aliasOfNamespace: "core.gone", aliasOfKey: "g" })] });
  assert.equal(await resolveDefinitionRaw({ repo }, { ...coordinate, workspaceId: "ws-1" }), null);
});

test("resolveDefinitionRaw returns a tombstoned row as stored", async () => {
  const repo = new InMemorySettingsRepo({ definitions: [definition({ status: "tombstone" })] });
  assert.equal((await resolveDefinitionRaw({ repo }, { ...coordinate, workspaceId: null }))?.status, "tombstone");
});

test("getEffective leaves a current-version value uncoerced even when a coercer is registered", async () => {
  registerCoercer({ tag: "pins-current", fn: () => "coerced" });
  const repo = new InMemorySettingsRepo({ definitions: [definition({ version: 2, coercionTag: "pins-current" })], globalValues: [value({ valueJson: "fresh", defVersion: 2 })] });
  assert.deepEqual(await getEffective({ repo }, { ...coordinate, scopeContext: {} }), { value: "fresh", sourceLayer: "global", defVersion: 2 });
});
