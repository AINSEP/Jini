// Mechanical extraction provenance is recorded in this package's source-map.md.
import { ToolInputError } from '@jini-ai/core';
import type { DeployOpsRegistry, LoadedDeployOps } from './ops-contracts.js';
/** Refuse an absent id with the switched-off plugin that provides it, else the available ids and loader refusals, rather than guessing a platform. */
export function requireDeployPlatform({registry,id}: {registry:DeployOpsRegistry;id:string}, _optional = {}): LoadedDeployOps {
  const platform = registry.get(id);
  if (!platform) {
    const pluginId = registry.switchedOff?.get(id);
    if (pluginId !== undefined) throw new ToolInputError({ message: `Deployment ops platform '${id}' is provided by plugin '${pluginId}', which is off; turn it on first.` });
    const refusals = registry.refusals.length ? ` ${registry.refusals.join(" ")}` : "";
    throw new ToolInputError({ message: `Unknown deployment ops platform '${id}'. Choose: ${registry.list().map(p => p.descriptor.id).join(", ") || "(none)"}.${refusals}` });
  }
  return platform;
}
