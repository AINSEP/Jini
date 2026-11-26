import { expect, it, vi } from 'vitest';
import { serveHomePage } from '../home.js';
import { PostNotFoundError, type PublicPostRecord } from '../../../../../../posts/post.js';

it('short-circuits redirects, distinguishes no theme from theme off and hides a gated root like a missing root', async () => {
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
