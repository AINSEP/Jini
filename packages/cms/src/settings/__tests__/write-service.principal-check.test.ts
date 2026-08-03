import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import { PrincipalNotFoundError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { set } from "../write-service.js";
import type { SettingDefinitionRecord } from "../types.js";

const clock = { nowIso: () => "2026-07-11T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
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
    scopes: 4, // user scope only
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

test("set at scope=user targeting a principalId not in the request's workspace is rejected PRINCIPAL_NOT_FOUND, no rows written (AC-24/INV-09)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([
    // "target-1" belongs to a DIFFERENT workspace than the request's ws-1.
    { id: "target-1", workspaceId: "ws-OTHER", kind: "user", displayName: "T", status: "active", createdAt: NOW },
  ]);

  await assert.rejects(
    () =>
      set({
        deps: { repo, clock, ids, authorize: alwaysAllow, principals },
        input: {
          namespace: def.namespace,
          key: def.key,
          scope: "user",
          value: "atlas",
          workspaceId: "ws-1",
          principalId: "target-1",
          callerPrincipalId: "actor-1",
        },
      }),
    PrincipalNotFoundError
  );
  assert.equal(
    await repo.getUserValue({ workspaceId: "ws-1", principalId: "target-1", settingId: def.settingId }),
    null
  );
  assert.equal((await repo.listRevisions({ settingId: def.settingId })).length, 0);
});

test("set at scope=user targeting a principalId that doesn't exist at all is rejected PRINCIPAL_NOT_FOUND (EC-11)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]);

  await assert.rejects(
    () =>
      set({
        deps: { repo, clock, ids, authorize: alwaysAllow, principals },
        input: {
          namespace: def.namespace,
          key: def.key,
          scope: "user",
          value: "atlas",
          workspaceId: "ws-1",
          principalId: "ghost",
          callerPrincipalId: "actor-1",
        },
      }),
    PrincipalNotFoundError
  );
});

test("set at scope=user targeting a real principal in the same workspace succeeds (AC-22)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([
    { id: "target-1", workspaceId: "ws-1", kind: "user", displayName: "T", status: "active", createdAt: NOW },
  ]);

  const result = await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: {
      namespace: def.namespace,
      key: def.key,
      scope: "user",
      value: "atlas",
      workspaceId: "ws-1",
      principalId: "target-1",
      callerPrincipalId: "actor-1",
    },
  });

  assert.equal(result.value, "atlas");
  const stored = await repo.getUserValue({
    workspaceId: "ws-1",
    principalId: "target-1",
    settingId: def.settingId,
  });
  assert.equal(stored?.valueJson, "atlas");
});

test("set at scope=user targeting the caller's own principalId does not require the principal-membership check to find a different record (self-write)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]); // caller not registered as a principal anywhere — self-write must not consult PrincipalRepoPort

  const result = await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: {
      namespace: def.namespace,
      key: def.key,
      scope: "user",
      value: "atlas",
      workspaceId: "ws-1",
      callerPrincipalId: "actor-1",
    },
  });

  assert.equal(result.value, "atlas");
});
