import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';

import { authorizePublish, type PublishSitePrincipal } from './shared.js';

/**
 * @file `GET .../system/publish-targets` — the host's deploy-target registry as the admin publish
 * card's descriptors (ids, labels, config field specs, the saved-credential form's field specs and
 * their translations). A module path, a vendor id or a refusal reason stays server-side: the host's
 * `listTargets` projects them away before this route sees them.
 */

/** One target descriptor, answered unchanged. */
export type PublishTargetView = Readonly<Record<string, unknown>>;

/** The host's registry load + public projection for this workspace. */
export type PublishTargetsListFn = () => Promise<readonly PublishTargetView[]>;

/** The deps this route reads. */
export interface PublishTargetsRouteDeps {
  workspaceId: string;
  listTargets: PublishTargetsListFn;
}

/** `GET .../system/publish-targets`: `{ targets }`.
 * @complexity O(1) plus the injected registry load.
 */
export const publishTargetsRoute = defineJsonRoute<Record<string, never>, { targets: readonly PublishTargetView[] }, PublishTargetsRouteDeps, PublishSitePrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/publish-targets',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizePublish({ authorize, permission: 'system.read' });
    return ok({ value: { targets: await deps.listTargets() } });
  },
});
