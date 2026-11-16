import assert from "node:assert/strict";
import { test } from "vitest";

import { SettingsRevisionConflictError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { set, type SettingsWriteServiceDeps } from "../write-service.js";
import type { SettingDefinitionRecord } from "../types.js";

function fixture() {
  const now = "2026-11-15T00:00:00.000Z";
  const definition: SettingDefinitionRecord = {
    settingId: "setting", version: 1, workspaceId: null, namespace: "core.skip", key: "choice",
    ownerKind: "core", ownerId: null, schema: { type: "string" }, defaultValue: "default",
    scopes: 7, secret: false, status: "active", aliasOfNamespace: null, aliasOfKey: null,
    coercionTag: null, createdAt: now, updatedAt: now,
  };
  const repo = new InMemorySettingsRepo({ definitions: [definition] });
  let id = 0;
  const deps: SettingsWriteServiceDeps = {
    repo, clock: { nowMs: () => Date.parse(now) }, ids: { newId: () => `id-${++id}` },
    authorize: async () => ({ allowed: true, reason: "test" }),
    principals: { findActiveById: async ({ id }) => ({ id }) },
  };
  const input = { namespace: definition.namespace, key: definition.key, scope: "global" as const,
    callerPrincipalId: "actor", value: "first", skipTransaction: true };
  return { repo, deps, input };
}

test("set with skipTransaction joins the caller's transaction, so a later stale write rolls the first back", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.repo.transaction(async () => {
      await set(f, { expectedRevisionSeq: 0 });
      await set({ deps: f.deps, input: { ...f.input, value: "second" } }, { expectedRevisionSeq: 0 });
    }),
    SettingsRevisionConflictError,
  );
  assert.equal(await f.repo.getGlobalValue("setting"), null);
});
