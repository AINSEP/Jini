import { expect, it } from 'vitest';
import { staticLandingPage } from '../static-download-landing.js';

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
