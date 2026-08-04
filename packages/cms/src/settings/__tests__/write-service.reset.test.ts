import assert from "node:assert/strict";
import { test } from "vitest";

import { ForbiddenError } from "../errors.js";
import { InMemorySettingsRepo } from "../repo.memory.js";
import { resetNamespace, set } from "../write-service.js";
import { InMemoryPrincipalRepo } from "../../identity/index.js";
import type { SettingDefinitionRecord } from "../types.js";

const clock = { nowIso: () => "2026-07-11T00:00:00.000Z" };
let idCounter = 0;
const ids = { newId: () => `id-${++idCounter}` };
const alwaysAllow = async () => ({ allowed: true, reason: "matched" });
const alwaysDeny = async () => ({ allowed: false, reason: "no_grant" });
const NOW = "2026-07-11T00:00:00.000Z";

function definition(key: string): SettingDefinitionRecord {
  return {
    settingId: `setting-${key}`,
    version: 1,
    workspaceId: null,
    namespace: "core.ns",
    key,
    ownerKind: "core",
    ownerId: null,
    schema: { type: "string" },
    defaultValue: "default",
    scopes: 2,
    secret: false,
    status: "active",
    aliasOfNamespace: null,
    aliasOfKey: null,
    coercionTag: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("resetNamespace clears every key in the namespace, each with its own op='clear' revision (EC-09)", async () => {
  const defA = definition("a");
  const defB = definition("b");
  const repo = new InMemorySettingsRepo({ definitions: [defA, defB] });
  const principals = new InMemoryPrincipalRepo([]);
  const deps = { repo, clock, ids, authorize: alwaysAllow, principals };

  await set({
    deps,
    input: { namespace: "core.ns", key: "a", scope: "workspace", value: "x", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });
  await set({
    deps,
    input: { namespace: "core.ns", key: "b", scope: "workspace", value: "y", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
  });

  const result = await resetNamespace(
    { deps, input: { namespace: "core.ns", scope: "workspace", workspaceId: "ws-1", callerPrincipalId: "actor-1" } },
    ["a", "b"]
  );

  assert.equal(result.clearedCount, 2);
  assert.equal((await repo.getWorkspaceValue({ workspaceId: "ws-1", settingId: defA.settingId }))?.state, "cleared");
  assert.equal((await repo.getWorkspaceValue({ workspaceId: "ws-1", settingId: defB.settingId }))?.state, "cleared");
  const revsA = await repo.listRevisions({ settingId: defA.settingId });
  const revsB = await repo.listRevisions({ settingId: defB.settingId });
  assert.equal(revsA[revsA.length - 1]!.op, "clear");
  assert.equal(revsB[revsB.length - 1]!.op, "clear");
});

test("resetNamespace succeeds for a caller holding only settings.reset.workspace, without also holding settings.workspace.write", async () => {
  const defA = definition("a");
  const repo = new InMemorySettingsRepo({ definitions: [defA] });
  const principals = new InMemoryPrincipalRepo([]);

  let requestedPermission: string | null = null;
  const trackingAuthorize = async (params: { permission: string }) => {
    requestedPermission = params.permission;
    return { allowed: true, reason: "matched" };
  };

  const result = await resetNamespace(
    {
      deps: { repo, clock, ids, authorize: trackingAuthorize, principals },
      input: { namespace: "core.ns", scope: "workspace", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
    },
    ["a"]
  );

  // Only the outer settings.reset.workspace check ran — clear()'s inner
  // authorize() was skipped (reset-authorized internal context), so the
  // tracking authorize function was never asked for settings.workspace.write.
  assert.equal(requestedPermission, "settings.reset.workspace");
  assert.equal(result.clearedCount, 1);
});

test("resetNamespace is rejected FORBIDDEN and clears nothing when the caller lacks settings.reset.*", async () => {
  const defA = definition("a");
  const repo = new InMemorySettingsRepo({ definitions: [defA] });
  const principals = new InMemoryPrincipalRepo([]);

  await assert.rejects(
    () =>
      resetNamespace(
        {
          deps: { repo, clock, ids, authorize: alwaysDeny, principals },
          input: { namespace: "core.ns", scope: "workspace", workspaceId: "ws-1", callerPrincipalId: "actor-1" },
        },
        ["a"]
      ),
    ForbiddenError
  );
  assert.equal((await repo.listRevisions({ settingId: defA.settingId })).length, 0);
});
