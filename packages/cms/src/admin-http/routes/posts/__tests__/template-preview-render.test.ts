import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../posts/post.js';
import { renderPostPreview } from '../template-preview-render.js';

it('renders a bare preview before reading the active theme', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: 'saved', status: 'draft', templateChoice: '', updatedAt: 'now', version: 1 };
  const getPresentationSettings = vi.fn(async () => ({ settings: { activeThemeId: 'active' } }));
  const result = await renderPostPreview({ input: { post }, deps: {
    getPresentationSettings, isBarePageChoice: post => post.templateChoice === '', renderBarePreview: async ({ post }) => '<main>' + post.bodyHtml + '</main>',
    resolveActiveTheme: () => null, NO_THEME_ID: 'none', resolveTemplateBranchChoice: () => ({ kind: 'ineligible' }),
    resolveStaticMenusForRender: async () => ({}), postPublicPath: ({ slug }) => '/' + slug,
    createMemberAccessResolver: () => ({}), renderViaTemplate: async () => { throw new Error('unexpected template'); },
    copy: { missingTheme: 'missing theme', themeOff: 'theme off' },
  } });
  expect(result).toEqual({ html: '<main>saved</main>', templateChoice: '' });
  expect(getPresentationSettings).not.toHaveBeenCalled();
});

it('keeps pending empty HTML ahead of the saved draft and changes only the render clone', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: 'saved', status: 'draft', templateChoice: null, updatedAt: 'now', version: 1 };
  const result = await renderPostPreview({ input: { post, bodyHtml: '' }, deps: {
    getPresentationSettings: async () => ({ settings: { activeThemeId: 'active' } }), isBarePageChoice: () => false,
    renderBarePreview: async () => { throw new Error('unexpected bare'); }, resolveActiveTheme: () => ({}), NO_THEME_ID: 'none',
    resolveTemplateBranchChoice: () => ({ kind: 'page-shell', templateChoice: 'page.html' }),
    resolveStaticMenusForRender: async () => ({}), postPublicPath: ({ slug }) => '/' + slug, createMemberAccessResolver: () => ({}),
    renderViaTemplate: async ({ post: preview }, optional) => {
      expect(preview).not.toBe(post);
      expect(preview.bodyHtml).toBe('');
      expect(optional.postPreviewsAccess.context).toEqual({ isAuthenticated: false, activeTierIds: [], isPaid: false });
      return '<main>' + optional.pendingBodyHtml + '</main>';
    }, copy: { missingTheme: 'missing theme', themeOff: 'theme off' },
  } });
  expect(result).toEqual({ html: '<main></main>', templateChoice: 'page.html' });
  expect(post.bodyHtml).toBe('saved');
  expect(post.templateChoice).toBeNull();
});
