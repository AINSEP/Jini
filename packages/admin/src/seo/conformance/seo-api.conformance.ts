import type { AdminSeoPort } from '../ports.js';
/** Destructive framework-free checklist; use an isolated seed containing the requested entry. */
export async function runSeoApiConformance(
  { api }: { api: AdminSeoPort }, { entryId = 'conformance-entry' }: { entryId?: string } = {},
): Promise<readonly string[]> {
  const checks: string[] = [];
  function assert(condition: boolean, name: string) {
    if (!condition) throw new Error(`SEO API conformance: ${name}`);
    checks.push(name);
  }
  const before = await api.getSeoSettings({});
  const original = await api.getSeoEntry({ entryId });
  const saved = await api.putSeoSettings({}, { defaultDescription: 'conformance-description' });
  assert(saved.defaultDescription === 'conformance-description', 'settings write returns saved value');
  const merged = await api.putSeoSettings({}, { twitterSite: '@conformance' });
  assert(merged.defaultDescription === saved.defaultDescription, 'omitted default survives merge');
  const cleared = await api.putSeoSettings({}, { defaultDescription: null });
  assert(cleared.defaultDescription === undefined, 'null default clears to absent');
  assert(before.defaultDescription !== 'conformance-description', 'settings snapshots remain unchanged');
  await api.putSeoSettings({}, { ...before, defaultDescription: before.defaultDescription ?? null, defaultOgImage: before.defaultOgImage ?? null, twitterSite: before.twitterSite ?? null });
  const changed = await api.putSeoEntry({ entryId }, { title: 'Conformance title', noindex: true });
  assert(changed.title === 'Conformance title' && changed.robots.noindex, 'entry patch returns effective meta');
  const retained = await api.putSeoEntry({ entryId }, { description: 'Conformance description' });
  assert(retained.title === 'Conformance title', 'entry omission preserves previous overrides');
  const reset = await api.putSeoEntry({ entryId }, { title: null, description: null, noindex: null });
  assert(reset.title === original.title, 'null entry override restores fallback');
  assert(original.title !== 'Conformance title', 'entry snapshots remain unchanged');
  const analysis = await api.analyzeSeoEntry({ entryId });
  assert(analysis.entryId === entryId && Array.isArray(analysis.issues), 'analysis returns entry issues');
  assert((await api.regenerateSeoSitemap({})).accepted, 'regeneration accepts request');
  assert(Array.isArray(await api.listSeoPosts({})) && Array.isArray(await api.listSeoPages({})), 'entry choices remain arrays');
  assert(typeof (await api.fetchSitemapXml({})).text === 'string', 'sitemap returns exact text');
  assert(typeof api.mediaOriginalUrl({ id: 'conformance-asset' }) === 'string', 'preview URL is synchronous');
  const abort = new AbortController(); abort.abort();
  let rejected = false;
  try { await api.fetchSitemapXml({}, { signal: abort.signal }); } catch { rejected = true; }
  assert(rejected, 'aborted sitemap request rejects');
  return checks;
}
