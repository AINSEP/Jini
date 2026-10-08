import assert from "node:assert/strict";
import { test } from "vitest";

import { quarantinePlugin } from "../../quarantine.js";
import { InMemoryPluginActivationRepo } from "../support/repo.memory.js";
import type { PluginActivationRecord } from "../../activation.js";

const WORKSPACE_ID = "workspace-1";
const PLUGIN_ID = "acme-plugin";

test("quarantinePlugin: throws error when no activation record exists", async () => {
  const repo = new InMemoryPluginActivationRepo();
  const clock = { nowMs: () => Date.parse("2026-08-01T12:00:00.000Z") };

  await assert.rejects(
    async () => {
      await quarantinePlugin({
        deps: { repo, clock },
        input: {
          workspaceId: WORKSPACE_ID,
          pluginId: PLUGIN_ID,
          consecutiveFailures: 3,
          reason: "repeated timeout during hook execution",
        },
      });
    },
    {
      name: "Error",
      message: `cannot quarantine plugin '${PLUGIN_ID}' without an activation record`,
    }
  );
});

test("quarantinePlugin: disables plugin and persists quarantine fields", async () => {
  const initialActivation: PluginActivationRecord = {
    pluginId: PLUGIN_ID,
    workspaceId: WORKSPACE_ID,
    version: "1.0.0",
    enabled: true,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const repo = new InMemoryPluginActivationRepo([initialActivation]);
  const nowIso = "2026-08-01T12:00:00.000Z";
  const clock = { nowMs: () => Date.parse(nowIso) };

  const { activation } = await quarantinePlugin({
    deps: { repo, clock },
    input: {
      workspaceId: WORKSPACE_ID,
      pluginId: PLUGIN_ID,
      consecutiveFailures: 5,
      reason: "syntax error on evaluate",
    },
  });

  assert.equal(activation.pluginId, PLUGIN_ID);
  assert.equal(activation.workspaceId, WORKSPACE_ID);
  assert.equal(activation.enabled, false);
  assert.equal(activation.quarantinedAt, nowIso);
  assert.equal(activation.updatedAt, nowIso);
  assert.equal(activation.quarantineReason, "syntax error on evaluate");
  assert.equal(activation.quarantineFailureCount, 5);

  const saved = await repo.getActivation({ workspaceId: WORKSPACE_ID, pluginId: PLUGIN_ID });
  assert.deepEqual(saved, activation);
});
