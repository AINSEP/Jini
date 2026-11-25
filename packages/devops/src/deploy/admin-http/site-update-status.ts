import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import type { SiteUpdateStatusReply } from '@jini-ai/core/contracts/site/devops-deploy';

export interface SiteUpdateStatusRouteDeps {
  getStatus(required: Record<string, never>, optional?: { signal?: AbortSignal | undefined }): Promise<SiteUpdateStatusReply>;
}

export const siteUpdateStatusRoute = defineJsonRoute<Record<string, never>, SiteUpdateStatusReply, SiteUpdateStatusRouteDeps>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/site-update/status',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }, _optional = {}) => {
    if (authorize === undefined) throw new Error('JSON route authorizer is required');
    // Authorization precedes the feed read because denial must cause no outbound request.
    await authorize({ permission: 'system.read', entityType: 'site-update' });
    const value = await deps.getStatus({}, { signal: _optional.signal });
    return ok({ value });
  },
});
