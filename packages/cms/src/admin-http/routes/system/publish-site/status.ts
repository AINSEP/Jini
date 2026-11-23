import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';

import { authorizePublish, type PublishSitePrincipal } from './shared.js';

/**
 * @file `GET .../system/publish` — polls the host's single process-local publish run slot (the same
 * slot the publish agent tools trigger and poll). `system.publish`-gated, like the trigger it polls.
 */

/** The run state; answered unchanged. */
export interface PublishRunSnapshotView { readonly status: string }

/** The deps this route reads: the host's publish run slot. */
export interface PublishStatusRouteDeps {
  workspaceId: string;
  getRunSnapshot: () => PublishRunSnapshotView;
}

/** `GET .../system/publish`: the current publish run snapshot.
 * @complexity O(1).
 */
export const publishStatusRoute = defineJsonRoute<Record<string, never>, PublishRunSnapshotView, PublishStatusRouteDeps, PublishSitePrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/publish',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizePublish({ authorize, permission: 'system.publish' });
    return ok({ value: deps.getRunSnapshot() });
  },
});
