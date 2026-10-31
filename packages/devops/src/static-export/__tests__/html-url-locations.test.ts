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
