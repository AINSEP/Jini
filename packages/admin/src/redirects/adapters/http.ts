import type { AdminRedirect, AdminRedirectHitStats, AdminRedirectImportResult, AdminRedirectsPort } from '../../core/ports/redirects.js';
/** Host owns authentication, addressing, retries and error decoding, as in media's adapter. */
export interface RedirectsTransportPort {
  request<T>(required: { path: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }, optional?: Record<string, never>): Promise<T>;
  url(required: { path: string }, optional?: Record<string, never>): string;
}
/** Map existing HTTP envelopes to the core API without validating or rewriting operator inputs.
 * @example createHttpRedirectsApi({ transport, basePath: workspacePath + '/redirects' }, {});
 */
export function createHttpRedirectsApi(
  { transport, basePath }: { transport: RedirectsTransportPort; basePath: string },
  _optional: Record<string, never> = {},
): AdminRedirectsPort {
  const base = basePath.replace(/\/$/, '');
  const path = (id: string) => `${base}/${encodeURIComponent(id)}`;
  async function record(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', target: string, body?: unknown): Promise<AdminRedirect> {
    const response = await transport.request<{ data: AdminRedirect }>({ path: target, method, ...(body === undefined ? {} : { body }) });
    return response.data;
  }
  return {
    async listRedirects(_required, filter = {}) {
      const query = new URLSearchParams();
      for (const key of ['status', 'source', 'matchType'] as const) {
        if (filter[key] !== undefined) query.set(key, filter[key]);
      }
      const suffix = query.size ? `?${query.toString()}` : '';
      return (await transport.request<{ data: readonly AdminRedirect[] }>({ path: `${base}${suffix}`, method: 'GET' })).data;
    },
    getRedirect: ({ id }) => record('GET', path(id)),
    createRedirect: (input, options = {}) => record('POST', base, { ...input, ...options }),
    updateRedirect: ({ id }, patch = {}) => record('PATCH', path(id), patch),
    tombstoneRedirect: ({ id }) => record('DELETE', path(id)),
    async getRedirectHitStats({ id }) {
      return (await transport.request<{ data: AdminRedirectHitStats }>({ path: `${path(id)}/hits`, method: 'GET' })).data;
    },
    importRedirects: ({ rules }) => transport.request<AdminRedirectImportResult>({ path: `${base}/import`, method: 'POST', body: { rules } }),
  };
}
