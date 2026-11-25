import { defineJsonRoute, ok, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import { authorizePublish, type PublishSitePrincipal } from './shared.js';

export interface PublishDestinationsDeps<TRegistry, TPeer, TOutput> {
  loadRegistry(required: Record<string, never>): Promise<TRegistry>;
  mayReadPeers(required: { principalId: string }): Promise<boolean>;
  listPeers(required: Record<string, never>): Promise<readonly TPeer[]>;
  listDestinations(required: { registry: TRegistry; peers: readonly TPeer[] }): Promise<TOutput>;
}

export function createPublishDestinationsRoute<TRegistry, TPeer, TOutput>(
  _required: { deps: PublishDestinationsDeps<TRegistry, TPeer, TOutput> }, _optional = {},
): JsonRouteSpec<undefined, TOutput, PublishDestinationsDeps<TRegistry, TPeer, TOutput>, PublishSitePrincipal> {
  return defineJsonRoute({
    method: 'get', path: '/api/admin/v1/workspaces/:workspaceId/system/publish/destinations',
    parse: () => ok({ value: undefined }),
    handle: async ({ deps, context, authorize }) => {
      await authorizePublish({ authorize, permission: 'system.read' });
      if (!context) throw new Error('publish-site route has no authenticated principal');
      const registry = await deps.loadRegistry({});
      // Omit peer identities as well as peer rows without the additional permission.
      const allowed = await deps.mayReadPeers({ principalId: context.id });
      const peers = allowed ? await deps.listPeers({}) : [];
      return ok({ value: await deps.listDestinations({ registry, peers }) });
    },
  });
}
