import assert from "node:assert/strict";
import { test } from "vitest";

import type { AgentPluginActivationRecord, AgentPluginActivationVerdict, SetAgentPluginActivationOptional, SetAgentPluginActivationRequired } from "../../lifecycle/index.js";
import { carryPluginRenameActivation, type DeploySplitActivationPort } from "../deploy-split-activation.js";

/**
 * @file `carryPluginRenameActivation`: an operator who explicitly turned the successor OFF after having
 * turned the predecessor ON must keep the successor off. The double stores both records, answers both
 * strict verdicts, and tags every write it receives so a rename-carry write is told apart from any
 * other activation write (for example a separate legacy split-seeding step) that might touch the same id.
 */

const WORKSPACE = "/ws";
const FROM = "plugin-old";
const TO = "plugin-new";

interface TaggedWrite { readonly source: "rename-carry" | "other"; readonly pluginId: string; readonly enabled: boolean }

/** Builds a stored-state activation double; `origin: "bundled"` from this step marks a rename-carry write. */
function activationDouble({ records, verdicts }: { records: Record<string, AgentPluginActivationRecord>; verdicts: Record<string, AgentPluginActivationVerdict> }) {
  const stored: Record<string, AgentPluginActivationRecord> = { ...records };
  const writes: TaggedWrite[] = [];
  const port: DeploySplitActivationPort = {
    assertAgentPluginActivationsWritable: async () => undefined,
    resolveAgentPluginActivation: async ({ pluginId }) => verdicts[pluginId] ?? { verdict: "inactive" },
    readAgentPluginActivations: async () => ({ schemaVersion: 1, plugins: { ...stored } }),
    setAgentPluginActivation: async (required: SetAgentPluginActivationRequired, optional?: SetAgentPluginActivationOptional) => {
      const source = optional?.origin === "bundled" && required.actor === "system:rename" ? "rename-carry" : "other";
      writes.push({ source, pluginId: required.pluginId, enabled: required.enabled });
      stored[required.pluginId] = { enabled: required.enabled, origin: "bundled", updatedAt: "2026-11-25T00:00:03Z", updatedBy: required.actor };
      return undefined;
    },
  };
  return { port, stored, writes };
}

const earlierOperatorOn: AgentPluginActivationRecord = { enabled: true, origin: "bundled", updatedAt: "2026-11-25T00:00:01Z", updatedBy: "operator:alice" };
const laterOperatorOff: AgentPluginActivationRecord = { enabled: false, origin: "bundled", updatedAt: "2026-11-25T00:00:02Z", updatedBy: "operator:alice" };

test("a later explicit off on the successor wins over an earlier on during rename carry", async () => {
  const double = activationDouble({
    records: { [FROM]: earlierOperatorOn, [TO]: laterOperatorOff },
    verdicts: { [FROM]: { verdict: "active" }, [TO]: { verdict: "inactive" } },
  });
  await carryPluginRenameActivation({ workspaceRoot: WORKSPACE, activations: double.port, fromPluginId: FROM, toPluginId: TO, actor: "system:rename" });
  assert.deepEqual(double.writes.filter((write) => write.source === "rename-carry"), [], "rename carry must not overwrite an explicit successor decision");
  assert.deepEqual(double.writes, [], "no other activation write may happen inside the carry step either");
  assert.deepEqual(double.stored[TO], laterOperatorOff);
});

test("the same carry does write when the successor holds only a seed record, so the write counter is live", async () => {
  const double = activationDouble({
    records: { [FROM]: earlierOperatorOn, [TO]: { ...laterOperatorOff, updatedBy: "system:seed" } },
    verdicts: { [FROM]: { verdict: "active" }, [TO]: { verdict: "inactive" } },
  });
  await carryPluginRenameActivation({ workspaceRoot: WORKSPACE, activations: double.port, fromPluginId: FROM, toPluginId: TO, actor: "system:rename" });
  assert.deepEqual(double.writes, [{ source: "rename-carry", pluginId: TO, enabled: true }]);
  assert.equal(double.stored[TO]?.enabled, true);
});
