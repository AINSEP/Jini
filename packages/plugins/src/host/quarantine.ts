import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import type { Clock as ClockPort } from "@jini-ai/core/primitives";

import type { PluginActivationRecord, PluginActivationRepoPort } from "./activation.js";
import type { PluginQuarantineEvent } from "./hook-registry.js";

export interface QuarantinePluginRequired {
  readonly deps: {
    readonly clock: ClockPort;
    readonly repo: PluginActivationRepoPort;
  };
  readonly input: PluginQuarantineEvent;
}

/**
 * Records the recovery action through the existing activation gateway. The hook registry detaches
 * first so later saves recover immediately; this write makes that disabled state survive restart
 * and supplies the operator-facing reason/count.
 */
export async function quarantinePlugin(
  required: QuarantinePluginRequired,
  _optional: Record<string, never> = {}
): Promise<{ activation: PluginActivationRecord }> {
  const { deps, input } = required;
  const existing = await deps.repo.getActivation({
    workspaceId: input.workspaceId,
    pluginId: input.pluginId,
  });
  if (!existing) {
    throw new Error(`cannot quarantine plugin '${input.pluginId}' without an activation record`);
  }

  const quarantinedAt = clockNowIso({ clock: deps.clock });
  const activation: PluginActivationRecord = {
    ...existing,
    enabled: false,
    updatedAt: quarantinedAt,
    quarantinedAt,
    quarantineReason: input.reason,
    quarantineFailureCount: input.consecutiveFailures,
  };
  await deps.repo.save(activation);
  return { activation };
}
