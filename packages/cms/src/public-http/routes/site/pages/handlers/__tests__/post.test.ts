import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../../posts/post.js';
import { renderTemplateBranchIfEligible } from '../post.js';

it('renders a bare page before checking whether a theme is active', async () => {
  const post: PublicPostRecord = { id: 'p', workspaceId: 'w', title: 'Page', slug: 'page', bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: '', status: 'published', templateChoice: '', updatedAt: 'now', version: 1 };
  const branch = vi.fn(() => ({ kind: 'ineligible' as const }));
  const result = await renderTemplateBranchIfEligible({ post, theme: null,
    isBarePageChoice: value => value.kind === 'page' && value.templateChoice === '',
    renderBarePostPage: async () => '<main>bare</main>', resolveTemplateBranchChoice: branch,
    buildExtraHead: async () => '', renderViaTemplate: async () => { throw new Error('unexpected template'); },
  });
  expect(result).toBe('<main>bare</main>');
  expect(branch).not.toHaveBeenCalled();
});
