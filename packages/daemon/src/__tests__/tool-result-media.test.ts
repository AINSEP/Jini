import { describe, expect, it } from 'vitest';
import { extractResultMedia, projectToolResultEvent, resultContent } from '../tool-result-media.js';

describe('projectToolResultEvent', () => {
  it('stores interleaved text and multiple images once without mutating model output', () => {
    const output = { content: [{ type: 'image', mimeType: 'image/png', data: 'PIXELS_ONE' }, { type: 'text', text: 'middle' }, { type: 'image', mimeType: 'image/jpeg', data: 'PIXELS_TWO' }], caption: 'kept' };
    const result = { executionId: 'e', status: 'completed' as const, output };
    const event = projectToolResultEvent({ result });
    expect(JSON.parse(event.content)).toEqual({ content: [{ type: 'text', text: 'middle' }], caption: 'kept' });
    expect(event.media).toEqual([output.content[0], output.content[2]]);
    expect(JSON.stringify(event).split('PIXELS_ONE')).toHaveLength(2);
    expect(JSON.stringify(event).split('PIXELS_TWO')).toHaveLength(2);
    expect(resultContent({ result })).toBe(JSON.stringify(output));
  });

  it.each(['denied', 'confirmation-denied', 'timed-out', 'cancelled', 'failed'] as const)('preserves the existing %s status mapping', status => {
    const result = { executionId: 'e', status };
    expect(projectToolResultEvent({ result })).toEqual({ content: resultContent({ result }), isError: true });
  });

  it('preserves explicit MCP errors without changing the envelope', () => {
    expect(projectToolResultEvent({ result: { executionId: 'e', status: 'completed', output: { content: [{ type: 'text', text: 'failure' }], isError: true } } })).toEqual({ content: '{"content":[{"type":"text","text":"failure"}],"isError":true}', isError: true });
  });
});

describe('extractResultMedia', () => {
  it('extracts a well-formed image block and removes it from the remainder', () => {
    const output = {
      content: [
        { type: 'text', text: 'here is your image' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      ],
    };
    const { remainder, media } = extractResultMedia({ output: output });

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
    const { media } = extractResultMedia({ output: output });
    expect(media).toEqual([
      { type: 'image', mimeType: 'image/png', data: 'FIRST' },
      { type: 'image', mimeType: 'image/jpeg', data: 'SECOND' },
    ]);
  });

  it('returns the identical reference for a plain (non-envelope) output — the common case', () => {
    const output = { posts: [{ id: 'p1' }], total: 1 };
    const result = extractResultMedia({ output: output });
    expect(result.remainder).toBe(output);
    expect(result.media).toEqual([]);
  });

  it('returns the identical reference when content has no image blocks', () => {
    const output = { content: [{ type: 'text', text: 'ok' }] };
    const result = extractResultMedia({ output: output });
    expect(result.remainder).toBe(output);
    expect(result.media).toEqual([]);
  });

  it('drops a malformed image block (missing data) rather than throwing or including it', () => {
    const output = { content: [{ type: 'image', mimeType: 'image/png' }] };
    const { remainder, media } = extractResultMedia({ output: output });
    expect(media).toEqual([]);
    // Not extracted, so it stays in the remainder for whatever downstream handling would apply.
    expect(remainder).toEqual(output);
  });

  it('drops a malformed image block (non-string mimeType) rather than throwing', () => {
    const output = { content: [{ type: 'image', mimeType: 42, data: 'AAAA' }] };
    expect(extractResultMedia({ output: output }).media).toEqual([]);
  });

  it('handles every non-envelope input shape without throwing', () => {
    expect(extractResultMedia({ output: undefined })).toEqual({ remainder: undefined, media: [] });
    expect(extractResultMedia({ output: null })).toEqual({ remainder: null, media: [] });
    expect(extractResultMedia({ output: 'a string result' })).toEqual({ remainder: 'a string result', media: [] });
    expect(extractResultMedia({ output: 42 })).toEqual({ remainder: 42, media: [] });
    expect(extractResultMedia({ output: [1, 2, 3] })).toEqual({ remainder: [1, 2, 3], media: [] });
    expect(extractResultMedia({ output: { content: 'not-an-array' } })).toEqual({ remainder: { content: 'not-an-array' }, media: [] });
  });

  it('never collects a text block into media, even though it is a recognized envelope shape', () => {
    const output = { content: [{ type: 'text', text: 'plain text result' }] };
    expect(extractResultMedia({ output: output }).media).toEqual([]);
  });

  it('preserves every other field on the output object when rebuilding the remainder', () => {
    const output = { content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }], structuredContent: { ok: true } };
    const { remainder } = extractResultMedia({ output: output });
    expect(remainder).toEqual({ content: [], structuredContent: { ok: true } });
  });
});
