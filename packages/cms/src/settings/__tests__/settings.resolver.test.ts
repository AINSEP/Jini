import assert from "node:assert/strict";
import { test } from "vitest";

import { getEffective, registerCoercer } from "../settings.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import type { SettingDefinitionRecord, SettingValueRecord } from "../types.js";

const NOW = "2026-07-11T00:00:00.000Z";

function definition(overrides: Partial<SettingDefinitionRecord> = {}): SettingDefinitionRecord {
  return {
    settingId: "setting-1",
    version: 1,
    workspaceId: null,
    namespace: "core.presentation",
    key: "activeThemeId",
    ownerKind: "core",
    ownerId: null,
    schema: { type: "string" },
    defaultValue: "paper",
    scopes: 1 | 2 | 4,
    secret: false,
    status: "active",
    aliasOfNamespace: null,
    aliasOfKey: null,
    coercionTag: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function value(overrides: Partial<SettingValueRecord>): SettingValueRecord {
  return {
    settingId: "setting-1",
    scope: "global",
    workspaceId: null,
    principalId: null,
    valueJson: "x",
    state: "set",
    defVersion: 1,
    seq: 1,
    updatedBy: "actor-1",
    updatedAt: NOW,
    originPluginId: null,
    ...overrides,
  };
}

test("getEffective returns the global value when only a global value exists (AC-04)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({
    definitions: [def],
    globalValues: [value({ scope: "global", valueJson: "atlas" })],
  });

  const result = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-1" } }
  );

  assert.equal(result?.value, "atlas");
  assert.equal(result?.sourceLayer, "global");
});

test("getEffective returns the definition's validated default when no layer has a value (AC-05/INV-02)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });

  const result = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-1" } }
  );

  assert.equal(result?.value, "paper");
  assert.equal(result?.sourceLayer, "default");
});

test("getEffective prefers workspace over global, and user over workspace (layer precedence)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({
    definitions: [def],
    globalValues: [value({ scope: "global", valueJson: "global-val" })],
    workspaceValues: [value({ scope: "workspace", workspaceId: "ws-1", valueJson: "ws-val" })],
  });

  const workspaceOnly = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(workspaceOnly?.value, "ws-val");
  assert.equal(workspaceOnly?.sourceLayer, "workspace");

  const withUserValue = new InMemorySettingsRepo({
    definitions: [def],
    globalValues: [value({ scope: "global", valueJson: "global-val" })],
    workspaceValues: [value({ scope: "workspace", workspaceId: "ws-1", valueJson: "ws-val" })],
    userValues: [
      value({ scope: "user", workspaceId: "ws-1", principalId: "p-1", valueJson: "user-val" }),
    ],
  });
  const userResult = await getEffective(
    { repo: withUserValue },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1", principalId: "p-1" } }
  );
  assert.equal(userResult?.value, "user-val");
  assert.equal(userResult?.sourceLayer, "user");
});

test("getEffective treats a cleared row as absent, falling through to the next layer (behavior.spec §1.2)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({
    definitions: [def],
    globalValues: [value({ scope: "global", valueJson: "global-val" })],
    workspaceValues: [
      value({ scope: "workspace", workspaceId: "ws-1", valueJson: null, state: "cleared" }),
    ],
  });

  const result = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: { workspaceId: "ws-1" } }
  );
  assert.equal(result?.value, "global-val");
  assert.equal(result?.sourceLayer, "global");
});

test("getEffective resolves a renamed setting transparently by its old key (AC-06)", async () => {
  const activeDef = definition({ namespace: "core.presentation", key: "newKey" });
  const aliasDef: SettingDefinitionRecord = {
    ...definition({ namespace: "core.presentation", key: "oldKey" }),
    settingId: "setting-1-alias",
    version: 1,
    status: "alias",
    aliasOfNamespace: "core.presentation",
    aliasOfKey: "newKey",
  };
  const repo = new InMemorySettingsRepo({
    definitions: [activeDef, aliasDef],
    globalValues: [value({ scope: "global", settingId: activeDef.settingId, valueJson: "resolved-val" })],
  });

  const byOldKey = await getEffective(
    { repo },
    { namespace: "core.presentation", key: "oldKey", scopeContext: {} }
  );
  const byNewKey = await getEffective(
    { repo },
    { namespace: "core.presentation", key: "newKey", scopeContext: {} }
  );

  assert.equal(byOldKey?.value, "resolved-val");
  assert.deepEqual(byOldKey, byNewKey);
});

test("getEffective returns null for a tombstoned key (EC-10)", async () => {
  const def = definition({ status: "tombstone" });
  const repo = new InMemorySettingsRepo({ definitions: [def] });

  const result = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: {} }
  );
  assert.equal(result, null);
});

test("getEffective coerces a value stored under a stale def_version in memory, no write-back (AC-21/EC-08)", async () => {
  registerCoercer("upcase", (v) => (typeof v === "string" ? v.toUpperCase() : v));
  const def = definition({ version: 2, coercionTag: "upcase" });
  const staleValue = value({ scope: "global", valueJson: "lowercase", defVersion: 1 });
  const repo = new InMemorySettingsRepo({ definitions: [def], globalValues: [staleValue] });

  const result = await getEffective(
    { repo },
    { namespace: def.namespace, key: def.key, scopeContext: {} }
  );

  assert.equal(result?.value, "LOWERCASE");
  const stillStale = await repo.getGlobalValue(def.settingId);
  assert.equal(stillStale?.defVersion, 1, "no write-back — the stored row keeps its original defVersion");
});
