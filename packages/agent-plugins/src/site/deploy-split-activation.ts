import type { AgentPluginActivations, AgentPluginActivationVerdict, SetAgentPluginActivationRequired, SetAgentPluginActivationOptional } from "../lifecycle/index.js";

/** @file Preserve explicit activation decisions across a plugin rename (a predecessor plugin was retired in
 * favour of its successor plugin; the host injects both ids). */

/** The activation calls this step makes, from the boot's lifecycle owner. */
export interface DeploySplitActivationPort {
  readonly assertAgentPluginActivationsWritable: (input: { readonly workspaceRoot: string }) => Promise<void>;
  readonly resolveAgentPluginActivation: (input: { readonly workspaceRoot: string; readonly pluginId: string }) => Promise<AgentPluginActivationVerdict>;
  readonly readAgentPluginActivations: (input: { readonly workspaceRoot: string }) => Promise<AgentPluginActivations>;
  readonly setAgentPluginActivation: (required: SetAgentPluginActivationRequired, optional?: SetAgentPluginActivationOptional) => Promise<unknown>;
}

/** Rename precedes split seeding: an existing predecessor-plugin decision wins over old inheritance.
 * Explicit successor decisions win, even when they disagree. Corrupt records fail closed.
 * @complexity O(1), two strict verdicts and at most one activation write. */
export async function carryPluginRenameActivation(required: { readonly workspaceRoot: string; readonly activations: DeploySplitActivationPort; readonly fromPluginId: string; readonly toPluginId: string; readonly actor: string }, _optional: Record<string, never> = {}): Promise<void> {
  const { workspaceRoot, activations, fromPluginId, toPluginId, actor } = required;
  await activations.assertAgentPluginActivationsWritable({ workspaceRoot });
  for (const pluginId of [fromPluginId, toPluginId]) {
    const verdict = await activations.resolveAgentPluginActivation({ workspaceRoot, pluginId });
    if (verdict.verdict === "undetermined") throw new Error(`Cannot carry ${pluginId} activation: ${verdict.reason}`);
  }
  const { plugins } = await activations.readAgentPluginActivations({ workspaceRoot });
  const previous = plugins[fromPluginId];
  const successor = plugins[toPluginId];
  if (successor !== undefined && successor.updatedBy !== "system:seed") return;
  if (previous === undefined || previous.updatedBy === "system:seed") return;
  await activations.setAgentPluginActivation({ workspaceRoot, pluginId: toPluginId, enabled: previous.enabled, actor }, { origin: "bundled" });
}
