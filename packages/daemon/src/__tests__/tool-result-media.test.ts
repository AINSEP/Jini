import { describe, expect, it } from 'vitest';
import { extractResultMedia } from '../tool-result-media.js';

describe('extractResultMedia', () => {
  it('extracts a well-formed image block and removes it from the remainder', () => {
    const output = {
      content: [
        { type: 'text', text: 'here is your image' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      ],
    };
    const { remainder, media } = extractResultMedia(output);

    expect(media).toEqual([{ type: 'image', mimeType: 'image/png', data: 'AAAA' }]);
    expect(remainder).toEqual({ content: [{ type: 'text', text: 'here is your image' }] });
  });

  it('extracts multiple image blocks in arrival order, interleaved with text', () => {
    const output = {
      content: [
        { type: 'image', mimeType: 'image/png', data: 'FIRST' },
        { type: 'text', text: 'middle' },
        { type: 'image', mimeType: 'image/jpeg', data: 'SECOND' },
      ],
    };
    const { media } = extractResultMedia(output);
    expect(media).toEqual([
      { type: 'image', mimeType: 'image/png', data: 'FIRST' },
      { type: 'image', mimeType: 'image/jpeg', data: 'SECOND' },
    ]);
  });

  it('returns the identical reference for a plain (non-envelope) output — the common case', () => {
    const output = { posts: [{ id: 'p1' }], total: 1 };
    const result = extractResultMedia(output);
    expect(result.remainder).toBe(output);
    expect(result.media).toEqual([]);
  });

  it('returns the identical reference when content has no image blocks', () => {
    const output = { content: [{ type: 'text', text: 'ok' }] };
    const result = extractResultMedia(output);
    expect(result.remainder).toBe(output);
    expect(result.media).toEqual([]);
  });

  it('drops a malformed image block (missing data) rather than throwing or including it', () => {
    const output = { content: [{ type: 'image', mimeType: 'image/png' }] };
    const { remainder, media } = extractResultMedia(output);
    expect(media).toEqual([]);
    // Not extracted, so it stays in the remainder for whatever downstream handling would apply.
    expect(remainder).toEqual(output);
  });

  it('drops a malformed image block (non-string mimeType) rather than throwing', () => {
    const output = { content: [{ type: 'image', mimeType: 42, data: 'AAAA' }] };
    expect(extractResultMedia(output).media).toEqual([]);
  });

  it('handles every non-envelope input shape without throwing', () => {
    expect(extractResultMedia(undefined)).toEqual({ remainder: undefined, media: [] });
    expect(extractResultMedia(null)).toEqual({ remainder: null, media: [] });
    expect(extractResultMedia('a string result')).toEqual({ remainder: 'a string result', media: [] });
    expect(extractResultMedia(42)).toEqual({ remainder: 42, media: [] });
    expect(extractResultMedia([1, 2, 3])).toEqual({ remainder: [1, 2, 3], media: [] });
    expect(extractResultMedia({ content: 'not-an-array' })).toEqual({ remainder: { content: 'not-an-array' }, media: [] });
  });

  it('never collects a text block into media, even though it is a recognized envelope shape', () => {
    const output = { content: [{ type: 'text', text: 'plain text result' }] };
    expect(extractResultMedia(output).media).toEqual([]);
  });

  it('preserves every other field on the output object when rebuilding the remainder', () => {
    const output = { content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }], structuredContent: { ok: true } };
    const { remainder } = extractResultMedia(output);
    expect(remainder).toEqual({ content: [], structuredContent: { ok: true } });
  });
});
