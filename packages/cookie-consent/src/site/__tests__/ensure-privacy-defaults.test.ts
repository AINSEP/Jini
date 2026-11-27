import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';
import { ensureSitePrivacyDefaults, type PrivacyDefaultsDeps, type PrivacyPageRow } from '../ensure-privacy-defaults.js';

function site(rows: PrivacyPageRow[] = [], initialUrl = '') {
  let url = initialUrl;
  let transaction = false;
  const pages = new Map<string, { input: Parameters<PrivacyDefaultsDeps['createPost']>[0]['input']; html?: string }>();
  const list = vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
    if (workspaceId !== 'site-9') throw new Error('wrong workspace');
    return [...rows, ...[...pages.values()].map(({ input }) => input)];
  });
  const setUrl = vi.fn(async ({ url: next }: { url: string; principalId: string }) => { url = next; });
  const deps: PrivacyDefaultsDeps = {
    workspaceId: 'site-9',
    post: { repo: { list, transaction: async ({ fn }) => {
      transaction = true;
      try { await fn(); } finally { transaction = false; }
    } } },
    async createPost({ input }) {
      if (!transaction || pages.has(input.id)) throw new Error('page creation must be in one transaction and unique');
      pages.set(input.id, { input });
    },
    ids: { newId: () => 'page-9' },
    pagesHtmlStore: ({ workspaceId, postId }) => ({ async ensureHtmlFormat({ seedHtml }) {
      const page = pages.get(postId);
      if (!transaction || !page || workspaceId !== page.input.workspaceId) throw new Error('wrong page or outside transaction');
      page.html = seedHtml;
    } }),
    readUrl: async () => url,
    setUrl,
    readIdentity: async () => ({ siteTitle: 'A & B <Store>', principalId: 'owner-9' }),
  };
  return { deps, pages, list, setUrl };
}

it('leaves an existing owner URL alone and never scans or creates pages', async () => {
  const h = site([], 'https://policy.example/privacy');
  await ensureSitePrivacyDefaults(h.deps);
  expect(await h.deps.readUrl()).toBe('https://policy.example/privacy');
  expect(h.list).not.toHaveBeenCalled();
  expect(h.pages.size).toBe(0);
  expect(h.setUrl).not.toHaveBeenCalled();
});

it('links the published privacy page over drafts and trash without replacing owner HTML', async () => {
  const h = site([
    { slug: 'privacy', kind: 'page', title: 'Privacy Policy', status: 'draft' },
    { slug: 'trashed-policy', kind: 'page', title: 'Privacy Policy', status: 'published', deletedAt: 1 },
    { slug: 'owner-policy', kind: 'page', title: 'Privacy Policy', status: 'published' },
  ]);
  await ensureSitePrivacyDefaults(h.deps);
  expect(h.setUrl.mock.calls).toEqual([[{ url: '/owner-policy', principalId: 'owner-9' }]]);
  expect(await h.deps.readUrl()).toBe('/owner-policy');
  expect(h.pages.size).toBe(0);
});

it.each([
  { rows: [], slug: 'privacy' },
  { rows: [
    { slug: 'privacy', kind: 'post', title: 'Another post', status: 'draft', deletedAt: 1 },
    { slug: 'privacy-policy', kind: 'post', title: 'Also reserved', status: 'published' },
  ], slug: 'privacy-policy-2' },
])('creates and seeds $slug in one transaction and keeps it on the next open', async ({ rows, slug }) => {
  const h = site(rows);
  await ensureSitePrivacyDefaults(h.deps);
  await ensureSitePrivacyDefaults(h.deps);
  const page = h.pages.get('page-9');
  expect(page?.input).toEqual({ workspaceId: 'site-9', id: 'page-9', kind: 'page', status: 'published', slug, title: 'Privacy Policy', actorId: 'owner-9' });
  expect(h.setUrl.mock.calls).toEqual([[{ url: `/${slug}`, principalId: 'owner-9' }]]);
  expect(h.pages.size).toBe(1);
  const dom = new JSDOM(page?.html ?? '');
  try {
    const region = dom.window.document.querySelector('[data-agent-element="privacy-policy"]');
    expect(region?.getAttribute('data-agent-role')).toBe('region');
    expect(region?.querySelector('h1')?.textContent).toBe('Privacy Policy');
    expect(region?.textContent).toContain('A & B <Store> uses necessary cookies');
    expect(region?.querySelector('store')).toBeNull();
    expect(region?.querySelector('mark')?.textContent).toBe('ADD YOUR CONTACT EMAIL');
  } finally { dom.window.close(); }
});

it('does not overwrite a URL the owner saves while defaults are being prepared', async () => {
  const h = site([{ slug: 'privacy', kind: 'page', title: 'Privacy Policy', status: 'draft' }]);
  const readUrl = vi.fn().mockResolvedValueOnce('  ').mockResolvedValue('/new-owner-policy');
  await ensureSitePrivacyDefaults({ ...h.deps, readUrl });
  expect(readUrl.mock.calls).toEqual([[], []]);
  expect(h.setUrl).not.toHaveBeenCalled();
  expect(h.pages.size).toBe(0);
});
