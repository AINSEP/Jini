import { describe, expect, it } from 'vitest';
import { appendToolKeywords, collectDeclaredToolKeywords, mergeKeywordMaps } from '../declared-keywords.js';

const known = new Set(['media_list', 'post_get']);
const isKnownTool = ({ id }: { id: string }) => known.has(id);

describe('appendToolKeywords', () => {
  it('appends trimmed words for known ids only and ignores non-string or blank values', () => {
    const keywords: Record<string, string> = { media_list: 'images' };
    appendToolKeywords({ keywords, declaration: { media_list: '  photos ', post_get: 3, unknown_tool: 'x', blank: ' ' }, isKnownTool });
    expect(keywords).toEqual({ media_list: 'images photos' });
  });
  it('ignores a non-object declaration', () => {
    const keywords: Record<string, string> = {};
    for (const declaration of [null, 'words', ['media_list']]) appendToolKeywords({ keywords, declaration, isKnownTool });
    expect(keywords).toEqual({});
  });
});

describe('collectDeclaredToolKeywords', () => {
  it('reads each source and skips only the one whose read fails', () => {
    const declarations: Record<string, unknown> = { '/a': { media_list: 'pictures' }, '/c': { post_get: 'article' } };
    const keywords = collectDeclaredToolKeywords({
      listSources: () => [{ packageRoot: '/a' }, { packageRoot: '/b' }, { packageRoot: '/c' }],
      readDeclaration: ({ source }) => { if (!(source.packageRoot in declarations)) throw new Error('malformed'); return declarations[source.packageRoot]; },
      isKnownTool,
    });
    expect({ ...keywords }).toEqual({ media_list: 'pictures', post_get: 'article' });
    expect(Object.getPrototypeOf(keywords)).toBeNull();
  });
  it('contributes nothing when the source enumeration fails', () => {
    const keywords = collectDeclaredToolKeywords({ listSources: () => { throw new Error('absent'); }, readDeclaration: () => ({ media_list: 'x' }), isKnownTool });
    expect({ ...keywords }).toEqual({});
  });
});

describe('mergeKeywordMaps', () => {
  it('unions ids in map order and space-joins non-empty words', () => {
    expect(mergeKeywordMaps({ maps: [{ a: 'one', b: 'two' }, { b: 'three', c: 'four' }, { a: '' }] })).toEqual({ a: 'one', b: 'two three', c: 'four' });
  });
});
