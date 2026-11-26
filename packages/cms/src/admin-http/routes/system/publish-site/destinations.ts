import { defineJsonRoute, ok, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import { authorizePublish, type PublishSitePrincipal } from './shared.js';

const PUBLISH_DESTINATIONS_PATH = "/api/admin/v1/workspaces/:workspaceId/system/publish/destinations";

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

export function registerPublishDestinationsRoute(required: {
  mount(required: {
    method: "get"; path: string;
    request: (facts: { trustContext: () => unknown }) => { spec: ReturnType<typeof createPublishDestinationsRoute>; deps: PublishDestinationsDeps<unknown, unknown, unknown> };
    failure: (facts: { error: unknown; incident: (error: unknown, options: { operation: string; code: string }) => void }) => void;
  }): void;
  workspaceId: string;
  loadRegistry: PublishDestinationsDeps<unknown, unknown, unknown>["loadRegistry"];
  listPeers: PublishDestinationsDeps<unknown, unknown, unknown>["listPeers"];
  listDestinations: PublishDestinationsDeps<unknown, unknown, unknown>["listDestinations"];
  authorize: import("@jini-ai/core/contracts/events").AuthorizeFn;
  authorizeForTrust(trust: unknown): import("@jini-ai/core/contracts/events").AuthorizeFn;
  operation: string;
}, _optional = {}): void {
  required.mount({ method: "get", path: PUBLISH_DESTINATIONS_PATH,
    request: facts => {
      const deps: PublishDestinationsDeps<unknown, unknown, unknown> = {
        loadRegistry: required.loadRegistry,
        mayReadPeers: async ({ principalId }) => {
          const trust = facts.trustContext();
          const peerAuthorization = await (trust ? required.authorizeForTrust(trust) : required.authorize)({ principalId, permission: "publish_content.read", workspaceId: required.workspaceId });
          return peerAuthorization.allowed;
        },
        listPeers: required.listPeers,
        listDestinations: required.listDestinations,
      };
      return { spec: createPublishDestinationsRoute({ deps }), deps };
    },
    failure: facts => facts.incident(facts.error, { operation: required.operation, code: "INTERNAL_ERROR" }),
  });
}
