import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ensureSettingDefinitions,
  getEffective,
  InMemorySettingsRepo,
  resolveDefinitionRaw,
  SCOPE_BIT,
  set,
  type AuthorizeFn,
  type EnsureSettingDefinitionsDeps,
} from "@jini-ai/core/settings";

import { ensureMediaObjectStoreSetting, MEDIA_OBJECT_STORE_KEY, readMediaObjectStoreSetting, STORAGE_SETTINGS_NAMESPACE } from "../setting.js";

/**
 * @file `core.storage.mediaObjectStore` over the real in-memory settings ledger: registration with
 * an empty workspace-scoped default, owner values surviving a re-ensure, and the reader's
 * normalization (trimmed; blank, unregistered or non-string → "").
 */

const SYSTEM_PRINCIPAL_ID = "system-settings-migration";
const OWNER_PRINCIPAL_ID = "owner-principal";
const WORKSPACE_ID = "ws-storage";

const clock = { nowIso: () => "2026-10-21T00:00:00.000Z", nowMs: () => Date.parse("2026-10-21T00:00:00.000Z") };
let idCounter = 0;
const ids = { newId: () => `object-storage-setting-id-${++idCounter}` };
const allowAll: AuthorizeFn = async () => ({ allowed: true, reason: "test" });
// Principal lookups only run for user-scoped writes about another principal; none happen here.
const principals = { findActiveById: async () => null };

function ledger(): EnsureSettingDefinitionsDeps & { settingsRepo: InMemorySettingsRepo } {
  return { settingsRepo: new InMemorySettingsRepo(), clock, ids, principals };
}

async function ownerSet(deps: ReturnType<typeof ledger>, value: string): Promise<void> {
  await set({
    deps: { repo: deps.settingsRepo, clock, ids, authorize: allowAll, principals },
    input: { namespace: STORAGE_SETTINGS_NAMESPACE, key: MEDIA_OBJECT_STORE_KEY, scope: "workspace", workspaceId: WORKSPACE_ID, value, callerPrincipalId: OWNER_PRINCIPAL_ID },
  });
}

const read = (deps: ReturnType<typeof ledger>) => readMediaObjectStoreSetting({ settingsRepo: deps.settingsRepo, workspaceId: WORKSPACE_ID });

test("ensureMediaObjectStoreSetting: registers core.storage/mediaObjectStore as a workspace-scoped string defaulting to ''", async () => {
  const deps = ledger();
  await ensureMediaObjectStoreSetting({ deps, systemPrincipalId: SYSTEM_PRINCIPAL_ID });

  const definition = await resolveDefinitionRaw({ repo: deps.settingsRepo }, { namespace: "core.storage", key: "mediaObjectStore", workspaceId: null });
  assert.ok(definition, "the definition must be registered");
  assert.deepEqual(definition.schema, { type: "string" });
  assert.equal(definition.defaultValue, "");
  assert.equal(definition.scopes, SCOPE_BIT.workspace);

  const effective = await getEffective({ deps: { repo: deps.settingsRepo }, namespace: "core.storage", key: "mediaObjectStore", scopeContext: { workspaceId: WORKSPACE_ID } });
  assert.equal(effective?.value, "");
  assert.equal(await read(deps), "");
});

test("readMediaObjectStoreSetting: returns the owner's saved provider id, trimmed", async () => {
  const deps = ledger();
  await ensureMediaObjectStoreSetting({ deps, systemPrincipalId: SYSTEM_PRINCIPAL_ID });
  await ownerSet(deps, "  s3_compatible \n");
  assert.equal(await read(deps), "s3_compatible");
});

test("ensureMediaObjectStoreSetting: running again on the next boot keeps the owner's value", async () => {
  const deps = ledger();
  await ensureMediaObjectStoreSetting({ deps, systemPrincipalId: SYSTEM_PRINCIPAL_ID });
  await ownerSet(deps, "s3_compatible");
  await ensureMediaObjectStoreSetting({ deps, systemPrincipalId: SYSTEM_PRINCIPAL_ID });
  assert.equal(await read(deps), "s3_compatible");
});

test("readMediaObjectStoreSetting: a blank saved value reads as ''", async () => {
  const deps = ledger();
  await ensureMediaObjectStoreSetting({ deps, systemPrincipalId: SYSTEM_PRINCIPAL_ID });
  await ownerSet(deps, "   ");
  assert.equal(await read(deps), "");
});

test("readMediaObjectStoreSetting: an unregistered setting reads as ''", async () => {
  assert.equal(await read(ledger()), "");
});

test("readMediaObjectStoreSetting: a non-string effective value (a definition registered under another schema) reads as ''", async () => {
  const deps = ledger();
  await ensureSettingDefinitions(deps, { namespace: STORAGE_SETTINGS_NAMESPACE, systemPrincipalId: SYSTEM_PRINCIPAL_ID, definitions: [
    { key: MEDIA_OBJECT_STORE_KEY, schema: { type: "number" }, defaultValue: 42, scopes: SCOPE_BIT.workspace },
  ] });
  const effective = await getEffective({ deps: { repo: deps.settingsRepo }, namespace: STORAGE_SETTINGS_NAMESPACE, key: MEDIA_OBJECT_STORE_KEY, scopeContext: { workspaceId: WORKSPACE_ID } });
  assert.equal(effective?.value, 42, "precondition: the ledger really holds a non-string value");
  assert.equal(await read(deps), "");
});
