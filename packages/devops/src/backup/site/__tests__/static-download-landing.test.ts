import { expect, it } from 'vitest';
import { landingPages, staticLandingPage } from '../static-download-landing.js';

it('escapes site and page labels without changing delivered hrefs', () => {
  const href = 'sites/theme/a%20b/index.html';
  const html = staticLandingPage({ siteName: '<Site & Name>', themes: [{ title: '<Theme>', folder: 'theme', active: true,
    pages: [{ href, title: '<Page>', label: '/<label>/' }] }] }).toString();
  expect(html).toContain('<title>&lt;Site &amp; Name&gt; — static copy</title>');
  expect(html).toContain('<h1>&lt;Site &amp; Name&gt;</h1>');
  expect(html).toContain('<h2>&lt;Theme&gt;</h2>');
  expect(html).toContain(`<a href="${href}"><span>&lt;Page&gt;</span><small>/&lt;label&gt;/</small></a>`);
  expect(html).toContain('1 theme'); expect(html).toContain('1 page');
  const empty = staticLandingPage({ siteName: 'Empty', themes: [] }).toString();
  expect(empty).toContain('0 themes'); expect(empty).toContain('<section class="themes"></section>');
});

it('lists delivered pages home-first, strips their common theme suffix and preserves encoded links', () => {
  const page = (path: string, title: string) => ({ path, content: Buffer.from(`<!-- <title>Ignored</title> --><title>${title}</title>`) });
  const files = [
    page('sites/studio/z #/index.html', 'Latest | Studio'),
    page('sites/studio/index.html', 'Home | Studio'),
    page('sites/studio/a/index.html', 'About | Studio'),
    page('sites/studio/404.html', 'Missing | Studio'),
    page('sites/studio/redirect.html', 'Redirect'),
    page('sites/other/index.html', 'Another'),
  ];
  const required = { files, folder: 'studio', skip: new Set(['sites/studio/redirect.html']), extractPlainText: ({ html }: { html: string }) => html };
  expect(landingPages(required)).toEqual([
    { href: 'sites/studio/index.html', label: '/', title: 'Home' },
    { href: 'sites/studio/a/index.html', label: '/a/', title: 'About' },
    { href: 'sites/studio/z%20%23/index.html', label: '/z #/', title: 'Latest' },
  ]);
  expect(landingPages({ ...required, files: files.slice(0, 1) })).toEqual([
    { href: 'sites/studio/z%20%23/index.html', label: '/z #/', title: 'Latest | Studio' },
  ]);
});
