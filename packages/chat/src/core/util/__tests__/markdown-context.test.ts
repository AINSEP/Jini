import { describe, expect, it } from 'vitest';
import { computeSkipRanges, isRealArtifactOpenAt, rangeContains } from '../markdown-context.js';

// Not part of the artifacts barrel (see artifacts/markdown-context.ts's own module doc: it's an
// internal detail shared by parser.ts/strip.ts), so this describe block imports the module
// directly rather than through '../artifacts/index.js' like every block above it.
describe('artifacts/markdown-context (internal, direct import)', () => {
  it('treats a heading line as its own inline-code scan region, distinct from surrounding paragraphs', () => {
    const content = '# Heading with `code` inside\nnormal paragraph text';
    const { ranges } = computeSkipRanges({ buffer: content });
    const codeStart = content.indexOf('`code`');
    expect(ranges.some(([s, e]) => s === codeStart && e === codeStart + '`code`'.length)).toBe(true);
  });

  it('treats an unordered and an ordered list item line as their own inline-code scan regions', () => {
    const ul = computeSkipRanges({ buffer: '- item with `code` here' }).ranges;
    expect(ul.length).toBe(1);
    const ol = computeSkipRanges({ buffer: '1. item with `code` here' }).ranges;
    expect(ol.length).toBe(1);
  });

  it('finds multiple inline-code spans within a single paragraph block', () => {
    const content = 'first `one` and second `two` in one paragraph';
    const { ranges } = computeSkipRanges({ buffer: content });
    expect(ranges).toHaveLength(2);
    const [[s1, e1], [s2, e2]] = ranges as [[number, number], [number, number]];
    expect(content.slice(s1, e1)).toBe('`one`');
    expect(content.slice(s2, e2)).toBe('`two`');
  });

  it('rangeContains reports false for a position outside every range', () => {
    expect(rangeContains({ ranges: [[5, 10]], p: 20 })).toBe(false);
    expect(rangeContains({ ranges: [], p: 0 })).toBe(false);
  });

  it('isRealArtifactOpenAt requires whitespace immediately after "<artifact"', () => {
    expect(isRealArtifactOpenAt({ content: '<artifact identifier="a">', idx: 0 })).toBe(true);
    expect(isRealArtifactOpenAt({ content: '<artifactual', idx: 0 })).toBe(false);
    expect(isRealArtifactOpenAt({ content: '<artifact', idx: 0 })).toBe(false);
  });

  it('records a closed fence (with info string) as one range and still scans the paragraph after it', () => {
    expect(computeSkipRanges({ buffer: 'a\n```html\n<x>\n```\nb `c`' })).toEqual({ ranges: [[2, 18], [20, 23]], unclosedFenceStart: null });
  });

  it('reports the start of a fence with no close and ignores inline code inside it', () => {
    expect(computeSkipRanges({ buffer: 'x\n```\n`a`\n' })).toEqual({ ranges: [], unclosedFenceStart: 2 });
  });

  it('only closes a fence on a bare ``` line, not on one carrying an info string', () => {
    expect(computeSkipRanges({ buffer: '```\na\n```js\nb\n```\n' })).toEqual({ ranges: [[0, 18]], unclosedFenceStart: null });
  });

  it('does not treat an unterminated trailing ``` line as a fence opener', () => {
    expect(computeSkipRanges({ buffer: 'p\n```' })).toEqual({ ranges: [], unclosedFenceStart: null });
  });

  it('does not treat an indented ``` line as a fence (its backticks pair as paragraph inline code instead)', () => {
    expect(computeSkipRanges({ buffer: '   ```\n<x>\n   ```\n' })).toEqual({ ranges: [[5, 15]], unclosedFenceStart: null });
  });

  it('pairs inline-code backticks across lines of one paragraph', () => {
    expect(computeSkipRanges({ buffer: 'a `b\nc` d' }).ranges).toEqual([[2, 7]]);
  });

  it('never pairs inline-code backticks across a blank line, a heading, or adjacent list items', () => {
    expect(computeSkipRanges({ buffer: 'a `b\n\nc` d' }).ranges).toEqual([]);
    expect(computeSkipRanges({ buffer: 'a `b\n# c` d' }).ranges).toEqual([]);
    expect(computeSkipRanges({ buffer: '- a `b\n- c` d' }).ranges).toEqual([]);
  });

  it('returns no ranges for an empty buffer', () => {
    expect(computeSkipRanges({ buffer: '' })).toEqual({ ranges: [], unclosedFenceStart: null });
  });

  it('does not close a fence on an unterminated trailing ``` line', () => {
    expect(computeSkipRanges({ buffer: '```\na\n```' })).toEqual({ ranges: [], unclosedFenceStart: 0 });
  });
});
