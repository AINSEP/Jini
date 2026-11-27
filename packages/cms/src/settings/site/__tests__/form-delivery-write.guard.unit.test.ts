/**
 * @file `guardedBindingsRepo` — the compare-and-save guard `writeFormDeliveryBindings` wraps the
 * settings repo in when the caller names the snapshot it merged from. Only `saveWorkspaceValue` is
 * guarded; every other member is the wrapped repo's own (methods keep their receiver).
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import type { FormDeliveryBinding } from "@jini-ai/core/contracts/site/cms-forms";
import { getEffective, InMemorySettingsRepo, type SettingDefinitionRecord, type SettingValueRecord } from "@jini-ai/core/settings";

import { FormDeliveryBindingsConflictError, guardedBindingsRepo, writeFormDeliveryBindings } from "../form-delivery-write.js";

import { readFormDeliveryBindings } from "../form-delivery.js";

const record: SettingValueRecord = {
  settingId: "setting-1", scope: "workspace", workspaceId: "ws-1", principalId: null, valueJson: [],
  state: "set", defVersion: 1, seq: 1, updatedBy: "owner", updatedAt: "2026-10-21T00:00:00.000Z", originPluginId: null,
};
const staleSnapshot: readonly FormDeliveryBinding[] = [
  { bindingId: "b1", adapterId: "rows", connectionRef: "conn-1", enabled: true, config: {} } as FormDeliveryBinding,
];

test("a save whose expected snapshot still matches the stored bindings goes through", async () => {
  const repo = new InMemorySettingsRepo();
  const guarded = guardedBindingsRepo({ repo, workspaceId: "ws-1", expectedValue: [] });
  await guarded.saveWorkspaceValue(record);
  assert.deepEqual((await repo.listWorkspaceValues({ workspaceId: "ws-1" })).map((value) => value.settingId), ["setting-1"]);
});

test("a save from a stale snapshot is refused with the conflict error and nothing is stored", async () => {
  const repo = new InMemorySettingsRepo();
  const guarded = guardedBindingsRepo({ repo, workspaceId: "ws-1", expectedValue: staleSnapshot });
  await assert.rejects(() => guarded.saveWorkspaceValue(record), FormDeliveryBindingsConflictError);
  assert.deepEqual(await repo.listWorkspaceValues({ workspaceId: "ws-1" }), []);
});

test("every other member passes through: methods bound to the real repo, data members as-is", async () => {
  const repo = Object.assign(new InMemorySettingsRepo(), { label: "primary" });
  const guarded = guardedBindingsRepo({ repo, workspaceId: "ws-1", expectedValue: [] }) as typeof repo;
  const { listWorkspaceValues } = guarded;
  await repo.saveWorkspaceValue(record);
  assert.equal((await listWorkspaceValues({ workspaceId: "ws-1" })).length, 1, "a detached method still reads the real repo");
  assert.equal(guarded.label, "primary");
});

test("the typed bindings writer refuses stale snapshots and allows a reread and retry without a phantom revision", async () => {
  const workspaceId = "ws-1";
  const settingId = "forms-binding-setting";
  const definition: SettingDefinitionRecord = {
    settingId, version: 1, workspaceId: null, namespace: "core.forms", key: "deliveryBindings",
    ownerKind: "core", ownerId: null, schema: { type: "json" }, defaultValue: [], scopes: 2, secret: false,
    status: "active", aliasOfNamespace: null, aliasOfKey: null, coercionTag: null,
    createdAt: record.updatedAt, updatedAt: record.updatedAt,
  };
  const repo = new InMemorySettingsRepo({ definitions: [definition] });
  const read = () => readFormDeliveryBindings({ settingsRepo: repo, getEffective, workspaceId });
  let id = 0;
  const write = (value: unknown, expectedValue: readonly FormDeliveryBinding[]) => writeFormDeliveryBindings({
    deps: {
      repo, clock: { nowMs: () => Date.parse(record.updatedAt) }, ids: { newId: () => `binding-${++id}` },
      authorize: async () => ({ allowed: true, reason: "test" }), principals: { findActiveById: async () => null },
    },
    workspaceId, value, callerPrincipalId: "owner", writePolicies: { dedicatedWriters: [] },
  }, { expectedValue });
  const first = [{ bindingId: "orders", adapterId: "rows", connectionRef: "conn-1", enabled: true, config: {} }];
  const next = [{ ...first[0]!, enabled: false }];
  const initial = await read();

  await write(first, initial);
  await assert.rejects(write(next, initial), FormDeliveryBindingsConflictError);
  assert.deepEqual(await read(), first);
  assert.deepEqual((await repo.listRevisions({ settingId })).map(({ afterJson }) => afterJson), [first]);

  await write(next, await read());
  assert.deepEqual(await read(), next);
  assert.deepEqual((await repo.listRevisions({ settingId })).map(({ afterJson }) => afterJson), [first, next]);
});
