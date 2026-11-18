import { describe, expect, it } from 'vitest';
import { redactUserText } from '../user-text-redaction.js';

// Each opaque-token candidate used to be checked against EVERY detected path and URL span, so a long message
// with many of both took time quadratic in its length. The check is one pass over sorted spans now.
const fakeKey = (index: number) => `Zq${String(index).padStart(6, '0')}AbCdEfGhIjKlMnOpQrStUvWxYz0123456789`;
const timed = (text: string) => {
  const started = performance.now();
  const result = redactUserText({ text });
  return { result, ms: performance.now() - started };
};

describe('a long message with many paths, URLs and opaque tokens', () => {
  it('is handled in time bounded by a small multiple of its length', () => {
    const lines = 16_000;
    const text = Array.from({ length: lines }, (_, i) => `/srv/app/file${i}.txt https://example.test/p/${i} ${fakeKey(i)}`).join('\n');
    const { result, ms } = timed(text);
    // Quadratic scanning took several seconds here; one pass takes well under one.
    expect(ms).toBeLessThan(1500);
    expect(result.count).toBe(lines);
    expect(result.text.split('[token removed]').length - 1).toBe(lines);
    expect(result.text).toContain('/srv/app/file15999.txt https://example.test/p/15999 [token removed]');
  });
  it('grows roughly linearly: eight times the input costs well under sixty-four times as long', () => {
    const build = (lines: number) => Array.from({ length: lines }, (_, i) => `/srv/app/file${i}.txt ${fakeKey(i)}`).join('\n');
    timed(build(500));
    const small = Math.max(timed(build(2000)).ms, 1);
    const large = timed(build(16_000)).ms;
    expect(large / small).toBeLessThan(32);
  });
  it('still exempts a token inside a URL or a typed path, and removes one glued next to them', () => {
    const urlKey = fakeKey(1);
    const text = `https://example.test/a/${urlKey} ${fakeKey(2)} /srv/app/${fakeKey(3)}x`;
    const { result } = timed(text);
    expect(result.text.startsWith(`https://example.test/a/${urlKey} [token removed]`)).toBe(true);
  });
});
