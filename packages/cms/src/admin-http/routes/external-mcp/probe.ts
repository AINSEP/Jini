import { defineJsonRoute, ok, routeReply } from '@jini-ai/core/contracts/server';
import { authorizeExternalMcp, externalMcpParam } from './shared.js';

export const externalMcpProbeRoute = defineJsonRoute<{ serverId: string }, unknown, {
  probe(required: { serverId: string }): Promise<{ ok: true; body: unknown } | { ok: false; status: number; body: unknown }>;
}>({
  method: 'post', path: '/api/admin/v1/workspaces/:workspaceId/mcp-servers/:serverId/probe',
  parse: raw => ok({ value: { serverId: externalMcpParam({ params: raw.params, name: 'serverId' }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeExternalMcp({ authorize });
    const outcome = await deps.probe({ serverId: input.serverId });
    return ok({ value: routeReply({ status: outcome.ok ? 200 : outcome.status, body: outcome.body }) });
  },
});
