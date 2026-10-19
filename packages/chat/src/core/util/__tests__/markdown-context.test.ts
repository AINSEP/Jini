import { describe, expect, it } from 'vitest';
import { computeSkipRanges, isRealArtifactOpenAt, rangeContains } from '../../util/markdown-context.js';

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
});
