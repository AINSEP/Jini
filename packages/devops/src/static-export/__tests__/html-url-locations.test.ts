import { expect, it } from 'vitest';
import { exportUrlLocations } from '../html-url-locations.js';

it('locates only generated Markdown link destinations without changing labels or descriptions', () => {
  const body = '# Example\n- [Home](/): Welcome\n- [About](https://public.test/about?x=1#team): About (us)\nProse /unchanged\n';
  const locations = exportUrlLocations({ body, contentType: 'text/markdown; charset=utf-8' });
  expect(locations.map(({ start, end, kind }) => [body.slice(start, end), kind])).toEqual([
    ['/', 'url'], ['https://public.test/about?x=1#team', 'url'],
  ]);
  expect(exportUrlLocations({ body, contentType: 'text/plain' })).toEqual([]);
});

it('does not treat Markdown examples in HTML scripts or arbitrary plain text as links', () => {
  expect(exportUrlLocations({ body: '<script>"[Example](/example)"</script>', contentType: 'text/html' })).toEqual([]);
  expect(exportUrlLocations({ body: 'No generated links here.', contentType: 'text/markdown' })).toEqual([]);
});

it('marks canonical and feed discovery references so portable copies preserve their absolute identity', () => {
  const body = '<link rel="canonical" href="https://site.test/about"><link rel="alternate" type="application/rss+xml" href="https://site.test/feed.xml"><a href="https://site.test/about">About</a>';
  const locations = exportUrlLocations({ body, contentType: 'text/html' });
  expect(locations.map(location => location.identity === true)).toEqual([true, true, false]);
});

it('locates namespaced sitemap URLs and valid JSON link values without capturing prose', () => {
  const xml = '<urlset><image:loc>/image?a=1&amp;b=2</image:loc><title>/article</title><loc>/page</loc></urlset>';
  const json = String.raw`{"src":"\/icons\/mark.svg","nested":{"href":"/about","url":"/catalog?q=a\"b"},"title":"/not-a-link"}`;
  const slices = (body: string, contentType: string) =>
    exportUrlLocations({ body, contentType }).map(({ start, end, kind }) => [body.slice(start, end), kind]);

  expect(slices(xml, 'application/xml')).toEqual([['/image?a=1&amp;b=2', 'url'], ['/page', 'url']]);
  expect(slices(json, 'application/manifest+json')).toEqual([
    [String.raw`\/icons\/mark.svg`, 'url'], ['/about', 'url'], [String.raw`/catalog?q=a\"b`, 'url'],
  ]);
  expect(slices('{"src":"/unfinished"', 'application/json')).toEqual([]);
});

it('visits template content and distinguishes valueless attributes from a deliberately empty action', () => {
  const html = '<img src><template><img src="/placeholder.png"></template><form action=""></form>';
  expect(exportUrlLocations({ body: html, contentType: 'text/html' }).map(({ start, end, kind }) => [html.slice(start, end), kind])).toEqual([
    ['/placeholder.png', 'url'], ['', 'action'],
  ]);
});
