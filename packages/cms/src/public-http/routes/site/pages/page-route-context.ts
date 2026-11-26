import type { PublicPostRecord } from '../../../../posts/post.js';
import type { RenderSiteRequired } from '../../../http/site/render-site.js';

export function resolvePageRouteTheme<TTheme extends object>(required: {
  resolved: TTheme | string | null; noThemeId: string;
}, _optional = {}): { kind: 'missing' } | { kind: 'theme'; theme: TTheme | null } {
  if (required.resolved === null) return { kind: 'missing' };
  return { kind: 'theme', theme: required.resolved === required.noThemeId ? null : required.resolved as TTheme };
}

export async function preparePageRouteContext<TResolver, TContext>(required: {
  ports: {
  createMemberAccessResolver: () => TResolver;
  listPublishedPosts: () => Promise<{ posts: PublicPostRecord[] }>;
  resolveRenderThemeId: () => Promise<string>;
  resolveSiteAssistantWidgetForRequest: () => Promise<NonNullable<RenderSiteRequired['siteAssistantEnabled']>>;
  resolveMemberContextForRequest: (required: { resolver: TResolver }) => Promise<TContext>;
  filterVisiblePosts: (required: { resolver: TResolver; posts: PublicPostRecord[]; context: TContext }) => PublicPostRecord[];
  }; home: boolean;
}, _optional = {}) {
  const { home, ports } = required;
  const memberAccessResolver = ports.createMemberAccessResolver();
  const readMemberContext = () => ports.resolveMemberContextForRequest({ resolver: memberAccessResolver });
  const [first, second, siteAssistantEnabled, memberContext] = home
    ? await Promise.all([ports.listPublishedPosts(), ports.resolveRenderThemeId(), ports.resolveSiteAssistantWidgetForRequest(), readMemberContext()])
    : await Promise.all([ports.resolveRenderThemeId(), ports.listPublishedPosts(), ports.resolveSiteAssistantWidgetForRequest(), readMemberContext()]);
  const activeThemeId = typeof first === 'string' ? first : second as string;
  const { posts } = typeof first === 'string' ? second as { posts: PublicPostRecord[] } : first;
  const visiblePosts = ports.filterVisiblePosts({ resolver: memberAccessResolver, posts, context: memberContext });
  return { activeThemeId, siteAssistantEnabled, memberAccessResolver, memberContext, visiblePosts };
}
