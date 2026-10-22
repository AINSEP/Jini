import { describe, expect, it } from 'vitest';
import * as seo from '../index.js';
import { createHttpSeoApi, type SeoSitemapTransportPort, type SeoTransportPort } from '../adapters/http.js';
import { createMemorySeoApi } from '../adapters/memory.js';
import { runSeoApiConformance } from '../conformance/seo-api.conformance.js';
import type { AdminSeoPort } from '../ports.js';

const meta = { title: 'Seed title', canonical: 'https://example.test/entry', robots: { noindex: false, nofollow: false }, openGraph: { title: 'Seed title', type: 'website' as const, url: 'https://example.test/entry' }, twitter: { title: 'Seed title', card: 'summary' as const }, jsonLd: [] };
const seed = { 'conformance-entry': { meta, analysis: { entryId: 'conformance-entry', score: 100, issues: [], resolved: meta } } };

function recordingTransport(replies: Record<string, unknown>) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const transport: SeoTransportPort = {
    async request<T>(required: { path: string; method: 'GET' | 'PUT' | 'POST'; body?: unknown }) {
      calls.push(required);
      return replies[required.path] as T;
    },
    url: ({ path }) => `https://admin.test${path}`,
  };
  return { transport, calls };
}

function sitemapReply({ ok = true, status = 200, contentType }: { ok?: boolean; status?: number; contentType?: string | null }): SeoSitemapTransportPort {
  return { get: async () => ({ ok, status, headers: new Headers(contentType == null ? {} : { 'content-type': contentType }), text: async () => '<urlset/>' }) };
}

describe('createHttpSeoApi request mapping', () => {
  it('unwraps settings, entry and analysis envelopes on their existing paths', async () => {
    const base = '/ws/1';
    const { transport, calls } = recordingTransport({
      [`${base}/seo/settings`]: { data: { titleTemplate: '%s' } },
      [`${base}/seo/sitemap/regenerate`]: { data: { accepted: true } },
      [`${base}/seo/entries/a%2Fb`]: { data: { title: 'Entry' } },
      [`${base}/seo/entries/a%2Fb/analyze`]: { data: { score: 90 } },
    });
    const api = createHttpSeoApi({ transport, basePath: `${base}/` });
    await expect(api.getSeoSettings({})).resolves.toEqual({ titleTemplate: '%s' });
    await expect(api.putSeoSettings({}, { titleTemplate: '%s | Site' })).resolves.toEqual({ titleTemplate: '%s' });
    await expect(api.putSeoSettings({})).resolves.toEqual({ titleTemplate: '%s' });
    await expect(api.regenerateSeoSitemap({})).resolves.toEqual({ accepted: true });
    await expect(api.getSeoEntry({ entryId: 'a/b' })).resolves.toEqual({ title: 'Entry' });
    await expect(api.putSeoEntry({ entryId: 'a/b' }, { title: 'New' })).resolves.toEqual({ title: 'Entry' });
    await expect(api.putSeoEntry({ entryId: 'a/b' })).resolves.toEqual({ title: 'Entry' });
    await expect(api.analyzeSeoEntry({ entryId: 'a/b' })).resolves.toEqual({ score: 90 });
    expect(calls).toEqual([
      { path: '/ws/1/seo/settings', method: 'GET' },
      { path: '/ws/1/seo/settings', method: 'PUT', body: { titleTemplate: '%s | Site' } },
      { path: '/ws/1/seo/settings', method: 'PUT', body: {} },
      { path: '/ws/1/seo/sitemap/regenerate', method: 'POST' },
      { path: '/ws/1/seo/entries/a%2Fb', method: 'GET' },
      { path: '/ws/1/seo/entries/a%2Fb', method: 'PUT', body: { title: 'New' } },
      { path: '/ws/1/seo/entries/a%2Fb', method: 'PUT', body: {} },
      { path: '/ws/1/seo/entries/a%2Fb/analyze', method: 'GET' },
    ]);
  });

  it('projects post and page choices out of their list envelopes', async () => {
    const { transport } = recordingTransport({
      '/ws/posts': { posts: [{ post: { id: 'p1', title: 'Post', status: 'draft' } }] },
      '/ws/pages': { posts: [{ post: { id: 'g1', title: 'Page', status: 'published' } }] },
    });
    const api = createHttpSeoApi({ transport, basePath: '/ws' });
    await expect(api.listSeoPosts({})).resolves.toEqual([{ id: 'p1', title: 'Post', status: 'draft' }]);
    await expect(api.listSeoPages({})).resolves.toEqual([{ id: 'g1', title: 'Page', status: 'published' }]);
  });

  it('builds media original and preview URLs through the host transport', () => {
    const { transport } = recordingTransport({});
    const api = createHttpSeoApi({ transport, basePath: '/ws' });
    expect(api.mediaOriginalUrl({ id: 'img 1' })).toBe('https://admin.test/ws/media/img%201/original');
    expect(api.mediaPreviewUrl?.({ value: 'https://cdn.test/a.png' })).toBe('https://cdn.test/a.png');
    expect(api.mediaPreviewUrl?.({ value: 'img7:hero.png' })).toBe('https://admin.test/ws/media/img7/original');
  });

  it('offers share-image inspection only when the host supplies an image transport', () => {
    expect(createHttpSeoApi({ transport: recordingTransport({}).transport, basePath: '/ws' }).inspectShareImage).toBeUndefined();
  });

  it('reads the byte size from content-length and never reports a missing or malformed header as empty', async () => {
    const cases: [string | null, number | null][] = [['2048', 2048], [null, null], ['  ', null], ['abc', null], ['-5', null]];
    for (const [header, byteSize] of cases) {
      const head = async () => ({ status: 200, headers: new Headers(header === null ? {} : { 'content-length': header }) });
      const api = createHttpSeoApi({ transport: recordingTransport({}).transport, basePath: '/ws' }, { imageTransport: { head } });
      await expect(api.inspectShareImage!({ url: 'https://cdn.test/a.png' })).resolves.toEqual({ status: 200, byteSize });
    }
  });

  it('rejects an aborted share-image inspection without issuing the HEAD request', async () => {
    let heads = 0;
    const api = createHttpSeoApi({ transport: recordingTransport({}).transport, basePath: '/ws' }, { imageTransport: { head: async () => { heads++; return { status: 200, headers: new Headers() }; } } });
    const abort = new AbortController(); abort.abort();
    await expect(api.inspectShareImage!({ url: 'https://cdn.test/a.png' }, { signal: abort.signal })).rejects.toThrow();
    expect(heads).toBe(0);
  });
});

describe('createHttpSeoApi sitemap fetch', () => {
  it('refuses when the host supplied no raw sitemap transport', async () => {
    const api = createHttpSeoApi({ transport: recordingTransport({}).transport, basePath: '/ws' });
    await expect(api.fetchSitemapXml({})).rejects.toThrow('SEO sitemap transport unavailable');
  });

  it('returns the XML text of a successful XML response', async () => {
    const api = createHttpSeoApi({ transport: recordingTransport({}).transport, basePath: '/ws' }, { sitemapTransport: sitemapReply({ contentType: 'application/xml' }) });
    await expect(api.fetchSitemapXml({})).resolves.toEqual({ text: '<urlset/>' });
  });

  it('rejects an aborted request before any I/O', async () => {
    const abort = new AbortController(); abort.abort();
    const api = createHttpSeoApi({ transport: recordingTransport({}).transport, basePath: '/ws' }, { sitemapTransport: sitemapReply({ contentType: 'text/xml' }) });
    await expect(api.fetchSitemapXml({}, { signal: abort.signal })).rejects.toThrow();
  });

  it('never parses an HTML page or a missing content type as a sitemap', async () => {
    for (const contentType of ['text/html', null]) {
      const api = createHttpSeoApi({ transport: recordingTransport({}).transport, basePath: '/ws' }, { sitemapTransport: sitemapReply({ contentType }) });
      await expect(api.fetchSitemapXml({})).rejects.toThrow('Could not load the sitemap (HTTP 200).');
    }
  });

  it('rejects a failed XML response with its status', async () => {
    const api = createHttpSeoApi({ transport: recordingTransport({}).transport, basePath: '/ws' }, { sitemapTransport: sitemapReply({ ok: false, status: 502, contentType: 'application/xml' }) });
    await expect(api.fetchSitemapXml({})).rejects.toThrow('Could not load the sitemap (HTTP 502).');
  });
});

describe('createMemorySeoApi', () => {
  it('lets a host derive effective entry meta through resolveEntry', async () => {
    const api = createMemorySeoApi({ entries: seed }, {
      resolveEntry: ({ entryId, base, overrides }) => ({ ...base, title: `${entryId}:${overrides.title ?? base.title}` }),
    });
    await expect(api.putSeoEntry({ entryId: 'conformance-entry' }, { title: 'Custom' })).resolves.toMatchObject({ title: 'conformance-entry:Custom' });
  });
});

describe('runSeoApiConformance', () => {
  it('fails a backend whose sitemap fetch ignores an aborted signal', async () => {
    const api = createMemorySeoApi({ entries: seed });
    const ignoresAbort: AdminSeoPort = { ...api, fetchSitemapXml: () => api.fetchSitemapXml({}) };
    await expect(runSeoApiConformance({ api: ignoresAbort })).rejects.toThrow('SEO API conformance: aborted sitemap request rejects');
  });
});

describe('seo headless controllers', () => {
  it('reports a non-Error settings load failure with the untranslated fallback', async () => {
    const api: AdminSeoPort = { ...createMemorySeoApi({}), getSeoSettings: () => Promise.reject('offline') };
    const controller = seo.createSeoController({ api });
    await controller.load({});
    expect(controller.getSnapshot().error).toBe('failed to load SEO settings');
  });

  it('resolves a sitemap regeneration as accepted or not', async () => {
    const api = createMemorySeoApi({});
    const ok = seo.createSeoController({ api });
    await expect(ok.regenerateSitemap({})).resolves.toBe(true);
    expect(ok.getSnapshot()).toMatchObject({ notice: 'Sitemap regeneration accepted.', saving: false });
    const failing = seo.createSeoController({ api: { ...api, regenerateSeoSitemap: () => Promise.reject(new Error('queue full')) } });
    await expect(failing.regenerateSitemap({})).resolves.toBe(false);
    expect(failing.getSnapshot()).toMatchObject({ error: 'queue full', saving: false });
  });

  it('saves entry overrides with the default translator and skips a save with nothing touched', async () => {
    const api = createMemorySeoApi({ entries: seed });
    const controller = seo.createSeoEntryController({ api, entryId: 'conformance-entry' });
    await controller.save({});
    expect(controller.getSnapshot().saving).toBe(false);
    expect(controller.getSnapshot().notice).toBeNull();
    controller.setField({ key: 'title', value: 'Edited' });
    await controller.save({});
    expect(controller.getSnapshot()).toMatchObject({ notice: 'Saved.', touched: {} });
    expect(controller.getSnapshot().resolved?.title).toBe('Edited');
  });

  it('loads posts then pages into the deprecated headless entry picker, or its error', async () => {
    const api = createMemorySeoApi({ posts: [], pages: [] });
    const picker = seo.createEntryPickerController({ api });
    await picker.load();
    expect(picker.getSnapshot()).toEqual({ entries: [], error: null });
    const failing = seo.createEntryPickerController({ api: { ...api, listSeoPages: () => Promise.reject('down') } });
    await failing.load();
    expect(failing.getSnapshot().error).toBe('failed to load entries');
    const translated = seo.createEntryPickerController({ api: { ...api, listSeoPosts: () => Promise.reject(new Error('posts down')) } }, { t: key => `fr:${key}` });
    await translated.load();
    expect(translated.getSnapshot().error).toBe('posts down');
  });

  it('describes a non-Error sitemap failure with the generic message', async () => {
    const api: AdminSeoPort = { ...createMemorySeoApi({}), fetchSitemapXml: () => Promise.reject('boom') };
    const controller = seo.createSitemapController({ api, enabled: true });
    await controller.load({});
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: 'failed to load the sitemap' });
  });
});

describe('seo public barrel', () => {
  it('wires the module to the published tokens and English messages', () => {
    expect(seo.seoApiToken).toEqual({ id: 'admin.seo.api', version: 1, cardinality: 'one' });
    expect(seo.seoEventsToken).toEqual({ id: 'admin.seo.events', version: 1, cardinality: 'one' });
    expect(seo.seoModule.requires).toMatchObject({ seoApi: seo.seoApiToken });
    expect(seo.seoModule.messages).toBe(seo.seoMessagesEn);
    expect(seo.describeSeoError({ error: 'opaque', fallback: 'fallback text' })).toBe('fallback text');
  });

  it('disambiguates duplicate titles by id when an entry has no slug', () => {
    const options = seo.entryPickerOptions({ posts: [], pages: [{ id: 'g1', title: 'Landing', status: 'published' }, { id: 'g2', title: 'Landing', status: 'published', slug: 'landing-2' }] });
    expect(options.map(option => option.detail)).toEqual(['g1', 'landing-2']);
  });
});
