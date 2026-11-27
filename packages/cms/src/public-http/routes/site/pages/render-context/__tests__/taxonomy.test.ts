import { expect, it, vi } from 'vitest';
import type { PublicPostRecord } from '../../../../../../posts/post.js';
import { placeAfterCurrentContent, resolveAssignedTermsForRender } from '../taxonomy.js';

const post: PublicPostRecord = { id: 'entry-3', workspaceId: 'w', title: 'Weather', slug: 'weather',
  bodyJson: {}, kind: 'page', bodyFormat: 'html', bodyHtml: '<p>Rain</p>', status: 'published', updatedAt: 'now', version: 1 };

it('loads a page’s assigned terms using its entry ID and returns no terms without the optional reader', async () => {
  const terms = [{ termId: 'term-7', termName: 'Storms', taxonomyName: 'Weather events' }];
  const listForContent = vi.fn(async () => terms);
  expect(await resolveAssignedTermsForRender({ deps: { entryTermReadRepo: { listForContent } }, post })).toEqual(terms);
  expect(listForContent).toHaveBeenCalledExactlyOnceWith({ contentType: 'page', contentId: 'entry-3' });
  expect(await resolveAssignedTermsForRender({ deps: {}, post })).toEqual([]);
});

it.each([
  { title: 'ID', marker: `<div data-embed-config='{"type":"content","id":"entry-3","slug":"different"}'>current</div>` },
  { title: 'slug without an ID', marker: `<div data-embed-config='{"type":"content","slug":"weather"}'>current</div>` },
])('places terms inside the article after the first current marker by $title', ({ marker }) => {
  const other = `<div data-embed-config='{"type":"content","id":"entry-9","slug":"weather"}'>other</div>`;
  const block = '<aside>Filed under Storms</aside>';
  const html = '<article>' + other + marker + marker + '</article><footer>Footer</footer>';
  expect(placeAfterCurrentContent({ html, post, block })).toBe(
    '<article>' + other + marker + block + marker + '</article><footer>Footer</footer>',
  );
});

it('does not render the terms next to another entry or an unrelated marker', () => {
  const html = `<article><div data-embed-config='{"type":"content","slug":"tides"}'></div><div data-embed-config='{"type":"menu","id":"entry-3"}'></div></article>`;
  expect(placeAfterCurrentContent({ html, post, block: '<aside>Private metadata</aside>' })).toBe(html);
});

it('leaves a matching marker untouched when it has no terms to display', () => {
  const html = `<article><div data-embed-config='{"type":"content","id":"entry-3"}'></div></article>`;
  expect(placeAfterCurrentContent({ html, post, block: '' })).toBe(html);
});
