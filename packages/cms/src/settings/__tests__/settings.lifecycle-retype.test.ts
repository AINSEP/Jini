import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPrincipalRepo } from "../../identity/index.js";
import { DefinitionInvalidError, RenameRetypeConflictError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { registerDefinitions, retypeDefinition } from "../write-service.js";
import type { SettingDefinitionRecord } from "../types.js";

const clock = { nowIso: () => "2026-07-12T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const NOW = "2026-07-12T00:00:00.000Z";

function deps(seed: { definitions?: SettingDefinitionRecord[] } = {}) {
  const repo = new InMemorySettingsRepo(seed);
  const principals = new InMemoryPrincipalRepo([]);
  return { repo, clock, ids, authorize: alwaysAllow, principals };
}

async function register(d: ReturnType<typeof deps>, namespace: string, key: string) {
  const { registered } = await registerDefinitions({
    deps: d,
    input: {
      definitions: [
        {
          namespace,
          key,
          ownerKind: "core" as const,
          workspaceId: null,
          schema: { type: "string" as const },
          defaultValue: "default",
          scopes: 2,
          secret: false,
        },
      ],
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });
  return registered[0]!;
}

test("retypeDefinition rejects a rename+retype combined in one op (AC-10/EC-05)", async () => {
  const d = deps();
  await register(d, "core.ns", "a");

  await assert.rejects(
    () =>
      retypeDefinition({
        deps: d,
        input: {
          namespace: "core.ns",
          key: "a",
          workspaceId: null,
          newNamespace: "core.ns",
          newKey: "b",
          schema: { type: "number" },
          defaultValue: 1,
          coercionTag: "identity",
          callerPrincipalId: "actor-1",
          authWorkspaceId: "ws-1",
        },
      }),
    RenameRetypeConflictError
  );

  // Nothing should have been written: still one active row, still version 1, still at 'a'.
  const def = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "a", workspaceId: null });
  assert.equal(def?.status, "active");
  assert.equal(def?.version, 1);
  const atB = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "b", workspaceId: null });
  assert.equal(atB, null);
});

test("retypeDefinition succeeds when only the schema changes (namespace/key untouched)", async () => {
  const d = deps();
  const settingId = await register(d, "core.ns", "a");

  const result = await retypeDefinition({
    deps: d,
    input: {
      namespace: "core.ns",
      key: "a",
      workspaceId: null,
      schema: { type: "number" },
      defaultValue: 42,
      coercionTag: "identity",
      callerPrincipalId: "actor-1",
      authWorkspaceId: "ws-1",
    },
  });

  assert.equal(result.settingId, settingId);
  assert.equal(result.version, 2);

  const active = await d.repo.findActiveDefinition({ namespace: "core.ns", key: "a", workspaceId: null });
  assert.equal(active?.status, "active");
  assert.equal(active?.version, 2);
  assert.deepEqual(active?.schema, { type: "number" });

  const priorVersion = await d.repo.findDefinitionBySettingId({ settingId, version: 1 });
  assert.equal(priorVersion?.status, "deprecated");

  const revisions = await d.repo.listRevisions({ settingId });
  assert.equal(revisions[revisions.length - 1]!.op, "retype");
  assert.equal(revisions[revisions.length - 1]!.defVersion, 2);
});

test("retypeDefinition rejects when a prior version lacks a total coercer", async () => {
  const settingId = "setting-a";
  const v1: SettingDefinitionRecord = {
    settingId,
    version: 1,
    workspaceId: null,
    namespace: "core.ns",
    key: "a",
    ownerKind: "core",
    ownerId: null,
    schema: { type: "string" },
    defaultValue: "default",
    scopes: 2,
    secret: false,
    status: "deprecated",
    aliasOfNamespace: null,
    aliasOfKey: null,
    coercionTag: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  // Simulates a version-2 row that slipped in without a coercer (data drift /
  // bypass) -- a subsequent retype to version 3 must catch this gap.
  const v2: SettingDefinitionRecord = {
    ...v1,
    version: 2,
    status: "active",
    schema: { type: "number" },
    defaultValue: 0,
    coercionTag: null,
  };
  const d = deps({ definitions: [v1, v2] });

  await assert.rejects(
    () =>
      retypeDefinition({
        deps: d,
        input: {
          namespace: "core.ns",
          key: "a",
          workspaceId: null,
          schema: { type: "boolean" },
          defaultValue: false,
          coercionTag: "identity",
          callerPrincipalId: "actor-1",
          authWorkspaceId: "ws-1",
        },
      }),
    DefinitionInvalidError
  );

  // No version 3 should have been written.
  const v3 = await d.repo.findDefinitionBySettingId({ settingId, version: 3 });
  assert.equal(v3, null);
  const stillActive = await d.repo.findDefinitionBySettingId({ settingId, version: 2 });
  assert.equal(stillActive?.status, "active");
});
