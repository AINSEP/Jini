import { defineJsonRoute, ok, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import { authorizePublish, type PublishSitePrincipal } from './shared.js';

const PUBLISH_DESTINATIONS_PATH = "/api/admin/v1/workspaces/:workspaceId/system/publish/destinations";

export interface PublishDestinationsDeps<TRegistry, TPeer, TOutput> {
  loadRegistry(required: Record<string, never>): Promise<TRegistry>;
  mayReadPeers(required: { principalId: string }): Promise<boolean>;
  listPeers(required: Record<string, never>): Promise<readonly TPeer[]>;
  listDestinations(required: { registry: TRegistry; peers: readonly TPeer[] }): Promise<TOutput>;
}

export function createPublishDestinationsRouteSpec<TRegistry, TPeer, TOutput>(
  _required: Record<string, never>, _optional = {},
): JsonRouteSpec<undefined, TOutput, PublishDestinationsDeps<TRegistry, TPeer, TOutput>, PublishSitePrincipal> {
  return defineJsonRoute({
    method: 'get', path: PUBLISH_DESTINATIONS_PATH,
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

export function createPublishDestinationsRoute<TRegistry, TPeer, TOutput>(_required: { deps: PublishDestinationsDeps<TRegistry, TPeer, TOutput> }, _optional = {}) {
  return createPublishDestinationsRouteSpec<TRegistry, TPeer, TOutput>({});
}

export function registerPublishDestinationsRoute<TRegistry, TPeer, TOutput, TTrust>(required: {
  mount(required: {
    spec: JsonRouteSpec<undefined, TOutput, PublishDestinationsDeps<TRegistry, TPeer, TOutput>, PublishSitePrincipal>;
    requestDeps: (facts: { trustContext: () => TTrust | undefined }) => PublishDestinationsDeps<TRegistry, TPeer, TOutput>;
    failure: (facts: { error: unknown; incident: (error: unknown, options: { operation: string; code: string }) => void }) => void;
  }): void;
  workspaceId: string;
  loadRegistry: PublishDestinationsDeps<TRegistry, TPeer, TOutput>["loadRegistry"];
  listPeers: PublishDestinationsDeps<TRegistry, TPeer, TOutput>["listPeers"];
  listDestinations: PublishDestinationsDeps<TRegistry, TPeer, TOutput>["listDestinations"];
  authorize: import("@jini-ai/core/contracts/events").AuthorizeFn;
  authorizeForTrust(trust: TTrust): import("@jini-ai/core/contracts/events").AuthorizeFn;
  operation: string;
}, _optional = {}): void {
  required.mount({ spec: createPublishDestinationsRouteSpec<TRegistry, TPeer, TOutput>({}),
    requestDeps: facts => ({
      loadRegistry: required.loadRegistry,
      mayReadPeers: async ({ principalId }) => {
        const trust = facts.trustContext();
        const peerAuthorization = await (trust ? required.authorizeForTrust(trust) : required.authorize)({ principalId, permission: "publish_content.read", workspaceId: required.workspaceId });
        return peerAuthorization.allowed;
      },
      listPeers: required.listPeers,
      listDestinations: required.listDestinations,
    }),
    failure: facts => facts.incident(facts.error, { operation: required.operation, code: "INTERNAL_ERROR" }),
  });
}
