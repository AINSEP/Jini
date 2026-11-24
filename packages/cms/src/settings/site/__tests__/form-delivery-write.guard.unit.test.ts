/**
 * @file `guardedBindingsRepo` — the compare-and-save guard `writeFormDeliveryBindings` wraps the
 * settings repo in when the caller names the snapshot it merged from. Only `saveWorkspaceValue` is
 * guarded; every other member is the wrapped repo's own (methods keep their receiver).
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import type { FormDeliveryBinding } from "@jini-ai/core/contracts/site/cms-forms";
import { InMemorySettingsRepo, type SettingValueRecord } from "@jini-ai/core/settings";

import { FormDeliveryBindingsConflictError, guardedBindingsRepo } from "../form-delivery-write.js";

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
