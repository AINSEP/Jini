import type { AdminDeploymentOverview } from "@jini-ai/admin/deployment/api/deployment-api.types";

/**
 * @file What `useDeploymentOverview` needs from the outside world, as an interface rather than a
 * direct host API import — same `useX(dependencies)` / `useWiredX()` split
 * `integrations-port.hooks.ts` documents as the canonical shape for this app.
 */
export interface DeploymentOverviewPort {
  getDeploymentOverview(): Promise<AdminDeploymentOverview>;
}
