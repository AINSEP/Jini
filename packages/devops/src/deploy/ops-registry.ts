// Mechanical extraction provenance is recorded in this package's source-map.md.
import { ToolInputError } from '@jini-ai/core';
import type { DeployOpsRegistry, LoadedDeployOps } from './ops-contracts.js';
/** Refuse an absent id with the available ids and loader refusals, rather than guessing a platform. */
export function requireDeployPlatform({registry,id}: {registry:DeployOpsRegistry;id:string}, _optional = {}): LoadedDeployOps {
  const platform = registry.get(id);
  if (!platform) {
    const refusals = registry.refusals.length ? ` ${registry.refusals.join(" ")}` : "";
    throw new ToolInputError({ message: `Unknown deployment ops platform '${id}'. Choose: ${registry.list().map(p => p.descriptor.id).join(", ") || "(none)"}.${refusals}` });
  }
  return platform;
}
