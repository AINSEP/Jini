import { describe, expect, it } from 'vitest';
import { locationFinder } from '../user-text-locations.js';
import { redactUserText } from '../user-text-redaction.js';

const elapsed = (text: string): number => {
  const started = performance.now();
  locationFinder({ text })(0, 1);
  redactUserText({ text });
  return performance.now() - started;
};

// A `://` with no scheme before it starts no URL, so the text after it is not read as a URL tail.
describe('URL delimiters without a scheme', () => {
  it('stays linear when a whitespace-free run of delimiters doubles', () => {
    elapsed('1://'.repeat(5_000));
    const small = Math.max(elapsed('1://'.repeat(20_000)), 1);
    const large = elapsed('1://'.repeat(40_000));
    // Linear work doubles; reading the tail from every delimiter quadrupled. A generous bound absorbs timer noise.
    expect(large).toBeLessThan(small * 3 + 50);
  });

  it('still finds a URL that follows schemeless delimiters', () => {
    const text = `1://x ${'1://'.repeat(3)} https://host.test/a`;
    const start = text.indexOf('https');
    expect(locationFinder({ text })(start, text.length)?.url).toBe(true);
  });
});
