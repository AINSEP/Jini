import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../../posts/post.js';
import { resolveMarketingPageOrOverride, resolvePostAfterMarketingCheck } from '../marketing.js';

it('honors an explicit false override and performs the second lookup after empty static finish', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'pricing', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: '', status: 'published', templateChoice: null, updatedAt: 'now', version: 1, overridesThemePage: false };
  const readPost = vi.fn(async () => ({ post }));
  const resolution = await resolveMarketingPageOrOverride({ theme: { manifest: { tier: 'static' }, pages: { pricing: 'authored' } }, slug: 'pricing',
    isStandaloneThemePage: () => true, readPost, finishStaticTierDocument: async () => '',
    postPublicPath: ({ slug }) => '/' + slug, resolveSiteTitleForRender: async () => 'Site', buildExtraHead: async () => '', injectSiteAssistantIntoStaticPage: ({ html }) => html,
  });
  expect(resolution).toEqual({ kind: 'fallthrough' });
  if (resolution.kind === 'responded') throw new Error('unexpected response');
  expect(await resolvePostAfterMarketingCheck({ readPost, marketingResolution: resolution })).toBe(post);
  expect(readPost).toHaveBeenCalledTimes(2);
});
