import { describe, expect, it } from 'vitest';
import { locationFinder } from '../user-text-locations.js';
import { redactUserText } from '../user-text-redaction.js';

// The URL scheme alternative started at every word boundary, and `.`, `+` and `-` are boundaries inside a run of
// scheme characters, so each start re-read the rest of the run looking for `://`: 9, 18 and 36 KB of `a.a.a...` took
// 49, 167 and 633 ms. A run is now read once, from its start, whatever its punctuation.
describe('URL scheme location scan', () => {
  it.each([
    ['dots', 'a.'.repeat(100_000)],
    ['hyphens', 'ab-'.repeat(70_000)],
    ['plus signs', 'a+'.repeat(100_000)],
  ])('reads a 200 KB run of %s in bounded time', (_name, text) => {
    const started = performance.now();
    locationFinder({ text })(0, 1);
    redactUserText({ text });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it.each([
    ['see https://x.test/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn12 now', 'https://x.test/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn12'],
    ['1.https://x.test/a', 'https://x.test/a'],
    ['git+ssh://host/repo', 'git+ssh://host/repo'],
    ['x-https://host/a', 'x-https://host/a'],
    ['a.b.c-d+e', undefined],
    ['_https://host/a', undefined],
  ])('finds the URL in %j from its scheme, as before', (text, url) => {
    const find = locationFinder({ text });
    if (url === undefined) {
      expect(find(0, text.length)?.url).not.toBe(true);
      return;
    }
    const start = text.indexOf(url);
    expect(find(start, start + url.length)?.url).toBe(true);
    if (start > 0) expect(locationFinder({ text })(start - 1, start + url.length)).toBeUndefined();
  });
});
