import { checkSiteRelativeTarget } from "../../../../../../routing/site/reserved-paths.js";
import { expect, it } from 'vitest';
import { serveSlugPage, nestedPageRoute } from '../slug-routes.js';

it('keeps nested redirect phases in order before fallthrough', async () => {
  const phases: string[] = [];
  expect(await nestedPageRoute({ checkSiteRelativeTarget, path: '/nested/path', tryRedirectPhase: async ({ phase }) => { phases.push(phase); return false; } })).toEqual({ kind: 'next' });
  expect(phases).toEqual(['pre_content', 'post_content']);
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
