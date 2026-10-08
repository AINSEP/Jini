import { expect, it } from 'vitest';
import { createMemorySeoApi } from '../adapters/memory.js';
import { runSeoApiConformance } from '../conformance/seo-api.conformance.js';
it('memory adapter passes the SEO API conformance checklist', async () => {
  const meta = { title: 'Seed title', canonical: 'https://example.test/entry', robots: { noindex: false, nofollow: false }, openGraph: { title: 'Seed title', type: 'website' as const, url: 'https://example.test/entry' }, twitter: { title: 'Seed title', card: 'summary' as const }, jsonLd: [] };
  const api = createMemorySeoApi({ entries: { 'conformance-entry': { meta, analysis: { entryId: 'conformance-entry', score: 100, issues: [], resolved: meta } } } });
  expect(await runSeoApiConformance({ api }, {})).toEqual([
    'settings write returns saved value', 'omitted default survives merge', 'null default clears to absent', 'settings snapshots remain unchanged',
    'entry patch returns effective meta', 'entry omission preserves previous overrides', 'null entry override restores fallback', 'entry snapshots remain unchanged',
    'analysis returns entry issues', 'regeneration accepts request', 'entry choices remain arrays', 'sitemap returns exact text', 'preview URL is synchronous', 'aborted sitemap request rejects',
  ]);
});
