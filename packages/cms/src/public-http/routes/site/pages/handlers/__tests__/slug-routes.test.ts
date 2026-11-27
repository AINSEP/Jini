import { checkSiteRelativeTarget } from "../../../../../../routing/site/reserved-paths.js";
import { expect, it, vi } from 'vitest';
import { serveSlugPage, nestedPageRoute, serveNestedPage } from '../slug-routes.js';

it('keeps nested redirect phases in order before fallthrough', async () => {
  const phases: string[] = [];
  expect(await nestedPageRoute({ checkSiteRelativeTarget, path: '/nested/path', tryRedirectPhase: async ({ phase }) => { phases.push(phase); return false; } })).toEqual({ kind: 'next' });
  expect(phases).toEqual(['pre_content', 'post_content']);
  const tryRedirectPhase = vi.fn(async () => true);
  expect(await nestedPageRoute({ checkSiteRelativeTarget, path: '/admin/settings', tryRedirectPhase })).toEqual({ kind: 'next' });
  expect(tryRedirectPhase).not.toHaveBeenCalled();
});

it('slug-gate-before-template: a denied post reaches the identical missing path without any render call', async () => {
  const calls: string[] = [];
  const context = { createMemberAccessResolver: () => ({}), listPublishedPosts: async () => ({ posts: [] }), resolveRenderThemeId: async () => 'off', resolveSiteAssistantWidgetForRequest: async () => false,
    resolveMemberContextForRequest: async () => ({}), filterVisiblePosts: () => [] };
  const post = { id: 'hidden' } as import('../../../../../../posts/post.js').PublicPostRecord;
  const ports = { withListingBatch: () => {}, resolveRequestedSlug: () => 'hidden', preRedirect: async () => false, context,
    noThemeId: 'off', resolveActiveTheme: () => 'off', sendNoThemesInstalled: () => {}, currentPath: '/hidden', resolveStaticMenusForRender: async () => ({}),
    resolvePerVisitorResponse: () => ({}), resolveMarketingPageOrOverride: async () => ({ kind: 'fallthrough' as const }), resolvePostAfterMarketingCheck: async () => post,
    decidePostMemberAccess: () => ({ allowed: false }), handlePostNotFoundOnSlugRoute: async () => { calls.push('missing'); },
    renderTemplateBranchIfEligible: async () => { calls.push('template'); return 'leaked'; }, renderGenericPostPage: async () => { calls.push('generic'); return 'leaked'; },
    sendPublicPage: async () => { calls.push('send'); }, handleSlugRouteError: async () => { calls.push('error'); } };
  await serveSlugPage(ports);
  expect(calls).toEqual(['missing']);
  calls.length = 0;
  await serveSlugPage({ ...ports, preRedirect: async () => true });
  expect(calls).toEqual([]);
});

it.each(['pre_content', 'post_content', 'neither'] as const)('lets only the first matching nested redirect handle the request (%s)', async winningPhase => {
  const tryRedirectPhase = vi.fn<Parameters<typeof nestedPageRoute>[0]['tryRedirectPhase']>(async ({ phase }) => phase === winningPhase);
  const next = vi.fn();
  await serveNestedPage({ path: '/news/archive', checkSiteRelativeTarget, tryRedirectPhase, next });
  expect(tryRedirectPhase.mock.calls).toEqual([
    [{ phase: 'pre_content', path: '/news/archive' }],
    ...(winningPhase === 'pre_content' ? [] : [[{ phase: 'post_content', path: '/news/archive' }]]),
  ]);
  expect(next.mock.calls).toEqual(winningPhase === 'neither' ? [[]] : []);
});

it('forwards a nested redirect lookup failure to the router', async () => {
  const error = new Error('redirect rules offline');
  const tryRedirectPhase = vi.fn(async () => { throw error; });
  const next = vi.fn();
  await serveNestedPage({ path: '/news/archive', checkSiteRelativeTarget, tryRedirectPhase, next });
  expect(tryRedirectPhase).toHaveBeenCalledExactlyOnceWith({ phase: 'pre_content', path: '/news/archive' });
  expect(next).toHaveBeenCalledExactlyOnceWith(error);
});

function slugFixture() {
  const post: import('../../../../../../posts/post.js').PublicPostRecord = {
    id: 'story-1', workspaceId: 'w', title: 'Story', slug: 'story', bodyJson: {}, kind: 'post',
    bodyFormat: 'doc', bodyHtml: null, status: 'published', updatedAt: 'now', version: 1,
  };
  const resolver = { key: 'resolver' };
  const viewer = { key: 'visitor' };
  const theme = { id: 'active' };
  const staticMenus = { main: ['News'] };
  const perVisitor = { cache: 'private' };
  const ports = {
    withListingBatch: vi.fn(), resolveRequestedSlug: vi.fn(() => 'story'), preRedirect: vi.fn(async () => false),
    context: { createMemberAccessResolver: () => resolver, listPublishedPosts: async () => ({ posts: [post] }),
      resolveRenderThemeId: async () => 'active', resolveSiteAssistantWidgetForRequest: async () => 'react' as const,
      resolveMemberContextForRequest: async () => viewer, filterVisiblePosts: () => [post] },
    noThemeId: 'off', resolveActiveTheme: () => theme, sendNoThemesInstalled: vi.fn(), currentPath: '/story',
    resolveStaticMenusForRender: vi.fn(async () => staticMenus), resolvePerVisitorResponse: () => perVisitor,
    resolveMarketingPageOrOverride: vi.fn(async () => ({ kind: 'fallthrough' as const })),
    resolvePostAfterMarketingCheck: vi.fn(async () => post), decidePostMemberAccess: () => ({ allowed: true }),
    handlePostNotFoundOnSlugRoute: vi.fn(async () => {}), renderTemplateBranchIfEligible: vi.fn<() => Promise<string | undefined>>(async () => undefined),
    renderGenericPostPage: vi.fn(async () => '<main>Generic story</main>'),
    sendPublicPage: vi.fn(async () => {}), handleSlugRouteError: vi.fn(async () => {}),
  };
  return { ports, post, theme, staticMenus, perVisitor, resolver, viewer };
}

it('sends the resolved marketing document with visitor policy without reading a post', async () => {
  const { ports, theme, staticMenus, perVisitor, resolver, viewer } = slugFixture();
  const resolveMarketingPageOrOverride = vi.fn(async () => ({ kind: 'responded' as const, html: '<main>Marketing</main>' }));
  await serveSlugPage({ ...ports, resolveMarketingPageOrOverride });
  expect(resolveMarketingPageOrOverride).toHaveBeenCalledExactlyOnceWith({ theme, slug: 'story', staticMenus, siteAssistantEnabled: 'react' },
    { postPreviewsAccess: { resolver, context: viewer } });
  expect(ports.sendPublicPage).toHaveBeenCalledExactlyOnceWith({ html: '<main>Marketing</main>', perVisitor });
  expect(ports.resolvePostAfterMarketingCheck).not.toHaveBeenCalled();
  expect(ports.renderTemplateBranchIfEligible).not.toHaveBeenCalled();
});

it.each([undefined, ''] as const)('falls back from a template only for a missing result (%s)', async template => {
  const { ports, post, theme, staticMenus, perVisitor, resolver, viewer } = slugFixture();
  ports.renderTemplateBranchIfEligible.mockResolvedValueOnce(template);
  await serveSlugPage(ports);
  expect(ports.renderTemplateBranchIfEligible).toHaveBeenCalledExactlyOnceWith({ theme, post, staticMenus, siteAssistantEnabled: 'react' },
    { postPreviewsAccess: { resolver, context: viewer } });
  expect(ports.renderGenericPostPage.mock.calls).toEqual(template === undefined ? [[{ theme, post, posts: [post], siteAssistantEnabled: 'react' }]] : []);
  expect(ports.sendPublicPage).toHaveBeenCalledExactlyOnceWith({ html: template ?? '<main>Generic story</main>', perVisitor });
  expect(ports.handleSlugRouteError).not.toHaveBeenCalled();
});

it('passes the already resolved theme and menus to the slug failure handler', async () => {
  const { ports, theme, staticMenus } = slugFixture();
  const err = new Error('post read failed');
  ports.resolvePostAfterMarketingCheck.mockRejectedValueOnce(err);
  await serveSlugPage(ports);
  expect(ports.handleSlugRouteError).toHaveBeenCalledExactlyOnceWith({ err, theme, staticMenus, slug: 'story' });
  expect(ports.sendPublicPage).not.toHaveBeenCalled();
});

it('stops before redirects for an unrecognized slug and stops before menus for missing themes', async () => {
  const { ports } = slugFixture();
  await serveSlugPage({ ...ports, resolveRequestedSlug: () => undefined });
  expect(ports.preRedirect).not.toHaveBeenCalled();
  expect(ports.withListingBatch).toHaveBeenCalledExactlyOnceWith();
  await serveSlugPage({ ...ports, resolveActiveTheme: () => null });
  expect(ports.sendNoThemesInstalled).toHaveBeenCalledExactlyOnceWith();
  expect(ports.resolveStaticMenusForRender).not.toHaveBeenCalled();
  expect(ports.resolveMarketingPageOrOverride).not.toHaveBeenCalled();
});
