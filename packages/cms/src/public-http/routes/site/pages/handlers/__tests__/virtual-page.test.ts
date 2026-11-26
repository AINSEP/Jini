import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../../posts/post.js';
import { renderVirtualPage } from '../virtual-page.js';

it.each(['template', 'generic'] as const)('renders a virtual page through %s without a public body lookup or preview access', async kind => {
  const post: PublicPostRecord = { id: 'virtual', workspaceId: 'w', title: 'Sign in', slug: 'signin', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: '', status: 'published', updatedAt: 'now', version: 1 };
  const publicRead = vi.fn(async () => 'saved public body');
  const sendPublicPage = vi.fn();
  const renderViaTemplate = vi.fn(async (_required: unknown, optional: { pendingBodyHtml?: string }) => optional.pendingBodyHtml === undefined ? publicRead() : '<main>' + optional.pendingBodyHtml + '</main>');
  const renderGenericPostPage = vi.fn(async ({ posts }: { posts: PublicPostRecord[] }) => '<main>' + posts.map(post => post.title).join('') + '</main>');
  await renderVirtualPage({ post, currentPath: () => '/signin', deps: {
    withListingBatch: () => undefined,
    resolveRenderThemeId: ({ resolveStoredThemeId }) => resolveStoredThemeId(), resolveActiveThemeId: async () => 'active',
    resolveSiteAssistantWidgetForRequest: async () => false, resolveActiveTheme: () => ({}), NO_THEME_ID: 'none',
    resolveTemplateBranchChoice: () => ({ kind: kind === 'template' ? 'as-chosen' : 'ineligible' }),
    resolvePerVisitorResponse: () => ({ result: undefined, cacheControl: 'private, no-store' }),
    resolveStaticMenusForRender: async () => ({}), renderViaTemplate, renderGenericPostPage,
    sendPublicPage, sendNoThemesInstalled: () => { throw new Error('unexpected no theme'); },
  } });
  expect(sendPublicPage).toHaveBeenCalledExactlyOnceWith({ html: '<main></main>', perVisitor: { result: undefined, cacheControl: 'private, no-store' } });
  expect(publicRead).not.toHaveBeenCalled();
  if (kind === 'template') {
    expect(renderViaTemplate.mock.calls[0]?.[1]).toEqual({ pendingBodyJson: undefined, pendingBodyHtml: '', extraHead: undefined, siteAssistantEnabled: false });
    expect(renderGenericPostPage).not.toHaveBeenCalled();
  } else {
    expect(renderGenericPostPage.mock.calls[0]?.[0].posts).toEqual([]);
    expect(renderViaTemplate).not.toHaveBeenCalled();
  }
});
