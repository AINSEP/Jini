import type { PluginContributionsSnapshot } from '@jini-ai/core/contracts/site/plugins-host';
import type { PluginAuthContext, PluginRouteResult } from '@jini-ai/core/contracts/plugin-sdk';

export type PluginHttpReply =
  | { kind: 'not-found'; status: 404; body: { code: 'NOT_FOUND' } }
  | { kind: 'failed'; status: 500; body: { code: 'PLUGIN_ROUTE_FAILED' } }
  | { kind: 'result'; cacheControl: 'no-store'; response: 'empty'; status: 204 }
  | { kind: 'result'; cacheControl: 'no-store'; response: 'json'; status: number; body: unknown };

/** Whether the durable activation row says the plugin is enabled right now. */
export async function isPluginActivated({ workspaceId, pluginId, getActivation }: {
  workspaceId: string; pluginId: string;
  getActivation(required: { workspaceId: string; pluginId: string }): Promise<{ enabled: boolean } | null | undefined>;
}, _optional = {}): Promise<boolean> {
  const row = await getActivation({ workspaceId, pluginId });
  return Boolean(row?.enabled);
}

export async function invokeLivePluginRoute({ workspaceId, snapshot, route, input, ports }: {
  workspaceId: string; snapshot: PluginContributionsSnapshot; route: PluginContributionsSnapshot['routes'][number];
  input: Pick<Parameters<PluginContributionsSnapshot['routes'][number]['handler']>[0], 'body' | 'params' | 'query'>;
  ports: {
    isActivated(required: { pluginId: string }): Promise<boolean>;
    isLive(required: { snapshot: PluginContributionsSnapshot }): boolean;
    principalIdFor(required: { access: PluginAuthContext['access'] }): string | undefined;
    reportError(required: { pluginId: string; error: unknown }, optional?: Record<string, never>): void;
  };
}, _optional = {}): Promise<PluginHttpReply> {
  try {
    if (!(await ports.isActivated({ pluginId: snapshot.pluginId })) || !ports.isLive({ snapshot })) return { kind: 'not-found', status: 404, body: { code: 'NOT_FOUND' } };
    const principalId = route.access === 'public' ? undefined : ports.principalIdFor({ access: route.access });
    const context: PluginAuthContext = { access: route.access, workspaceId, ...(principalId === undefined ? {} : { principalId }) };
    const result: PluginRouteResult | void = await route.handler({ pluginId: snapshot.pluginId, sdk: snapshot.sdk, auth: context, body: input.body, params: input.params, query: input.query }, {});
    // A disable/reload while the handler awaited must not emit a retired generation's result.
    if (!ports.isLive({ snapshot }) || !(await ports.isActivated({ pluginId: snapshot.pluginId }))) return { kind: 'not-found', status: 404, body: { code: 'NOT_FOUND' } };
    if (result === undefined) return { kind: 'result', cacheControl: 'no-store', response: 'empty', status: 204 };
    return { kind: 'result', cacheControl: 'no-store', response: 'json', status: result.status ?? 200, body: result.body ?? null };
  } catch (error) {
    ports.reportError({ pluginId: snapshot.pluginId, error }, {});
    return { kind: 'failed', status: 500, body: { code: 'PLUGIN_ROUTE_FAILED' } };
  }
}
