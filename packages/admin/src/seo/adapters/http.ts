import type { AdminSeoPort } from '../ports.js';
import type { AdminSeoSettings, AdminSeoMeta, AdminSeoAnalysis, AdminSeoEntryChoice } from '../../core/ports/seo.js';
/** Host owns authentication, workspace addressing, retries, JSON and API error decoding. */
export interface SeoTransportPort {
  request<T>(required: { path: string; method: 'GET' | 'PUT' | 'POST'; body?: unknown }, optional?: { signal?: AbortSignal }): Promise<T>;
  url(required: { path: string }, optional?: Record<string, never>): string;
}
/** Public XML uses the host's raw transport, since the admin JSON transport cannot decode XML. */
export interface SeoSitemapTransportPort {
  get(required: { path: '/sitemap.xml'; credentials: 'same-origin' }, optional?: { signal?: AbortSignal }): Promise<Pick<Response, 'ok' | 'status' | 'headers' | 'text'>>;
}
/** Preserves every existing SEO request path and body; basePath is the host workspace path. */
export function createHttpSeoApi(
  { transport, basePath }: { transport: SeoTransportPort; basePath: string },
  { sitemapTransport }: { sitemapTransport?: SeoSitemapTransportPort } = {},
): AdminSeoPort {
  const base = basePath.replace(/\/$/, '');
  const entryPath = (entryId: string) => `${base}/seo/entries/${encodeURIComponent(entryId)}`;
  async function data<T>(path: string, method: 'GET' | 'PUT' | 'POST', body?: unknown): Promise<T> {
    const response = await transport.request<{ data: T }>({ path, method, ...(body === undefined ? {} : { body }) });
    return response.data;
  }
  async function choices(kind: 'posts' | 'pages'): Promise<readonly AdminSeoEntryChoice[]> {
    const response = await transport.request<{ posts: readonly { post: AdminSeoEntryChoice }[] }>({ path: `${base}/${kind}`, method: 'GET' });
    return response.posts.map(({ post }) => post);
  }
  return {
    getSeoSettings: () => data<AdminSeoSettings>(`${base}/seo/settings`, 'GET'),
    putSeoSettings: (_required, patch = {}) => data<AdminSeoSettings>(`${base}/seo/settings`, 'PUT', patch),
    regenerateSeoSitemap: () => data<{ accepted: boolean }>(`${base}/seo/sitemap/regenerate`, 'POST'),
    getSeoEntry: ({ entryId }) => data<AdminSeoMeta>(entryPath(entryId), 'GET'),
    putSeoEntry: ({ entryId }, patch = {}) => data<AdminSeoMeta>(entryPath(entryId), 'PUT', patch),
    analyzeSeoEntry: ({ entryId }) => data<AdminSeoAnalysis>(`${entryPath(entryId)}/analyze`, 'GET'),
    listSeoPosts: () => choices('posts'),
    listSeoPages: () => choices('pages'),
    mediaOriginalUrl: ({ id }) => transport.url({ path: `${base}/media/${encodeURIComponent(id)}/original` }),
    async fetchSitemapXml(_required, options = {}) {
      if (!sitemapTransport) throw new Error('SEO sitemap transport unavailable');
      options.signal?.throwIfAborted();
      const response = await sitemapTransport.get({ path: '/sitemap.xml', credentials: 'same-origin' }, options);
      // Non-XML often means a dev proxy, stale build or captive portal answered instead. Do not
      // silently parse an HTML error page as a sitemap with zero URLs (source defensive guard).
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !contentType.includes('xml')) throw new Error(`Could not load the sitemap (HTTP ${response.status}).`);
      return { text: await response.text() };
    },
  };
}
