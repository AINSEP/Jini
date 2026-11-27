import { expect, it, vi } from 'vitest';
import { PostNotFoundError, type PublicPostRecord } from '../../../../../../posts/post.js';
import { resolveMarketingPageOrOverride, resolvePostAfterMarketingCheck } from '../marketing.js';

it('honors an explicit false override and performs the second lookup after empty static finish', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'pricing', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: '', status: 'published', templateChoice: null, updatedAt: 'now', version: 1, overridesThemePage: false };
  const readPost = vi.fn(async () => ({ post }));
  const resolution = await resolveMarketingPageOrOverride({ theme: { manifest: { tier: 'static' }, pages: { pricing: 'authored' } }, slug: 'pricing',
    isStandaloneThemePage: () => true, readPost, finishStaticTierDocument: async () => '',
    postPublicPath: ({ slug }) => '/' + slug, resolveSiteTitleForRender: async () => 'Site', resolveAuthoredSiteTitleForRender: async () => undefined, buildExtraHead: async () => '', injectSiteAssistantIntoStaticPage: ({ html }) => html,
  });
  expect(resolution).toEqual({ kind: 'fallthrough' });
  if (resolution.kind === 'responded') throw new Error('unexpected response');
  expect(await resolvePostAfterMarketingCheck({ readPost, marketingResolution: resolution })).toBe(post);
  expect(readPost).toHaveBeenCalledTimes(2);
});

it('calls the explicit authored title lookup with literal true while keeping the normal lookup separate', async () => {
  const resolveSiteTitleForRender = vi.fn(async () => 'Site');
  const resolveAuthoredSiteTitleForRender = vi.fn(async () => undefined);
  const html = await resolveMarketingPageOrOverride({ theme: { manifest: { tier: 'static' }, pages: { pricing: 'authored' } }, slug: 'pricing', isStandaloneThemePage: () => true,
    readPost: async () => { throw Object.create(PostNotFoundError.prototype); }, finishStaticTierDocument: async () => '<html><head><title>Authored</title></head><body></body></html>',
    postPublicPath: ({ slug }) => '/' + slug, resolveSiteTitleForRender, resolveAuthoredSiteTitleForRender,
    buildExtraHead: async () => '<title>Fold</title>', injectSiteAssistantIntoStaticPage: ({ html }) => html });
  expect(resolveSiteTitleForRender).toHaveBeenCalledWith();
  expect(resolveAuthoredSiteTitleForRender).toHaveBeenCalledWith({ preserveAuthoredFallback: true });
  expect(html).toEqual({ kind: 'responded', html: expect.stringContaining('<title>Authored</title>') });
});

function pricingFixture() {
  return {
    theme: { manifest: { tier: 'static' }, pages: { pricing: '<p>Theme pricing</p>' } },
    slug: 'pricing', isStandaloneThemePage: ({ pageId }: { pageId: string }) => pageId === 'pricing',
    readPost: vi.fn<Parameters<typeof resolveMarketingPageOrOverride>[0]['readPost']>(),
    finishStaticTierDocument: vi.fn(async () => '<html><head><title>Authored</title></head><body>Pricing</body></html>'),
    postPublicPath: ({ slug }: { slug: string }) => '/' + slug,
    resolveSiteTitleForRender: async () => 'Fold',
    resolveAuthoredSiteTitleForRender: async () => { throw new Error('explicit title lookup offline'); },
    buildExtraHead: vi.fn(async () => '<title>Fold</title>'),
    injectSiteAssistantIntoStaticPage: ({ html }: { html: string }) => html,
  };
}

it.each([null, true] as const)('uses the colliding post for overridesThemePage=%s without reading it twice', async overridesThemePage => {
  const deps = pricingFixture();
  const post: PublicPostRecord = { id: 'real-pricing', workspaceId: 'w', title: 'Pricing', slug: 'pricing',
    bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: '<p>Post pricing</p>', status: 'published',
    updatedAt: 'now', version: 1, overridesThemePage };
  deps.readPost.mockResolvedValueOnce({ post });
  const resolution = await resolveMarketingPageOrOverride(deps);
  expect(resolution).toEqual({ kind: 'overridingPost', post });
  if (resolution.kind === 'responded') throw new Error('unexpected theme response');
  expect(await resolvePostAfterMarketingCheck({ readPost: deps.readPost, marketingResolution: resolution })).toBe(post);
  expect(deps.readPost).toHaveBeenCalledExactlyOnceWith();
  expect(deps.finishStaticTierDocument).not.toHaveBeenCalled();
});

it('rethrows a post-store failure instead of serving the colliding marketing page', async () => {
  const deps = pricingFixture();
  const error = new Error('published-post lookup offline');
  deps.readPost.mockRejectedValueOnce(error);
  await expect(resolveMarketingPageOrOverride(deps)).rejects.toBe(error);
  expect(deps.finishStaticTierDocument).not.toHaveBeenCalled();
});

it.each(['theme off', 'file absent', 'dynamic theme', 'reserved template'] as const)('falls through before looking up a post for %s', async reason => {
  const deps = pricingFixture();
  const theme = reason === 'theme off' ? null
    : reason === 'file absent' ? { ...deps.theme, pages: {} }
    : reason === 'dynamic theme' ? { ...deps.theme, manifest: { tier: 'templated' } }
    : deps.theme;
  expect(await resolveMarketingPageOrOverride({
    ...deps, theme, isStandaloneThemePage: reason === 'reserved template' ? () => false : deps.isStandaloneThemePage,
  })).toEqual({ kind: 'fallthrough' });
  expect(deps.readPost).not.toHaveBeenCalled();
  expect(deps.finishStaticTierDocument).not.toHaveBeenCalled();
});

it('uses folded SEO title and the marketing canonical when the authored-title read fails', async () => {
  const deps = pricingFixture();
  deps.readPost.mockRejectedValueOnce(new PostNotFoundError('no pricing post'));
  const result = await resolveMarketingPageOrOverride(deps);
  expect(deps.finishStaticTierDocument).toHaveBeenCalledExactlyOnceWith({
    pageId: 'pricing', html: '<p>Theme pricing</p>', currentPath: '/pricing',
  });
  expect(deps.buildExtraHead).toHaveBeenCalledExactlyOnceWith({ siteTitle: 'Fold' }, { canonicalFallbackPath: '/pricing' });
  expect(result).toEqual({ kind: 'responded', html: '<html><head><title>Fold</title></head><body>Pricing</body></html>' });
});
