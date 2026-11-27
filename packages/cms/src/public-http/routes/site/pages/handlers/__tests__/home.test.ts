import { expect, it, vi } from 'vitest';
import { ListingBatchNotFoundError } from '../../../../../../listing/request-state.js';
import { serveHomePage } from '../home.js';
import { PostNotFoundError, type PublicPostRecord } from '../../../../../../posts/post.js';

function homeFixture() {
  const post = { id: 'root' } as PublicPostRecord;
  const send = vi.fn(async () => {});
  const staticIndex = vi.fn(async () => {});
  const renderSite = vi.fn(async () => 'dynamic');
  const sendNoThemesInstalled = vi.fn();
  const readHomePage = vi.fn(async () => ({ post }));
  const context = { createMemberAccessResolver: () => ({}), listPublishedPosts: vi.fn(async () => ({ posts: [] })), resolveRenderThemeId: async () => 'off',
    resolveSiteAssistantWidgetForRequest: async () => false, resolveMemberContextForRequest: async () => ({}), filterVisiblePosts: () => [] };
  const ports = { preRedirect: async () => false, rootPath: '/', context, noThemeId: 'off', resolveActiveTheme: () => 'off', sendNoThemesInstalled,
    readHomePage, decidePostMemberAccess: () => ({ allowed: false }), resolveStaticMenusForRender: async () => ({}),
    renderTemplateBranchIfEligible: vi.fn(async () => 'authored'), renderGenericPostPage: vi.fn(async () => 'generic'), title: async () => 'title', widgets: async () => undefined,
    mediaTransformVersions: async () => undefined, extraHead: async () => '', staticIndex, timeZone: async () => 'UTC', mediaAssetMetadata: async () => undefined,
    listingAfter: () => 0, renderSite, perVisitor: () => ({}), send, listingFailure: vi.fn(), reportFault: vi.fn(), sendFault: vi.fn() };
  return { ports, context, readHomePage, sendNoThemesInstalled, renderSite, send, staticIndex };
}

it('short-circuits redirects, distinguishes no theme from theme off and hides a gated root like a missing root', async () => {
  const { ports, context, readHomePage, sendNoThemesInstalled, renderSite, send, staticIndex } = homeFixture();
  await serveHomePage({ ...ports, preRedirect: async () => true });
  expect(context.listPublishedPosts).not.toHaveBeenCalled();
  await serveHomePage({ ...ports, resolveActiveTheme: () => null });
  expect(sendNoThemesInstalled).toHaveBeenCalledOnce(); expect(readHomePage).not.toHaveBeenCalled();
  await serveHomePage(ports);
  expect(renderSite).toHaveBeenCalledWith(expect.objectContaining({ theme: null, route: 'home' }));
  expect(ports.renderTemplateBranchIfEligible).not.toHaveBeenCalled();
  await serveHomePage({ ...ports, readHomePage: async () => { throw Object.create(PostNotFoundError.prototype); } });
  expect(send).toHaveBeenCalledTimes(2); expect(staticIndex).not.toHaveBeenCalled();
  await serveHomePage({ ...ports, resolveActiveTheme: () => ({ manifest: { tier: 'static' }, pages: { index: 'index' } }), decidePostMemberAccess: () => ({ allowed: true }) });
  expect(ports.renderTemplateBranchIfEligible).toHaveBeenCalledOnce();
  expect(staticIndex).not.toHaveBeenCalled();
  expect(send).toHaveBeenLastCalledWith({ html: 'authored', perVisitor: {} });
});

it('serves the static home index with the resolved menus, head and member context', async () => {
  const { ports, staticIndex, renderSite, send } = homeFixture();
  const theme = { manifest: { tier: 'static' }, pages: { index: '<main>Theme index</main>' } };
  const resolver = { id: 'resolver' };
  const context = { id: 'viewer' };
  const staticMenus = { header: ['News'] };
  const extraHead = vi.fn(async () => '<title>News</title>');
  const resolveStaticMenusForRender = vi.fn(async () => staticMenus);
  await serveHomePage({ ...ports, resolveActiveTheme: () => theme,
    context: { ...ports.context, createMemberAccessResolver: () => resolver, resolveMemberContextForRequest: async () => context,
      resolveSiteAssistantWidgetForRequest: async () => 'vanilla' },
    title: async () => 'News', extraHead, resolveStaticMenusForRender,
  });
  expect(extraHead).toHaveBeenCalledExactlyOnceWith({ route: 'home', siteTitle: 'News', post: undefined });
  expect(resolveStaticMenusForRender).toHaveBeenCalledExactlyOnceWith({ theme, currentPath: '/' });
  expect(staticIndex).toHaveBeenCalledExactlyOnceWith({
    theme, staticMenus, extraHead: '<title>News</title>', siteAssistantEnabled: 'vanilla', access: { resolver, context },
  });
  expect(renderSite).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it('renders the authored homepage generically if its template is ineligible', async () => {
  const { ports, send, renderSite, staticIndex } = homeFixture();
  const post: PublicPostRecord = { id: 'home-2', workspaceId: 'w', title: 'Home', slug: '/', bodyJson: {},
    kind: 'page', bodyFormat: 'html', bodyHtml: '<p>Welcome</p>', status: 'published', updatedAt: 'now', version: 1 };
  await serveHomePage({ ...ports, readHomePage: async () => ({ post }), renderTemplateBranchIfEligible: async () => undefined,
    decidePostMemberAccess: () => ({ allowed: true }), perVisitor: () => ({ private: true }) });
  expect(ports.renderGenericPostPage).toHaveBeenCalledExactlyOnceWith({ theme: null, post, posts: [], siteAssistantEnabled: false });
  expect(send).toHaveBeenCalledExactlyOnceWith({ html: 'generic', perVisitor: { private: true } });
  expect(staticIndex).not.toHaveBeenCalled();
  expect(renderSite).not.toHaveBeenCalled();
});

it.each([
  ['listing miss', new ListingBatchNotFoundError()],
  ['post-store failure', new Error('home lookup timed out')],
] as const)('separates a %s from a missing homepage', async (kind, error) => {
  const { ports, send, renderSite } = homeFixture();
  await serveHomePage({ ...ports, readHomePage: async () => { throw error; } });
  expect(ports.listingFailure.mock.calls).toEqual(kind === 'listing miss' ? [[]] : []);
  expect(ports.reportFault.mock.calls).toEqual(kind === 'post-store failure' ? [[error]] : []);
  expect(ports.sendFault.mock.calls).toEqual(kind === 'post-store failure' ? [[]] : []);
  expect(send).not.toHaveBeenCalled();
  expect(renderSite).not.toHaveBeenCalled();
});
