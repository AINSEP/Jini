import { runWithExternalMcpRateLimit } from "./route-helpers.js";
import { defineJsonRoute, ok, routeReply } from '@jini-ai/core/contracts/server';
import { authorizeExternalMcp, externalMcpParam, type ExternalMcpRoutePrincipal } from './shared.js';

export const externalMcpProbeRoute = defineJsonRoute<{ serverId: string }, unknown, {
  probe(required: { serverId: string }): Promise<{ ok: true; body: unknown } | { ok: false; status: number; body: unknown }>;
}, ExternalMcpRoutePrincipal>({
  method: 'post', path: '/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId/probe',
  parse: raw => ok({ value: { serverId: externalMcpParam({ params: raw.params, name: 'serverId' }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    const outcome = await deps.probe({ serverId: input.serverId });
    return ok({ value: routeReply({ status: outcome.ok ? 200 : outcome.status, body: outcome.body }) });
  },
});

export function registerExternalMcpProbeRoute(required: {
  mount(required: {
    spec: typeof externalMcpProbeRoute;
    authorization: "direct";
    deps: Parameters<typeof externalMcpProbeRoute.handle>[0]["deps"];
    before: (facts: { rate: Parameters<typeof runWithExternalMcpRateLimit>[0]["deps"] }, next: () => Promise<void>) => Promise<void>;
    failure: (facts: { error: unknown; incident: (error: unknown, options: { operation: string; code: string }) => void }) => void;
  }): void;
  probe: Parameters<typeof externalMcpProbeRoute.handle>[0]["deps"]["probe"];
  operation: string;
}, _optional = {}): void {
  required.mount({ spec: externalMcpProbeRoute, authorization: "direct", deps: { probe: required.probe },
    before: (facts, next) => runWithExternalMcpRateLimit({ deps: facts.rate, run: next }),
    failure: ({ error, incident }) => incident(error, { operation: required.operation, code: "INTERNAL_ERROR" }),
  });
}
