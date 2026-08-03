import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import {
  DefinitionTombstonedError,
  ForbiddenError,
  ScopeNotAllowedError,
  ValueValidationFailedError,
} from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { clear, set } from "../write-service.js";
import type { SettingDefinitionRecord } from "../types.js";

const clock = { nowIso: () => "2026-07-11T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no_grant" });
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

test("set writes exactly one workspace value row and one op='set' revision, same call (AC-07)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]);

  const result = await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: {
      namespace: def.namespace,
      key: def.key,
      scope: "workspace",
      value: "atlas",
      workspaceId: "ws-1",
      callerPrincipalId: "actor-1",
    },
  });

  assert.equal(result.value, "atlas");
  const stored = await repo.getWorkspaceValue({ workspaceId: "ws-1", settingId: def.settingId });
  assert.equal(stored?.valueJson, "atlas");
  const revisions = await repo.listRevisions({ settingId: def.settingId });
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]!.op, "set");
  assert.equal(revisions[0]!.seq, result.revisionSeq);
});

test("set is rejected FORBIDDEN and writes nothing when the caller is unauthorized (AC-08)", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]);

  await assert.rejects(
    () =>
      set({
        deps: { repo, clock, ids, authorize: alwaysDeny, principals },
        input: {
          namespace: def.namespace,
          key: def.key,
          scope: "workspace",
          value: "atlas",
          workspaceId: "ws-1",
          callerPrincipalId: "actor-1",
        },
      }),
    ForbiddenError
  );
  assert.equal(await repo.getWorkspaceValue({ workspaceId: "ws-1", settingId: def.settingId }), null);
  assert.equal((await repo.listRevisions({ settingId: def.settingId })).length, 0);
});

test("set rejects a scope not declared in the definition's scopes bitmask (EC-02)", async () => {
  const def = definition({ scopes: 1 }); // global only
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]);

  await assert.rejects(
    () =>
      set({
        deps: { repo, clock, ids, authorize: alwaysAllow, principals },
        input: {
          namespace: def.namespace,
          key: def.key,
          scope: "workspace",
          value: "atlas",
          workspaceId: "ws-1",
          callerPrincipalId: "actor-1",
        },
      }),
    ScopeNotAllowedError
  );
  assert.equal((await repo.listRevisions({ settingId: def.settingId })).length, 0);
});

test("set rejects a value that fails the definition schema", async () => {
  const def = definition({ schema: { type: "enum", values: ["paper", "atlas"] } });
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]);

  await assert.rejects(
    () =>
      set({
        deps: { repo, clock, ids, authorize: alwaysAllow, principals },
        input: {
          namespace: def.namespace,
          key: def.key,
          scope: "global",
          value: "not-a-real-theme",
          callerPrincipalId: "actor-1",
        },
      }),
    ValueValidationFailedError
  );
});

test("set rejects a write to a tombstoned definition", async () => {
  const def = definition({ status: "tombstone" });
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]);

  await assert.rejects(
    () =>
      set({
        deps: { repo, clock, ids, authorize: alwaysAllow, principals },
        input: {
          namespace: def.namespace,
          key: def.key,
          scope: "global",
          value: "x",
          callerPrincipalId: "actor-1",
        },
      }),
    DefinitionTombstonedError
  );
});

test("clear is rejected FORBIDDEN and writes nothing when the caller is unauthorized and skipAuthorize is not set", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]);

  await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: { namespace: def.namespace, key: def.key, scope: "global", value: "atlas", callerPrincipalId: "actor-1" },
  });

  await assert.rejects(
    () =>
      clear({
        deps: { repo, clock, ids, authorize: alwaysDeny, principals },
        input: { namespace: def.namespace, key: def.key, scope: "global", callerPrincipalId: "actor-1" },
      }),
    ForbiddenError
  );

  const stored = await repo.getGlobalValue(def.settingId);
  assert.equal(stored?.state, "set", "a denied clear() must not flip state to 'cleared'");
  assert.equal(stored?.valueJson, "atlas");
  assert.equal(
    (await repo.listRevisions({ settingId: def.settingId })).length,
    1,
    "only the original 'set' revision should exist -- a denied clear() must append none"
  );
});

test("clear writes state='cleared' and a same-call op='clear' revision", async () => {
  const def = definition();
  const repo = new InMemorySettingsRepo({ definitions: [def] });
  const principals = new InMemoryPrincipalRepo([]);

  await set({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: {
      namespace: def.namespace,
      key: def.key,
      scope: "global",
      value: "atlas",
      callerPrincipalId: "actor-1",
    },
  });

  await clear({
    deps: { repo, clock, ids, authorize: alwaysAllow, principals },
    input: { namespace: def.namespace, key: def.key, scope: "global", callerPrincipalId: "actor-1" },
  });

  const stored = await repo.getGlobalValue(def.settingId);
  assert.equal(stored?.state, "cleared");
  assert.equal(stored?.valueJson, null);
  const revisions = await repo.listRevisions({ settingId: def.settingId });
  assert.equal(revisions.length, 2);
  assert.equal(revisions[1]!.op, "clear");
});
