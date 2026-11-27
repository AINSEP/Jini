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

it.each(['missing', 'off', 'shell'] as const)('keeps virtual page behavior distinct when the theme is %s', async mode => {
  const post: PublicPostRecord = { id: 'member-1', workspaceId: 'w', title: 'Your account', slug: 'account', bodyJson: {},
    kind: 'page', bodyFormat: 'html', bodyHtml: null, status: 'published', templateChoice: null, updatedAt: 'now', version: 1 };
  const theme = { id: 'active-theme' };
  const menus = { main: ['Account'] };
  const perVisitor = { result: undefined, cacheControl: 'private, no-store' };
  const resolveActiveThemeId = vi.fn(async () => 'active-theme');
  const resolveActiveTheme = vi.fn(() => mode === 'missing' ? null : mode === 'off' ? 'none' as const : theme);
  const resolveTemplateBranchChoice = vi.fn(() => ({ kind: 'page-shell' as const, templateChoice: 'shell.html' }));
  const resolveStaticMenusForRender = vi.fn(async () => menus);
  const renderViaTemplate = vi.fn(async () => '<main>Shell</main>');
  const renderGenericPostPage = vi.fn(async () => '<main>Generic</main>');
  const sendPublicPage = vi.fn();
  const sendNoThemesInstalled = vi.fn();
  await renderVirtualPage({ post, currentPath: () => '/account', deps: {
    withListingBatch: () => {}, resolveRenderThemeId: ({ resolveStoredThemeId }) => resolveStoredThemeId(), resolveActiveThemeId,
    resolveSiteAssistantWidgetForRequest: async () => 'react', resolveActiveTheme, NO_THEME_ID: 'none',
    resolveTemplateBranchChoice, resolvePerVisitorResponse: () => perVisitor, resolveStaticMenusForRender,
    renderViaTemplate, renderGenericPostPage, sendPublicPage, sendNoThemesInstalled,
  } });
  expect(resolveActiveThemeId).toHaveBeenCalledExactlyOnceWith();
  expect(resolveActiveTheme).toHaveBeenCalledExactlyOnceWith({ activeThemeId: 'active-theme' });
  expect(sendNoThemesInstalled.mock.calls).toEqual(mode === 'missing' ? [[]] : []);
  expect(resolveTemplateBranchChoice.mock.calls).toEqual(mode === 'shell' ? [[{ theme, post }]] : []);
  expect(resolveStaticMenusForRender.mock.calls).toEqual(mode === 'shell' ? [[{ theme, currentPath: '/account' }]] : []);
  expect(renderViaTemplate.mock.calls).toEqual(mode === 'shell' ? [[
    { theme, post: { ...post, templateChoice: 'shell.html' }, staticMenus: menus },
    { pendingBodyJson: undefined, pendingBodyHtml: '', extraHead: undefined, siteAssistantEnabled: 'react' },
  ]] : []);
  expect(renderGenericPostPage.mock.calls).toEqual(mode === 'off' ? [[{ theme: null, post, posts: [], siteAssistantEnabled: 'react' }]] : []);
  expect(sendPublicPage.mock.calls).toEqual(mode === 'missing' ? [] : [[{ html: mode === 'shell' ? '<main>Shell</main>' : '<main>Generic</main>', perVisitor }]]);
  expect(post.templateChoice).toBeNull();
});
