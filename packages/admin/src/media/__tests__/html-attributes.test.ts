import { describe, expect, it } from 'vitest';
import { describeMediaHtmlAttributeError, parseMediaHtmlAttributes } from '../html-attributes.js';

// Boundary pins for the per-token parser that the legacy suite does not reach: the exact
// whitespace/control cutoff of the URL-scheme strip, non-ASCII values, and where a malformed
// fragment sits relative to accepted tokens.
describe('parseMediaHtmlAttributes URL-scheme strip boundary', () => {
  it('strips the ordinary space (code point 32, the top of the stripped range) before the scheme check', () => {
    const error = { reason: 'unsafe-url', attribute: 'poster' };
    expect(parseMediaHtmlAttributes({ text: 'poster="java script:x"' })).toEqual({ attributes: {}, errors: [error], error });
  });
  it('keeps "!" (code point 33, just above the range), so the scheme no longer spells javascript:', () => {
    expect(parseMediaHtmlAttributes({ text: 'poster="java!script:x"' })).toEqual({
      attributes: { poster: 'java!script:x' }, errors: [], error: null,
    });
  });
  it('keeps a non-breaking space (outside ASCII), so the scheme no longer spells javascript:', () => {
    expect(parseMediaHtmlAttributes({ text: 'poster="java script:x"' })).toEqual({
      attributes: { poster: 'java script:x' }, errors: [], error: null,
    });
  });
  it('accepts an astral-plane (surrogate pair) value unchanged', () => {
    expect(parseMediaHtmlAttributes({ text: 'title="\u{1F600} hero"' })).toEqual({
      attributes: { title: '\u{1F600} hero' }, errors: [], error: null,
    });
  });
});

describe('parseMediaHtmlAttributes malformed placement', () => {
  it('names the trimmed fragment between two tokens and discards the token before it', () => {
    const error = { reason: 'malformed', attribute: '"' };
    expect(parseMediaHtmlAttributes({ text: 'loading=lazy  "  muted' })).toEqual({ attributes: {}, errors: [error], error });
  });
  it('names the trimmed trailing fragment after the last token', () => {
    const error = { reason: 'malformed', attribute: "'" };
    expect(parseMediaHtmlAttributes({ text: "muted '  " })).toEqual({ attributes: {}, errors: [error], error });
  });
  it('lets a later duplicate name overwrite the earlier value', () => {
    expect(parseMediaHtmlAttributes({ text: 'id=a id=b' })).toEqual({ attributes: { id: 'b' }, errors: [], error: null });
  });
  it('starts each call from a fresh tokenizer position', () => {
    // The token pattern is a shared global regex; a stale lastIndex would skip the next input's start.
    parseMediaHtmlAttributes({ text: 'loading=lazy decoding=async' });
    expect(parseMediaHtmlAttributes({ text: 'id=x' })).toEqual({ attributes: { id: 'x' }, errors: [], error: null });
  });
});

describe('describeMediaHtmlAttributeError unsafe-url wording', () => {
  it('says "javascript:" even when the rejected value used data: or vbscript: (reported, not fixed)', () => {
    // The unsafe-url reason covers javascript:, vbscript: and data:, but the hint still names
    // only javascript:, so an operator who typed a data: URL is told the wrong scheme.
    const error = { reason: 'unsafe-url', attribute: 'poster' } as const;
    expect(parseMediaHtmlAttributes({ text: 'poster="data:text/html,x"' }).error).toEqual(error);
    expect(describeMediaHtmlAttributeError({ error })).toBe("'poster' cannot use a javascript: value.");
  });
});
